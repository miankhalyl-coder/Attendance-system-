# GPS Kotli Ghasi — Attendance Management System

Mobile-first attendance app: static frontend (HTML/CSS/ES modules, Bootstrap 5) on Vercel, Supabase (Postgres, Auth, RLS, one Edge Function) as the backend. Free-tier friendly; no application server.

```
public/                 static site (Vercel output directory)
  login.html, index.html
  admin/*.html          dashboard, classes, students, teachers, attendance, reports
  teacher/*.html        dashboard, students, attendance, history, reports
  assets/css, assets/js (auth, data, attendance, students, teachers, reports, admin, teacher, util, ui, layout, config)
supabase/
  migrations/           schema + RLS + RPCs + credential guard + class seed
  functions/admin-users Edge Function (service role; account create/reset/disable)
  seed.sql, bootstrap_admin.sql, config.toml
scripts/build-config.mjs  writes public/assets/js/config.js from env at build time
tests/                  db.rls.test.mjs, util.test.mjs, ui/ui.mock.test.mjs
```

## 1. Password policy: what Supabase can and cannot enforce (read first)

Requirement: only the administrator may set or change passwords.

* **Hiding the button is not enough.** Any signed-in Supabase user can call `supabase.auth.updateUser({ password })` with their own session. There is no Auth setting that disables this per role.
* **What this project does instead:** a database trigger (`guard_credential_change` on `auth.users`) rejects any change to `encrypted_password` or `email` unless the admin Edge Function has just created a 30-second, single-use grant via `grant_credential_change()` (executable only by `service_role`). The Edge Function does so only after verifying the caller is an active admin. A teacher calling `updateUser` gets `Credential changes are restricted to the administrator`.
* The trigger is verified against a real Postgres in `tests/db.rls.test.mjs` (blocked without grant, allowed with it, single use, teachers cannot self-grant). **Still to verify once on your hosted project** (step 7 below): hosted GoTrue talks to `auth.users` as its own DB role, so run the "teacher tries to change own password" check on the live project.
* Consequences: resetting the *admin's* own password from the Supabase dashboard also needs a grant first (see `supabase/bootstrap_admin.sql`). If a future Supabase release rewrites `encrypted_password` on login (hash upgrade), that sign-in would fail; the dashboard test in step 7 catches this.
* Teachers also cannot change their email (same trigger). Usernames map to `username@EMAIL_DOMAIN` (default `gpskg.app`); no real email is ever sent.

## 2. Create the Supabase project (free tier)

1. https://supabase.com → New project. Save the database password in a password manager (never in git).
2. **Authentication → Providers → Email**: keep enabled, **turn OFF "Confirm email"**, and **turn OFF "Allow new users to sign up"** (Authentication → Sign In / Providers → "Allow new users to sign up"). This makes public registration impossible.
3. Note **Project URL** and **anon key** (Project Settings → API). Never use the `service_role` key in the frontend.

## 3. Run the migration

Option A — SQL editor: paste `supabase/migrations/20260101000000_schema.sql` and run.
Option B — CLI: `npm i -g supabase`, `supabase login`, `supabase link --project-ref <ref>`, `supabase db push`.

This creates tables, constraints, RLS, report/attendance RPCs, the credential guard, and seeds the 7 classes (ECCE, Nursery, One–Five).

## 4. Deploy the Edge Function

```
supabase functions deploy admin-users
supabase secrets set EMAIL_DOMAIN=gpskg.app ALLOWED_ORIGIN=https://<your-vercel-domain>
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase automatically. `verify_jwt` is on and the function additionally requires an **active admin** profile.

## 5. Provision the first admin

Follow `supabase/bootstrap_admin.sql` (create the Auth user in the dashboard with a password you choose, then insert the profile row with its UUID). No password is stored in the repo.

## 6. GitHub → Vercel

1. `git init && git add . && git commit -m "Initial commit"`, create a GitHub repo, push.
2. Vercel → Add New Project → import the repo. Framework preset: **Other**. `vercel.json` already sets build command and `public` output directory.
3. Environment Variables (Production + Preview): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `EMAIL_DOMAIN`. Deploy.
4. The build fails on purpose if the variables are missing or the key is a service-role/secret key.
5. Local preview: copy values into `public/assets/js/config.js` (do not commit real keys if you prefer) or `SUPABASE_URL=… SUPABASE_ANON_KEY=… npm run build`, then `npx serve public`.

## 7. Post-deploy verification (do once)

1. Log in as admin → Teachers → create a teacher (username, password, class).
2. In another browser log in as the teacher. In the console run `await (await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm')).createClient(URL, ANON).auth.updateUser(...)` after signing in, or simpler: use the app's Supabase client; expect the error above. Confirm the teacher still logs in afterwards.
3. As the teacher, try `/admin/students.html` (redirects) and query another class via the console (returns 0 rows).
4. Admin resets the teacher's password; the teacher logs in with the new one.

## 8. Tests

```
npm install
npm test            # DB/RLS (PGlite), unit, and mocked-API browser tests
```
`tests/ui` needs Google Chrome or Edge installed (path is set at the top of the file).

## 9. Free-tier limits and notes

* Supabase free projects pause after ~1 week of inactivity (resume from the dashboard) and have DB/auth/Edge Function quotas; Vercel Hobby is for non-commercial use. Verify current terms before relying on them for a school.
* Free Supabase has no automatic point-in-time backups: export the database periodically.
* Dates use Asia/Karachi for "today" in both the database and the UI; display format DD-MM-YYYY.
* CDN libraries (Bootstrap, Chart.js, jsPDF, SheetJS, supabase-js) are pinned to exact versions on jsDelivr; the site needs internet access to load them.

## 10. Security summary

| Control | Where |
|---|---|
| RLS on all 5 tables; no client write policies on `profiles`, `attendance`, `audit_logs`, `classes` | migration |
| Teachers: select only own class's students/attendance; `students` writes admin-only | policies `students_*`, `attendance_select` |
| Role/class always derived from `auth.uid()` + `profiles` (never from the browser) | `app_role()`, `app_class_id()` |
| Atomic bulk save, class/date/roster validation, no future dates | `save_attendance()` (single transaction) |
| Unique `(student_id, attendance_date)`; unique active roll per class; no student hard delete (`ON DELETE RESTRICT`, no DELETE grant) | constraints |
| Admin-only credential changes | `guard_credential_change` trigger + Edge Function |
| Deactivated account: `is_active=false` removes all data access immediately; Auth ban blocks sign-in | RLS helpers + `set_active` |
| Service-role key only inside Edge Functions; build script rejects service/secret keys | `build-config.mjs` |
| Audit trail: student changes, attendance saves (with per-student diffs), account actions | `audit_logs` (admin read) |
