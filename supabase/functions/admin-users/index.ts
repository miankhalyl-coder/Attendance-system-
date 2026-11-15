// Privileged account management. Runs server-side with the service-role key
// (injected by Supabase, never shipped to the browser). Every call is verified:
// the caller's JWT must belong to an ACTIVE admin profile.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const EMAIL_DOMAIN = Deno.env.get("EMAIL_DOMAIN") ?? "gpskg.app"; // must match public/assets/js/config.js
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkPassword(p: unknown): string {
  if (typeof p !== "string" || p.length < 8 || p.length > 72) {
    throw new HttpError(400, "Password must be 8 to 72 characters.");
  }
  return p;
}
function checkName(n: unknown): string {
  if (typeof n !== "string" || n.trim().length < 2 || n.length > 100) throw new HttpError(400, "Enter the teacher's full name.");
  return n.trim();
}
function checkUuid(v: unknown, label: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(400, `Invalid ${label}.`);
  return v;
}

async function requireAdmin(req: Request): Promise<string> {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new HttpError(401, "Not signed in.");
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Session expired. Sign in again.");
  const { data: p } = await admin.from("profiles").select("role,is_active").eq("id", data.user.id).maybeSingle();
  if (!p || p.role !== "admin" || !p.is_active) throw new HttpError(403, "Administrator access required.");
  return data.user.id;
}

async function audit(actor: string, action: string, entityId: string, newValues: Record<string, unknown>) {
  await admin.from("audit_logs").insert({ user_id: actor, action, entity_type: "teacher_account", entity_id: entityId, new_values: newValues });
}

// Issue a 30-second single-use grant so the DB credential guard lets this change through.
async function withGrant(userId: string, fn: () => Promise<{ error: { message: string } | null }>) {
  const g = await admin.rpc("grant_credential_change", { p_user_id: userId });
  if (g.error) throw new HttpError(500, "Could not authorise credential change.");
  const { error } = await fn();
  if (error) throw new HttpError(400, error.message);
}

async function getTeacher(id: string) {
  const { data } = await admin.from("profiles").select("id,role,username").eq("id", id).maybeSingle();
  if (!data || data.role !== "teacher") throw new HttpError(404, "Teacher not found.");
  return data;
}

async function createTeacher(actor: string, b: Record<string, unknown>) {
  const full_name = checkName(b.full_name);
  const username = String(b.username ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, "Username: 3-30 characters, letters, numbers, dot or underscore.");
  const password = checkPassword(b.password);
  const class_id = checkUuid(b.class_id, "class");

  const { data: cls } = await admin.from("classes").select("id").eq("id", class_id).maybeSingle();
  if (!cls) throw new HttpError(400, "Selected class does not exist.");
  const { data: dup } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (dup) throw new HttpError(409, "That username is already taken.");

  const { data: created, error } = await admin.auth.admin.createUser({
    email: `${username}@${EMAIL_DOMAIN}`, password, email_confirm: true,
  });
  if (error || !created.user) throw new HttpError(400, error?.message ?? "Could not create account.");

  const { error: pErr } = await admin.from("profiles").insert({
    id: created.user.id, full_name, username, role: "teacher", assigned_class_id: class_id, is_active: true,
  });
  if (pErr) {
    await admin.auth.admin.deleteUser(created.user.id); // roll back the auth user
    throw new HttpError(pErr.code === "23505" ? 409 : 400, pErr.code === "23505" ? "That username is already taken." : pErr.message);
  }
  await audit(actor, "teacher_created", created.user.id, { username, full_name, class_id });
  return { id: created.user.id };
}

async function resetPassword(actor: string, b: Record<string, unknown>) {
  const id = checkUuid(b.user_id, "teacher");
  const password = checkPassword(b.password);
  await getTeacher(id);
  await withGrant(id, () => admin.auth.admin.updateUserById(id, { password }));
  await audit(actor, "teacher_password_reset", id, {});
  return { ok: true };
}

async function updateTeacher(actor: string, b: Record<string, unknown>) {
  const id = checkUuid(b.user_id, "teacher");
  const full_name = checkName(b.full_name);
  const class_id = checkUuid(b.class_id, "class");
  await getTeacher(id);
  const { error } = await admin.from("profiles").update({ full_name, assigned_class_id: class_id }).eq("id", id);
  if (error) throw new HttpError(400, error.message);
  await audit(actor, "teacher_updated", id, { full_name, class_id });
  return { ok: true };
}

async function setActive(actor: string, b: Record<string, unknown>) {
  const id = checkUuid(b.user_id, "teacher");
  if (typeof b.is_active !== "boolean") throw new HttpError(400, "is_active must be true or false.");
  await getTeacher(id);
  const { error } = await admin.from("profiles").update({ is_active: b.is_active }).eq("id", id);
  if (error) throw new HttpError(400, error.message);
  // Ban at the Auth level too, so existing sessions can no longer refresh and sign-in fails.
  const { error: bErr } = await admin.auth.admin.updateUserById(id, { ban_duration: b.is_active ? "none" : "876000h" });
  if (bErr) throw new HttpError(500, bErr.message);
  await audit(actor, b.is_active ? "teacher_activated" : "teacher_deactivated", id, {});
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const actor = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "create_teacher": return json(await createTeacher(actor, body));
      case "reset_password": return json(await resetPassword(actor, body));
      case "update_teacher": return json(await updateTeacher(actor, body));
      case "set_active": return json(await setActive(actor, body));
      default: throw new HttpError(400, "Unknown action.");
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Unexpected server error." }, 500);
  }
});
