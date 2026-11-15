// Public configuration. The anon key is safe in the browser (access is enforced by RLS).
// NEVER put the service-role key here. On Vercel this file is regenerated at build time
// from SUPABASE_URL / SUPABASE_ANON_KEY (see scripts/build-config.mjs).
export const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
export const EMAIL_DOMAIN = "gpskg.app"; // must match the Edge Function EMAIL_DOMAIN
