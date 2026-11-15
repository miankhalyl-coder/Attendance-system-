// Browser test of the real pages against a MOCKED Supabase API (no live project needed).
// Verifies: login routing, role guard redirects, attendance default-present / toggle / confirm / save payload,
// no horizontal overflow at phone/tablet/desktop widths. Does NOT prove RLS (see db.rls.test.mjs) or live Supabase.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const ROOT = new URL("../../public/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const HOST = "https://mock.supabase.co";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64({ alg: "HS256" })}.${b64({ sub, role: "authenticated", exp: 4102444800 })}.sig`;

const CLASS_ONE = "11111111-1111-1111-1111-111111111111";
const users = {
  teacher: { id: "aaaaaaaa-0000-0000-0000-000000000001", username: "teacher_one", full_name: "Ms Sara", role: "teacher", assigned_class_id: CLASS_ONE, is_active: true, classes: { name: "One" } },
  admin: { id: "aaaaaaaa-0000-0000-0000-000000000002", username: "admin", full_name: "Admin", role: "admin", assigned_class_id: null, is_active: true, classes: null },
};
const students = ["Ali Ahmed", "Ayesha Bibi", "Hassan Ali", "Fatima Noor", "Usman Khan"].map((n, i) => ({ id: `ssssssss-0000-0000-0000-00000000000${i + 1}`, full_name: n, roll_number: i + 1 }));

