import { supabase } from "./supabase.js";
import { EMAIL_DOMAIN } from "./config.js";
import { usernameToEmail } from "./util.js";

// URLs are resolved against this module so they work from /, /admin/ and /teacher/.
const abs = (p) => new URL(`../../${p}`, import.meta.url).href;
export const homeFor = (role) => abs(role === "admin" ? "admin/dashboard.html" : "teacher/dashboard.html");

export async function fetchProfile(uid) {
  const { data, error } = await supabase.from("profiles")
    .select("id, full_name, username, role, assigned_class_id, is_active, classes:assigned_class_id(name)")
    .eq("id", uid).maybeSingle();
  if (error) throw error;
  return data;
}

export async function login(username, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username, EMAIL_DOMAIN), password });
  if (error) {
    if (/banned/i.test(error.message)) throw new Error("This account has been disabled. Contact the administrator.");
    if (/fetch|network/i.test(error.message)) throw new Error("Network problem. Check your connection and try again.");
    throw new Error("Incorrect username or password.");
  }
  const profile = await fetchProfile(data.user.id);
  if (!profile) { await supabase.auth.signOut(); throw new Error("This account is not set up for the school system."); }
  if (!profile.is_active) { await supabase.auth.signOut(); throw new Error("This account has been disabled. Contact the administrator."); }
  return profile;
}

export async function logout() {
  await supabase.auth.signOut();
  location.href = abs("login.html");
}

const never = () => new Promise(() => {});

// Page guard. Frontend routing is only a convenience: RLS enforces the real rules.
export async function guard(requiredRole) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.replace(abs("login.html")); return never(); }
  let profile = null;
  try { profile = await fetchProfile(session.user.id); } catch { /* treated as unauthorised */ }
  if (!profile || !profile.is_active) { await supabase.auth.signOut(); location.replace(abs("login.html")); return never(); }
  if (requiredRole && profile.role !== requiredRole) { location.replace(homeFor(profile.role)); return never(); }
  return profile;
}
