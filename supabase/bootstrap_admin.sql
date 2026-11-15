-- ONE-TIME: provision the first administrator. No password is stored in this file.
--
-- 1. Supabase Dashboard > Authentication > Users > "Add user" > "Create new user"
--    Email:    <username>@gpskg.app   (e.g. admin@gpskg.app; domain = EMAIL_DOMAIN)
--    Password: choose a strong one yourself. Tick "Auto Confirm User".
-- 2. Copy the new user's UUID, then run this in the SQL editor, replacing the placeholders:

insert into public.profiles (id, full_name, username, role, assigned_class_id, is_active)
values ('00000000-0000-0000-0000-000000000000',   -- <-- the admin's auth user UUID
        'School Administrator',                   -- <-- display name
        'admin',                                  -- <-- must equal the email's local part
        'admin', null, true);

-- Changing the ADMIN's own password later (the credential guard blocks it by default):
--   select public.grant_credential_change('<admin uuid>');
--   then within 30 seconds: Dashboard > Authentication > Users > (user) > Reset password.
