// Runs the real migration on an in-process Postgres (PGlite) with a minimal stub of
// Supabase's auth schema/roles, then exercises RLS, the atomic RPC and the credential guard.
// Limitation: this is not a hosted Supabase instance (see README "Verification status").
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const T1 = "00000000-0000-0000-0000-0000000000b1"; // teacher of class "One"
const T2 = "00000000-0000-0000-0000-0000000000b2"; // teacher of class "Two"
const OFF = "00000000-0000-0000-0000-0000000000b3"; // deactivated teacher of "One"
let db, classOne, classTwo, stuOne = [], stuTwo = [];

const stub = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, encrypted_password text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`;

async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
const rejects = (p, re) => assert.rejects(p, re);

before(async () => {
  db = new PGlite();
  await db.exec(stub);
  await db.exec(readFileSync(new URL("../supabase/migrations/20260101000000_schema.sql", import.meta.url), "utf8"));
  await db.exec(`grant execute on all functions in schema public to service_role;`);
  for (const [id, e, p] of [[ADMIN, "admin@x", "h1"], [T1, "t1@x", "h2"], [T2, "t2@x", "h3"], [OFF, "off@x", "h4"]])
    await db.query("insert into auth.users values ($1,$2,$3)", [id, e, p]);
  classOne = (await q("select id from classes where name='One'"))[0].id;
  classTwo = (await q("select id from classes where name='Two'"))[0].id;
  await db.query(`insert into profiles (id,full_name,username,role,assigned_class_id,is_active) values
    ($1,'Admin','admin','admin',null,true),($2,'T One','t_one','teacher',$5,true),
    ($3,'T Two','t_two','teacher',$6,true),($4,'T Off','t_off','teacher',$5,false)`,
    [ADMIN, T1, T2, OFF, classOne, classTwo]);
  for (let i = 1; i <= 3; i++) {
    stuOne.push((await q("insert into students (full_name,father_name,roll_number,class_id,enrollment_date) values ($1,'F',$2,$3,'2026-01-01') returning id", [`One ${i}`, i, classOne]))[0].id);
    stuTwo.push((await q("insert into students (full_name,father_name,roll_number,class_id,enrollment_date) values ($1,'F',$2,$3,'2026-01-01') returning id", [`Two ${i}`, i, classTwo]))[0].id);
  }
});

const recs = (ids, absent = []) => JSON.stringify(ids.map((s) => ({ student_id: s, status: absent.includes(s) ? "absent" : "present" })));

test("seed: exactly seven classes in order", async () => {
  const r = await q("select name from classes order by sort_order");
  assert.deepEqual(r.map((x) => x.name), ["ECCE", "Nursery", "One", "Two", "Three", "Four", "Five"]);
});

test("RLS: teacher sees only own class, students and attendance", async () => {
  await as(T1, async () => {
    assert.deepEqual((await q("select name from classes")).map((x) => x.name), ["One"]);
    assert.equal((await q("select 1 from students")).length, 3);
    assert.equal((await q("select 1 from students where class_id=$1", [classTwo])).length, 0);
    assert.equal((await q("select 1 from profiles")).length, 1); // only self
    assert.equal((await q("select 1 from audit_logs")).length, 0);
  });
});

test("RLS: admin sees everything", async () => {
  await as(ADMIN, async () => {
    assert.equal((await q("select 1 from classes")).length, 7);
    assert.equal((await q("select 1 from students")).length, 6);
    assert.equal((await q("select 1 from profiles")).length, 4);
  });
});

test("RLS: teacher cannot write students, profiles, classes or attendance directly", async () => {
  await as(T1, async () => {
    await rejects(db.query("insert into students (full_name,father_name,roll_number,class_id) values ('x','y',99,$1)", [classOne]), /permission|row-level/i);
    assert.equal((await db.query("update students set full_name='hack' where class_id=$1", [classOne])).affectedRows, 0);
    await rejects(db.query("update profiles set role='admin', assigned_class_id=null where id=$1", [T1]), /permission/i);
    await rejects(db.query("update classes set name='x'"), /permission/i);
    await rejects(db.query("insert into attendance (student_id,attendance_date,status) values ($1,'2026-02-02','absent')", [stuOne[0]]), /permission/i);
    await rejects(db.query("delete from students"), /permission/i);
  });
});

test("RLS: unauthenticated (anon) has no access", async () => {
  await db.exec("set role anon");
  try { await rejects(db.query("select * from students"), /permission/i); } finally { await db.exec("reset role"); }
});

test("save_attendance: teacher saves own class, atomic, totals correct", async () => {
  const r = await as(T1, async () => (await q("select save_attendance($1,'2026-02-02',$2::jsonb) as r", [classOne, recs(stuOne, [stuOne[1]])]))[0].r);
  assert.deepEqual(r, { total: 3, present: 2, absent: 1 });
  const rows = await q("select count(*)::int n from attendance");
  assert.equal(rows[0].n, 3);
});

test("save_attendance: re-save edits in place, no duplicates", async () => {
  await as(T1, async () => q("select save_attendance($1,'2026-02-02',$2::jsonb)", [classOne, recs(stuOne, [stuOne[0], stuOne[1]])]));
  assert.equal((await q("select count(*)::int n from attendance where attendance_date='2026-02-02'"))[0].n, 3);
  assert.equal((await q("select count(*)::int n from attendance where status='absent' and attendance_date='2026-02-02'"))[0].n, 2);
});

test("save_attendance: teacher cannot save another class", async () => {
  await as(T1, async () => rejects(q("select save_attendance($1,'2026-02-02',$2::jsonb)", [classTwo, recs(stuTwo)]), /own class/));
});

test("save_attendance: deactivated teacher is rejected and sees nothing", async () => {
  await as(OFF, async () => {
    await rejects(q("select save_attendance($1,'2026-02-02',$2::jsonb)", [classOne, recs(stuOne)]), /Not authorised/);
    assert.equal((await q("select 1 from students")).length, 0);
  });
});

test("save_attendance: admin may edit any class", async () => {
  const r = await as(ADMIN, async () => (await q("select save_attendance($1,'2026-02-02',$2::jsonb) as r", [classTwo, recs(stuTwo, [stuTwo[2]])]))[0].r);
  assert.equal(r.absent, 1);
});

test("save_attendance: rejects future date, partial list, foreign student, bad status, duplicates", async () => {
  await as(ADMIN, async () => {
    await rejects(q("select save_attendance($1,'2999-01-01',$2::jsonb)", [classOne, recs(stuOne)]), /future/);
    await rejects(q("select save_attendance($1,'2026-02-03',$2::jsonb)", [classOne, recs(stuOne.slice(0, 2))]), /out of date/);
    await rejects(q("select save_attendance($1,'2026-02-03',$2::jsonb)", [classOne, recs([...stuOne.slice(0, 2), stuTwo[0]])]), /out of date/);
    await rejects(q("select save_attendance($1,'2026-02-03',$2::jsonb)", [classOne, JSON.stringify(stuOne.map((s) => ({ student_id: s, status: "late" })))]), /Invalid/);
    await rejects(q("select save_attendance($1,'2026-02-03',$2::jsonb)", [classOne, JSON.stringify([...stuOne, stuOne[0]].map((s) => ({ student_id: s, status: "present" })))]), /Duplicate/);
  });
  // failed attempts left nothing behind
  assert.equal((await q("select count(*)::int n from attendance where attendance_date='2026-02-03'"))[0].n, 0);
});

test("unique constraint prevents duplicate student/date rows", async () => {
  await rejects(db.query("insert into attendance (student_id,attendance_date,status) values ($1,'2026-02-02','present')", [stuOne[0]]), /duplicate key/);
});

test("duplicate roll number in a class is rejected; deactivated roll can be reused", async () => {
  await rejects(db.query("insert into students (full_name,father_name,roll_number,class_id) values ('d','d',1,$1)", [classOne]), /duplicate key/);
  const id = (await q("insert into students (full_name,father_name,roll_number,class_id) values ('tmp','f',50,$1) returning id", [classOne]))[0].id;
  await db.query("update students set is_active=false where id=$1", [id]);
  await db.query("insert into students (full_name,father_name,roll_number,class_id) values ('reuse','f',50,$1)", [classOne]);
});

test("students with attendance cannot be hard-deleted (history preserved)", async () => {
  await rejects(db.query("delete from students where id=$1", [stuOne[0]]), /foreign key/);
});

test("daily report: counts and class scoping through RLS", async () => {
  const t = await as(T1, async () => q("select * from daily_report('2026-02-02', null)"));
  assert.equal(t.length, 3);
  assert.ok(t.every((r) => r.class_name === "One"));
  const forbidden = await as(T1, async () => q("select * from daily_report('2026-02-02', $1)", [classTwo]));
  assert.equal(forbidden.length, 0);
  const a = await as(ADMIN, async () => q("select * from daily_report('2026-02-02', null)"));
  assert.equal(a.length, 6);
});

test("monthly report: percentages from recorded days only; enrolment and future dates excluded", async () => {
  // second recorded day for class One: student 0 present, student 1 absent, student 2 present
  await as(T1, async () => q("select save_attendance($1,'2026-02-03',$2::jsonb)", [classOne, recs(stuOne, [stuOne[1]])]));
  // a late joiner enrolled 2026-02-10 must not be counted for earlier days
  const late = (await q("insert into students (full_name,father_name,roll_number,class_id,enrollment_date) values ('Late','f',9,$1,'2026-02-10') returning id", [classOne]))[0].id;
  const rows = await as(T1, async () => q("select * from monthly_report(2026,2,$1) order by roll_number", [classOne]));
  const byRoll = Object.fromEntries(rows.map((r) => [r.roll_number, r]));
  // day1 absent:[0,1]; day2 absent:[1] -> s0: 1P/1A=50, s1: 0P/2A=0, s2: 2P=100
  assert.equal(Number(byRoll[1].percentage), 50);
  assert.equal(Number(byRoll[2].percentage), 0);
  assert.equal(Number(byRoll[3].percentage), 100);
  assert.equal(byRoll[9].total_days, 0);
  assert.equal(byRoll[9].percentage, null);
  assert.equal(late.length > 0, true);
  // one-third rounding
  const m = await as(ADMIN, async () => q("select * from monthly_report(2026,2,null)"));
  assert.ok(m.length >= 7);
});

test("class_summary: totals, absent counts, teacher name", async () => {
  const r = await as(ADMIN, async () => q("select * from class_summary('2026-02-02') where class_name='One'"));
  assert.equal(r[0].present + r[0].absent, 3);
  assert.equal(r[0].teacher_names, "T One");
  assert.equal(r[0].recorded, true);
});

test("audit log: attendance save and student change are recorded; teachers cannot read", async () => {
  const n = (await q("select count(*)::int n from audit_logs where action='attendance_saved'"))[0].n;
  assert.ok(n >= 3);
  assert.ok((await q("select count(*)::int n from audit_logs where entity_type='students'"))[0].n > 0);
});

test("credential guard: password/email change blocked without admin grant, allowed with it (single use)", async () => {
  await rejects(db.query("update auth.users set encrypted_password='new' where id=$1", [T1]), /restricted to the administrator/);
  await rejects(db.query("update auth.users set email='evil@x' where id=$1", [T1]), /restricted to the administrator/);
  // teachers cannot self-grant
  await as(T1, async () => rejects(db.query("select public.grant_credential_change($1)", [T1]), /permission/i));
  // the service role (edge function) can
  await db.exec("set role service_role"); await db.query("select public.grant_credential_change($1)", [T1]); await db.exec("reset role");
  await db.query("update auth.users set encrypted_password='new' where id=$1", [T1]);
  await rejects(db.query("update auth.users set encrypted_password='again' where id=$1", [T1]), /restricted/); // grant consumed
  // unrelated updates (e.g. last sign-in) are unaffected
  await db.query("alter table auth.users add column last_sign_in_at timestamptz");
  await db.query("update auth.users set last_sign_in_at=now() where id=$1", [T1]);
});
