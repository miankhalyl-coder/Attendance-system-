import { supabase, isConfigured } from "./supabase.js";
import { login, fetchProfile, homeFor } from "./auth.js";
import { validateUsername } from "./util.js";
import { setBusy } from "./ui.js";

const form = document.getElementById("loginForm");
const errBox = document.getElementById("err");
const showErr = (m) => { errBox.textContent = m; errBox.classList.remove("d-none"); };

if (!isConfigured) showErr("This site is not connected to Supabase yet. See README: set SUPABASE_URL and SUPABASE_ANON_KEY.");

// Already signed in? Go straight to the right dashboard.
(async () => {
  if (!isConfigured) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  try { const p = await fetchProfile(session.user.id); if (p?.is_active) location.replace(homeFor(p.role)); } catch { /* stay on login */ }
})();

document.getElementById("togglePw").onclick = (e) => {
  const i = document.getElementById("password");
  i.type = i.type === "password" ? "text" : "password";
  e.currentTarget.firstElementChild.className = i.type === "password" ? "bi bi-eye" : "bi bi-eye-slash";
};

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errBox.classList.add("d-none");
  const username = form.username.value.trim().toLowerCase(), password = form.password.value;
  if (validateUsername(username)) return showErr("Enter your username (letters, numbers, dot or underscore).");
  if (!password) return showErr("Enter your password.");
  const btn = document.getElementById("submit");
  setBusy(btn, true);
  try { const p = await login(username, password); location.replace(homeFor(p.role)); }
  catch (ex) { showErr(ex.message); setBusy(btn, false); }
});
