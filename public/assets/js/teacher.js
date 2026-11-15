import { guard } from "./auth.js";
import { mountShell } from "./layout.js";
import { classSummary } from "./data.js";
import { loading, errorBox } from "./ui.js";
import { todayKarachi, percent, formatPercent } from "./util.js";

export async function teacherDashboard() {
  const profile = await guard("teacher");
  const root = mountShell(profile, "dashboard", `Class ${profile.classes?.name ?? ""}`);
  root.innerHTML = loading();
  try {
    const rows = await classSummary(todayKarachi());           // RLS returns only this teacher's class
    const c = rows.find((r) => r.class_id === profile.assigned_class_id) || { total_students: 0, present: 0, absent: 0, recorded: false };
    const pct = c.recorded ? percent(c.present, c.present + c.absent) : null;
    const cards = [["attendance.html", "bi-check2-square", "Mark Attendance"], ["history.html", "bi-clock-history", "View Attendance"],
                   ["students.html", "bi-people-fill", "My Students"], ["reports.html?kind=monthly", "bi-file-earmark-bar-graph-fill", "Monthly Report"]];
    root.innerHTML = `
      <div class="row g-2 mb-3">
        <div class="col-6 col-md-3"><div class="stat-card"><div class="stat-val">${c.total_students}</div><div class="stat-lbl">Total Students</div></div></div>
        <div class="col-6 col-md-3"><div class="stat-card"><div class="stat-val text-success">${c.recorded ? c.present : "—"}</div><div class="stat-lbl">Present Today</div></div></div>
        <div class="col-6 col-md-3"><div class="stat-card"><div class="stat-val text-danger">${c.recorded ? c.absent : "—"}</div><div class="stat-lbl">Absent Today</div></div></div>
        <div class="col-6 col-md-3"><div class="stat-card"><div class="stat-val">${formatPercent(pct)}</div><div class="stat-lbl">Attendance</div></div></div>
      </div>
      ${c.recorded ? "" : `<div class="alert alert-warning"><i class="bi bi-exclamation-circle me-1"></i>Today's attendance has not been marked yet.</div>`}
      <div class="row g-3">${cards.map(([href, icon, label]) => `<div class="col-6 col-md-3"><a href="${href}" class="tile"><i class="bi ${icon}"></i><span>${label}</span></a></div>`).join("")}</div>`;
  } catch (e) { root.innerHTML = errorBox(e.message); }
}
