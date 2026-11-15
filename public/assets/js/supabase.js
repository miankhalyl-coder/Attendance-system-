import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const isConfigured = !SUPABASE_URL.includes("YOUR-PROJECT-REF");
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// Calls the privileged admin-users Edge Function and surfaces its error message.
export async function callAdminFn(body) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    let msg = "Request failed. Please try again.";
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data;
}

export function friendlyDbError(e) {
  const m = e?.message || "";
  const d = m + " " + (e?.details || "");
  if (e?.code === "23505" && /roll/.test(d)) return "That roll number is already used by an active student in this class.";
  if (e?.code === "23505" && /admission/.test(d)) return "That admission number already exists.";
  if (e?.code === "42501" || /row-level|permission/i.test(m)) return "You do not have permission to do that.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Network problem. Check your connection and try again.";
  return m || "Something went wrong. Please try again.";
}
