import { logout } from "./auth.js";
import { escapeHtml } from "./ui.js";
import { todayKarachi, formatDate } from "./util.js";

const NAV = {
  admin: [["dashboard", "Home", "bi-grid-1x2-fill"], ["classes", "Classes", "bi-collection-fill"], ["students", "Students", "bi-people-fill"],
          ["teachers", "Teachers", "bi-person-badge-fill"], ["attendance", "Attendance", "bi-check2-square"], ["reports", "Reports", "bi-file-earmark-bar-graph-fill"]],
  teacher: [["dashboard", "Home", "bi-grid-1x2-fill"], ["attendance", "Mark", "bi-check2-square"], ["history", "History", "bi-clock-history"],
            ["students", "Students", "bi-people-fill"], ["reports", "Reports", "bi-file-earmark-bar-graph-fill"]],
};

// Renders header + navigation and returns the content element for the page.
export function mountShell(profile, active, title) {
  const links = NAV[profile.role].map(([k, label, icon]) =>
    `<a href="${k}.html" class="nav-link-app ${k === active ? "active" : ""}"><i class="bi ${icon}"></i><span>${label}</span></a>`).join("");
  const who = profile.role === "admin"
    ? "Administrator"
    : `${escapeHtml(profile.full_name)} · Class ${escapeHtml(profile.classes?.name ?? "")}`;
  document.body.innerHTML = `
    <header class="app-header">
      <div class="container-app d-flex align-items-center gap-3">
        <div class="brand-mark"><i class="bi bi-mortarboard-fill"></i></div>
        <div class="flex-grow-1 lh-sm" style="min-width:0"><div class="fw-bold">GPS Kotli Ghasi</div><div class="small opacity-75 text-truncate">${who}</div></div>
        <button class="btn btn-light btn-touch" id="logoutBtn" aria-label="Log out"><i class="bi bi-box-arrow-right"></i><span class="d-none d-sm-inline ms-1">Logout</span></button>
      </div>
    </header>
    <nav class="app-nav" aria-label="Main"><div class="container-app nav-inner">${links}</div></nav>
    <main class="container-app page">
      <div class="d-flex justify-content-between align-items-end flex-wrap gap-1 mb-3">
        <h1 class="h4 fw-bold mb-0">${escapeHtml(title)}</h1>
        <div class="text-muted small"><i class="bi bi-calendar3 me-1"></i>${formatDate(todayKarachi())}</div>
      </div>
      <div id="content"></div>
    </main>`;
  document.title = `${title} — GPS Kotli Ghasi`;
  document.getElementById("logoutBtn").onclick = logout;
  return document.getElementById("content");
}
