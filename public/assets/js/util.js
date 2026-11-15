// Pure helpers (no DOM, no network) so they can be unit-tested with Node.
export const TZ = "Asia/Karachi";
export const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export function todayKarachi(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}
export function percent(present, total) {
  return total > 0 ? Math.round((present / total) * 10000) / 100 : null;
}
export function formatPercent(p) {
  if (p === null || p === undefined || Number.isNaN(Number(p))) return "—";
  const n = Number(p);
  return (Number.isInteger(n) ? String(n) : n.toFixed(2)) + "%";
}
export function summarize(statuses) {
  const present = statuses.filter((s) => s === "present").length;
  const absent = statuses.filter((s) => s === "absent").length;
  const total = present + absent;
  return { total, present, absent, pct: percent(present, total) };
}
export function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function usernameToEmail(username, domain) {
  return `${String(username).trim().toLowerCase()}@${domain}`;
}
export function validateUsername(u) {
  return /^[a-z0-9_.]{3,30}$/.test(String(u).trim().toLowerCase())
    ? null : "Username: 3-30 characters, letters, numbers, dot or underscore.";
}
export function validatePassword(p) {
  return typeof p === "string" && p.length >= 8 && p.length <= 72 ? null : "Password must be 8 to 72 characters.";
}
export function padRoll(n) { return String(n).padStart(2, "0"); }
export function monthLabel(year, month) { return `${MONTHS[month - 1]} ${year}`; }
export function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