let server, browser, port, saved;
before(async () => {
  server = http.createServer((req, res) => {
    let p = normalize(decodeURIComponent(req.url.split("?")[0])); if (p.endsWith("/") || p === "\\") p = join(p, "index.html");
    const f = join(ROOT, p);
    if (!f.startsWith(normalize(ROOT)) || !existsSync(f)) { res.writeHead(404); return res.end("nf"); }
    if (f.endsWith("config.js")) { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(`export const SUPABASE_URL="${HOST}";export const SUPABASE_ANON_KEY="anon";export const EMAIL_DOMAIN="gpskg.app";`); }
    res.writeHead(200, { "Content-Type": mime[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
  }).listen(0); port = server.address().port;
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
after(async () => { await browser?.close(); server?.close(); });

async function newPage(who, width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const u = users[who || "teacher"];
  await ctx.route(`${HOST}/**`, async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "*" }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (path.endsWith("/auth/v1/token")) {
      const body = JSON.parse(req.postData() || "{}");
      if (body.password !== "secret123") return json({ error: "invalid_grant", error_description: "Invalid login credentials" }, 400);
      return json({ access_token: jwt(u.id), token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "r", user: { id: u.id, aud: "authenticated", email: `${u.username}@gpskg.app` } });
    }
    if (path.endsWith("/rest/v1/profiles")) return json(u);
    if (path.endsWith("/rest/v1/classes")) return json([{ id: CLASS_ONE, name: "One", sort_order: 3 }]);
    if (path.endsWith("/rpc/class_summary")) return json([{ class_id: CLASS_ONE, class_name: "One", total_students: 5, present: 4, absent: 1, teacher_names: "Ms Sara", recorded: true }]);
    if (path.endsWith("/rpc/monthly_report")) return json(students.map((s, i) => ({ student_id: s.id, roll_number: s.roll_number, full_name: s.full_name, class_id: CLASS_ONE, class_name: "One", present_days: 20 - i, absent_days: i, total_days: 20, percentage: (100 * (20 - i) / 20) })));
    if (path.endsWith("/rpc/daily_report")) return json(students.map((s, i) => ({ student_id: s.id, roll_number: s.roll_number, full_name: s.full_name, class_id: CLASS_ONE, class_name: "One", status: i % 2 ? "absent" : "present" })));
    if (path.endsWith("/rest/v1/students")) return json(students);
    if (path.endsWith("/rest/v1/attendance")) return json([]);
    if (path.endsWith("/rpc/save_attendance")) { saved = JSON.parse(req.postData()); const a = saved.p_records.filter((r) => r.status === "absent").length; return json({ total: saved.p_records.length, present: saved.p_records.length - a, absent: a }); }
    if (path.endsWith("/rest/v1/audit_logs") || path.endsWith("/rest/v1/profiles")) return json([]);
    return json([]);
  });
  await page.addInitScript(({ who, u }) => {
    if (who) localStorage.setItem("sb-mock-auth-token", JSON.stringify({ access_token: "x", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "r", user: { id: u.id, aud: "authenticated" } }));
  }, { who, u });
  return { page, ctx, errors };
}
const base = () => `http://localhost:${port}`;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("login: wrong password shows friendly error", async () => {
  const { page, ctx } = await newPage(null);
  await page.goto(`${base()}/login.html`);
  await page.fill("#username", "teacher_one"); await page.fill("#password", "wrong"); await page.click("#submit");
  await page.waitForSelector("#err:not(.d-none)");
  assert.match(await page.textContent("#err"), /Incorrect username or password/);
  await ctx.close();
});

test("login: teacher is routed to teacher dashboard; no register/forgot links exist", async () => {
  const { page, ctx, errors } = await newPage(null);
  await page.goto(`${base()}/login.html`);
  const html = await page.content();
  assert.doesNotMatch(html, /register|forgot|sign ?up/i);
  await page.fill("#username", "teacher_one"); await page.fill("#password", "secret123"); await page.click("#submit");
  await page.waitForURL("**/teacher/dashboard.html");
  await page.waitForSelector(".tile");
  assert.match(await page.textContent("body"), /Total Students/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("guard: teacher opening an admin page is redirected to the teacher dashboard", async () => {
  const { page, ctx } = await newPage("teacher");
  await page.goto(`${base()}/login.html`); // seed storage origin
  await page.goto(`${base()}/admin/teachers.html`);
  await page.waitForURL("**/teacher/dashboard.html", { timeout: 8000 });
  await ctx.close();
});

test("guard: no session -> login page", async () => {
  const { page, ctx } = await newPage(null);
  await page.goto(`${base()}/teacher/attendance.html`);
  await page.waitForURL("**/login.html");
  await ctx.close();
});

test("attendance: default present, toggle absent, confirm, payload + success message", async () => {
  const { page, ctx, errors } = await newPage("teacher");
  await page.goto(`${base()}/teacher/attendance.html`);
  await page.waitForSelector(".att-row");
  assert.equal(await page.locator(".att-row").count(), 5);
  assert.equal(await page.locator(".seg-present.on").count(), 5);       // all present by default
  assert.equal(await page.locator("#cA").textContent(), "0");
  saved = null; assert.equal(saved, null);                              // nothing auto-saved
  await page.locator(".att-row").nth(1).locator(".seg-absent").click();
  await page.locator(".att-row").nth(4).locator(".seg-absent").click();
  assert.equal(await page.locator("#cA").textContent(), "2");
  assert.equal(await page.locator("#cP").textContent(), "3");
  await page.click("#save");
  await page.waitForSelector(".modal.show");
  assert.match(await page.textContent(".modal.show"), /Total/);
  await page.click(".modal.show [data-ok]");
  await page.waitForSelector("text=Attendance Saved Successfully!");
  assert.equal(saved.p_records.length, 5);
  assert.deepEqual(saved.p_records.filter((r) => r.status === "absent").map((r) => r.student_id), [students[1].id, students[4].id]);
  assert.equal(saved.p_class_id, CLASS_ONE);
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const w of [360, 390, 430, 768, 1280]) {
  test(`no horizontal overflow at ${w}px (login, teacher dashboard, attendance, reports, admin dashboard)`, async () => {
    const { page, ctx } = await newPage(null, w);
    await page.goto(`${base()}/login.html`); assert.ok((await overflow(page)) <= 0, "login overflow");
    await ctx.close();
    for (const [who, path] of [["teacher", "teacher/dashboard.html"], ["teacher", "teacher/attendance.html"], ["teacher", "teacher/reports.html"], ["admin", "admin/dashboard.html"], ["admin", "admin/teachers.html"], ["admin", "admin/students.html"]]) {
      const t = await newPage(who, w);
      await t.page.goto(`${base()}/login.html`);
      await t.page.goto(`${base()}/${path}`);
      await t.page.waitForSelector(".page", { timeout: 8000 });
      await t.page.waitForTimeout(500);
      assert.ok((await overflow(t.page)) <= 0, `${path} overflows at ${w}px by ${await overflow(t.page)}px`);
      await t.ctx.close();
    }
  });
}

test("touch targets on attendance rows are at least 44px", async () => {
  const { page, ctx } = await newPage("teacher", 360);
  await page.goto(`${base()}/teacher/attendance.html`);
  await page.waitForSelector(".seg-btn");
  const box = await page.locator(".seg-btn").first().boundingBox();
  assert.ok(box.height >= 44 && box.width >= 44, JSON.stringify(box));
  await ctx.close();
});

test("reports: monthly + daily render, PDF and Excel downloads are produced", async () => {
  const { page, ctx, errors } = await newPage("teacher");
  await page.goto(`${base()}/teacher/reports.html?kind=monthly`);
  await page.click("#go");
  await page.waitForSelector("#pdf");
  assert.match(await page.textContent("body"), /Ali Ahmed/);
  for (const [sel, ext] of [["#pdf", ".pdf"], ["#xls", ".xlsx"]]) {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click(sel)]);
    assert.ok(dl.suggestedFilename().endsWith(ext), dl.suggestedFilename());
    const path = await dl.path();
    const head = readFileSync(path).subarray(0, 4).toString("latin1");
    assert.ok(ext === ".pdf" ? head === "%PDF" : head.startsWith("PK"), "bad file header " + head);
  }
  await page.click("#kD"); await page.click("#go"); await page.waitForSelector("#pdf");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#pdf")]);
  assert.ok(dl.suggestedFilename().includes("daily"));
  assert.deepEqual(errors, []);
  await ctx.close();
});
