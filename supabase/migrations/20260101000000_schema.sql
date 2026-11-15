-- GPS Kotli Ghasi Attendance Management System
-- Schema, constraints, RLS, RPCs, credential guard, seed classes.
-- Run in order via `supabase db push` or paste into the Supabase SQL editor.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------- tables
create table public.classes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int  not null unique,
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text not null check (length(trim(full_name)) > 0),
  username          text not null unique check (username ~ '^[a-z0-9_.]{3,30}$'),
  role              text not null check (role in ('admin','teacher')),
  assigned_class_id uuid references public.classes(id) on delete restrict,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  constraint role_class_consistency check (
    (role = 'teacher' and assigned_class_id is not null) or
    (role = 'admin'   and assigned_class_id is null))
);

create table public.students (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null check (length(trim(full_name)) > 0),
  father_name      text not null check (length(trim(father_name)) > 0),
  roll_number      int  not null check (roll_number > 0),
  admission_number text,
  class_id         uuid not null references public.classes(id) on delete restrict,
  enrollment_date  date not null default ((now() at time zone 'Asia/Karachi')::date),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- Roll numbers are unique inside a class among ACTIVE students (a deactivated
-- student's number can be reused; history is kept against the student id).
create unique index students_class_roll_active_uq
  on public.students (class_id, roll_number) where is_active;
create unique index students_admission_uq
  on public.students (admission_number) where admission_number is not null;
create index students_class_idx on public.students (class_id);

create table public.attendance (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.students(id) on delete restrict,
  attendance_date date not null,
  status          text not null check (status in ('present','absent')),
  marked_by       uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint attendance_student_date_uq unique (student_id, attendance_date)
);
create index attendance_date_idx on public.attendance (attendance_date);

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  old_values  jsonb,
  new_values  jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------- seed
insert into public.classes (name, sort_order) values
  ('ECCE',1),('Nursery',2),('One',3),('Two',4),('Three',5),('Four',6),('Five',7)
on conflict (name) do nothing;

-- ---------------------------------------------------------------- helpers
-- Identity/role always come from auth.uid() + the protected profiles table.
create function public.app_role() returns text
  language sql stable security definer set search_path = '' as
$$ select role from public.profiles where id = auth.uid() and is_active $$;

create function public.app_class_id() returns uuid
  language sql stable security definer set search_path = '' as
$$ select assigned_class_id from public.profiles where id = auth.uid() and is_active $$;

create function public.app_is_admin() returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce((select role = 'admin' from public.profiles
                    where id = auth.uid() and is_active), false) $$;

revoke execute on function public.app_role(), public.app_class_id(), public.app_is_admin()
  from public, anon;
grant execute on function public.app_role(), public.app_class_id(), public.app_is_admin()
  to authenticated, service_role;

-- ---------------------------------------------------------------- triggers
create function private.touch_updated_at() returns trigger
  language plpgsql set search_path = '' as
$$ begin new.updated_at = now(); return new; end $$;

create trigger students_touch before update on public.students
  for each row execute function private.touch_updated_at();
create trigger attendance_touch before update on public.attendance
  for each row execute function private.touch_updated_at();

create function private.audit_row() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  insert into public.audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
  values (auth.uid(), lower(tg_op), tg_table_name,
          coalesce(new.id, old.id)::text,
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger students_audit after insert or update on public.students
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------- credential guard
-- Supabase Auth lets any signed-in user change their own password/email through
-- the Auth API. Hiding the UI cannot stop that, so we block it in the database:
-- any change to auth.users.encrypted_password / email is rejected unless the
-- admin Edge Function has just issued a short-lived, single-use grant.
create table private.credential_change_grants (
  user_id    uuid primary key,
  expires_at timestamptz not null
);

create function public.grant_credential_change(p_user_id uuid) returns void
  language sql security definer set search_path = '' as
$$ insert into private.credential_change_grants (user_id, expires_at)
   values (p_user_id, now() + interval '30 seconds')
   on conflict (user_id) do update set expires_at = excluded.expires_at $$;
revoke execute on function public.grant_credential_change(uuid) from public, anon, authenticated;
grant  execute on function public.grant_credential_change(uuid) to service_role;

create function private.guard_credential_change() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  delete from private.credential_change_grants
   where user_id = old.id and expires_at > now();
  if not found then
    raise exception 'Credential changes are restricted to the administrator'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_credential_change
  before update on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password
        or old.email is distinct from new.email)
  execute function private.guard_credential_change();

-- ---------------------------------------------------------------- RLS
alter table public.classes    enable row level security;
alter table public.profiles   enable row level security;
alter table public.students   enable row level security;
alter table public.attendance enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.classes, public.profiles, public.students,
              public.attendance, public.audit_logs from anon, authenticated;
grant select on public.classes, public.profiles, public.attendance, public.audit_logs to authenticated;
grant select, insert, update on public.students to authenticated;   -- no DELETE: deactivate only

create policy classes_select on public.classes for select to authenticated
  using (public.app_is_admin() or id = public.app_class_id());

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.app_is_admin());
-- No client-side write policies on profiles: accounts are managed only by the
-- admin Edge Function (service role). Teachers cannot change role/class/anything.

create policy students_select on public.students for select to authenticated
  using (public.app_is_admin() or class_id = public.app_class_id());
create policy students_insert on public.students for insert to authenticated
  with check (public.app_is_admin());
create policy students_update on public.students for update to authenticated
  using (public.app_is_admin()) with check (public.app_is_admin());

create policy attendance_select on public.attendance for select to authenticated
  using (public.app_is_admin() or exists (
    select 1 from public.students s
    where s.id = attendance.student_id and s.class_id = public.app_class_id()));
-- No direct write policies on attendance: all writes go through save_attendance().

create policy audit_select on public.audit_logs for select to authenticated
  using (public.app_is_admin());

-- ---------------------------------------------------------------- RPC: save attendance (atomic)
create function public.save_attendance(p_class_id uuid, p_date date, p_records jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_uid     uuid := auth.uid();
  v_role    text;
  v_class   uuid;
  v_today   date := (now() at time zone 'Asia/Karachi')::date;
  v_present int;
  v_absent  int;
  v_changes jsonb;
  v_cname   text;
begin
  select role, assigned_class_id into v_role, v_class
    from public.profiles where id = v_uid and is_active;
  if v_role is null then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_role <> 'admin' and v_class is distinct from p_class_id then
    raise exception 'You can only save attendance for your own class' using errcode = '42501';
  end if;
  if p_date is null or p_date > v_today then
    raise exception 'Attendance cannot be recorded for a future date' using errcode = '22023';
  end if;
  if p_records is null or jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) = 0 then
    raise exception 'No attendance records supplied' using errcode = '22023';
  end if;

  if exists (select 1 from jsonb_to_recordset(p_records) r(student_id uuid, status text)
             where r.student_id is null or r.status is null or r.status not in ('present','absent')) then
    raise exception 'Invalid attendance record' using errcode = '22023';
  end if;
  if (select count(distinct r.student_id) from jsonb_to_recordset(p_records) r(student_id uuid, status text))
     <> jsonb_array_length(p_records) then
    raise exception 'Duplicate students in submission' using errcode = '22023';
  end if;

  -- Submission must cover exactly the active, already-enrolled students of the class.
  if exists (
       select 1 from jsonb_to_recordset(p_records) r(student_id uuid, status text)
       where not exists (select 1 from public.students s
                         where s.id = r.student_id and s.class_id = p_class_id
                           and s.is_active and s.enrollment_date <= p_date))
     or exists (
       select 1 from public.students s
       where s.class_id = p_class_id and s.is_active and s.enrollment_date <= p_date
         and not exists (select 1 from jsonb_to_recordset(p_records) r(student_id uuid, status text)
                         where r.student_id = s.id)) then
    raise exception 'Student list is out of date. Reload and try again.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('student_id', r.student_id, 'old', a.status, 'new', r.status)), '[]'::jsonb)
    into v_changes
    from jsonb_to_recordset(p_records) r(student_id uuid, status text)
    left join public.attendance a on a.student_id = r.student_id and a.attendance_date = p_date
   where a.status is distinct from r.status;

  insert into public.attendance (student_id, attendance_date, status, marked_by)
  select r.student_id, p_date, r.status, v_uid
    from jsonb_to_recordset(p_records) r(student_id uuid, status text)
  on conflict (student_id, attendance_date) do update
    set status = excluded.status, marked_by = excluded.marked_by, updated_at = now()
    where public.attendance.status is distinct from excluded.status;

  select count(*) filter (where r.status = 'present'), count(*) filter (where r.status = 'absent')
    into v_present, v_absent
    from jsonb_to_recordset(p_records) r(student_id uuid, status text);

  select name into v_cname from public.classes where id = p_class_id;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
  values (v_uid, 'attendance_saved', 'attendance', p_class_id::text, null,
          jsonb_build_object('class_name', v_cname, 'date', p_date, 'present', v_present,
                             'absent', v_absent, 'total', v_present + v_absent,
                             'changes', v_changes));

  return jsonb_build_object('total', v_present + v_absent, 'present', v_present, 'absent', v_absent);
end $$;
revoke execute on function public.save_attendance(uuid, date, jsonb) from public, anon;
grant  execute on function public.save_attendance(uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------- RPC: reports (RLS applies: security invoker)
create function public.class_summary(p_date date)
returns table (class_id uuid, class_name text, total_students int, present int, absent int,
               teacher_names text, recorded boolean)
language sql stable security invoker set search_path = '' as
$$
  select c.id, c.name,
         (select count(*)::int from public.students s where s.class_id = c.id and s.is_active),
         (select count(*)::int from public.attendance a join public.students s on s.id = a.student_id
           where s.class_id = c.id and a.attendance_date = p_date and a.status = 'present'),
         (select count(*)::int from public.attendance a join public.students s on s.id = a.student_id
           where s.class_id = c.id and a.attendance_date = p_date and a.status = 'absent'),
         (select string_agg(p.full_name, ', ' order by p.full_name) from public.profiles p
           where p.assigned_class_id = c.id and p.role = 'teacher' and p.is_active),
         exists (select 1 from public.attendance a join public.students s on s.id = a.student_id
                  where s.class_id = c.id and a.attendance_date = p_date)
  from public.classes c order by c.sort_order
$$;

create function public.daily_report(p_date date, p_class_id uuid default null)
returns table (student_id uuid, roll_number int, full_name text, class_id uuid, class_name text, status text)
language sql stable security invoker set search_path = '' as
$$
  select s.id, s.roll_number, s.full_name, c.id, c.name, a.status
  from public.students s
  join public.classes c on c.id = s.class_id
  left join public.attendance a on a.student_id = s.id and a.attendance_date = p_date
  where (p_class_id is null or s.class_id = p_class_id)
    and p_date <= (now() at time zone 'Asia/Karachi')::date
    and ((s.is_active and s.enrollment_date <= p_date) or a.id is not null)
  order by c.sort_order, s.roll_number
$$;

-- Percentage = present / recorded days. Only days with a saved record count;
-- future dates and dates before the student's enrolment are ignored.
create function public.monthly_report(p_year int, p_month int, p_class_id uuid default null)
returns table (student_id uuid, roll_number int, full_name text, class_id uuid, class_name text,
               present_days int, absent_days int, total_days int, percentage numeric)
language sql stable security invoker set search_path = '' as
$$
  select s.id, s.roll_number, s.full_name, c.id, c.name,
         (count(a.id) filter (where a.status = 'present'))::int,
         (count(a.id) filter (where a.status = 'absent'))::int,
         count(a.id)::int,
         case when count(a.id) = 0 then null
              else round(100.0 * count(a.id) filter (where a.status = 'present') / count(a.id), 2) end
  from public.students s
  join public.classes c on c.id = s.class_id
  left join public.attendance a
         on a.student_id = s.id
        and a.attendance_date >= make_date(p_year, p_month, 1)
        and a.attendance_date <  (make_date(p_year, p_month, 1) + interval '1 month')::date
        and a.attendance_date >= s.enrollment_date
        and a.attendance_date <= (now() at time zone 'Asia/Karachi')::date
  where (p_class_id is null or s.class_id = p_class_id)
  group by s.id, c.id
  having s.is_active or count(a.id) > 0
  order by c.sort_order, s.roll_number
$$;

create function public.class_history(p_class_id uuid, p_from date, p_to date)
returns table (attendance_date date, total int, present int, absent int)
language sql stable security invoker set search_path = '' as
$$
  select a.attendance_date, count(*)::int,
         (count(*) filter (where a.status = 'present'))::int,
         (count(*) filter (where a.status = 'absent'))::int
  from public.attendance a join public.students s on s.id = a.student_id
  where s.class_id = p_class_id and a.attendance_date between p_from and p_to
  group by a.attendance_date order by a.attendance_date desc
$$;

revoke execute on function public.class_summary(date), public.daily_report(date, uuid),
  public.monthly_report(int, int, uuid), public.class_history(uuid, date, date) from public, anon;
grant execute on function public.class_summary(date), public.daily_report(date, uuid),
  public.monthly_report(int, int, uuid), public.class_history(uuid, date, date) to authenticated;
