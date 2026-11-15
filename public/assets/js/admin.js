import { supabase, friendlyDbError } from "./supabase.js";
import { guard } from "./auth.js";
import { mountShell } from "./layout.js";
import { classSummary } from "./data.js";
import { loading, empty, errorBox, escapeHtml } from "./ui.js";
import { todayKarachi, formatDate, formatPercent, percent } from "./util.js";

export async function adminDashboard() {
  const profile = await guard("admin");
  const root = mountShell(profile, "dashboard", "Dashboard");
  root.innerHTML = loading();
  const today = todayKarachi();
  try {
    const [summary, teachers, recent, names] = await Promise.all([
      classSummary(today),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "teacher").eq("is_active", true),
      supabase.from("audit_logs").select("user_id,created_at,new_values").eq("action", "attendance_saved").order("created_at", { ascending: false }).limit(6),
      supabase.from("profiles").select("id,full_name"),
    ]);
    if (teachers.error) throw new Error(friendlyDbError(teachers.error));
    const nameOf = Object.fromEntries((names.data || []).map((p) => [p.id, p.full_name]));
    const total = summary.reduce((a, c) => a + c.total_students, 0);
    const present = summary.reduce((a, c) => a + c.present, 0);
    const absent = summary.reduce((a, c) => a + c.absent, 0);
    const pct = percent(present, present + absent);
    const stats = [["Students", total, "bi-people-fill"], ["Classes", summary.length, "bi-collection-fill"], ["Teachers", teachers.count ?? 0, "bi-person-badge-fill"],
      ["Present today", present, "bi-check-circle-fill", "text-success"], ["Absent today", absent, "bi-x-circle-fill", "text-danger"], ["Attendance", formatPercent(pct), "bi-percent"]];

    root.innerHTML = `
      <div class="row g-2 mb-3">${stats.map(([k, v, i, c]) => `<div class="col-6 col-md-4 col-lg-2"><div class="stat-card"><i class="bi ${i} ${c || "text-primary"}"></i><div class="stat-val ${c || ""}">${v}</div><div class="stat-lbl">${k}</div></div></div>`).join("")}</div>
      <div class="row g-3 mb-3">
        <div class="col-12 col-lg-7"><div class="card-app p-3 h-100"><h2 class="h6 fw-bold mb-3">Today's attendance by class</h2>
          ${present + absent ? `<div class="chart-box"><canvas id="chart"></canvas></div>` : empty("bi-bar-chart", "No attendance recorded yet today.")}</div></div>
        <div class="col-12 col-lg-5"><div class="card-app p-3 h-100"><h2 class="h6 fw-bold mb-3">Quick actions</h2>
          <div class="d-grid gap-2">
            <a class="btn btn-primary btn-lg text-start" href="students.html"><i class="bi bi-person-plus me-2"></i>Add Student</a>
            <a class="btn btn-primary btn-lg text-start" href="teachers.html"><i class="bi bi-person-badge me-2"></i>Create Teacher</a>
            <a class="btn btn-primary btn-lg text-start" href="attendance.html"><i class="bi bi-check2-square me-2"></i>Mark / View Attendance</a>
            <a class="btn btn-primary btn-lg text-start" href="reports.html"><i class="bi bi-file-earmark-bar-graph me-2"></i>Generate Report</a>
          </div></div></div>
      </div>
      <div class="row g-3">
        <div class="col-12 col-lg-7"><div class="card-app"><div class="p-3 pb-0"><h2 class="h6 fw-bold">Class-wise summary</h2></div><div class="table-responsive"><table class="table align-middle mb-0">
          <thead><tr><th>Class</th><th class="text-end">Students</th><th class="text-end">Present</th><th class="text-end">Absent</th></tr></thead><tbody>
          ${summary.map((c) => `<tr><td><a href="attendance.html?class=${c.class_id}" class="fw-semibold text-decoration-none">${escapeHtml(c.class_name)}</a></td><td class="text-end">${c.total_students}</td>
            <td class="text-end text-success">${c.recorded ? c.present : "—"}</td><td class="text-end text-danger">${c.recorded ? c.absent : "—"}</td></tr>`).join("")}
          </tbody></table></div></div></div>
        <div class="col-12 col-lg-5"><div class="card-app p-3 h-100"><h2 class="h6 fw-bold mb-3">Recently recorded</h2>
          ${recent.data?.length ? recent.data.map((r) => `<div class="recent-row"><div><div class="fw-semibold">Class ${escapeHtml(r.new_values.class_name)} · ${formatDate(r.new_values.date)}</div>
            <div class="small text-muted">${escapeHtml(nameOf[r.user_id] || "Unknown")} · ${r.new_values.present} present, ${r.new_values.absent} absent</div></div></div>`).join("")
            : empty("bi-clock-history", "Nothing recorded yet.")}</div></div>
      </div>`;

    if (present + absent && window.Chart) {
      new Chart(root.querySelector("#chart"), {
        type: "bar",
        data: { labels: summary.map((c) => c.class_name), datasets: [
          { label: "Present", data: summary.map((c) => c.present), backgroundColor: "#16A34A", borderRadius: 4 },
          { label: "Absent", data: summary.map((c) => c.absent), backgroundColor: "#DC2626", borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: "bottom" } } },
      });
    }
  } catch (e) { root.innerHTML = errorBox(e.message); }
}

export async function adminClasses() {
  const profile = await guard("admin");
  const root = mountShell(profile, "classes", "Classes");
  root.innerHTML = loading();
  try {
    const rows = await classSummary(todayKarachi());
    root.innerHTML = `<p class="text-muted small">Teachers are assigned to classes from the <a href="teachers.html">Teachers</a> page.</p>
      <div class="row g-3">${rows.map((c) => `<div class="col-12 col-md-6 col-lg-4"><div class="card-app p-3 h-100">
        <div class="d-flex justify-content-between align-items-start"><h2 class="h5 fw-bold mb-1">${escapeHtml(c.class_name)}</h2>
          <a class="btn btn-light btn-touch" href="attendance.html?class=${c.class_id}" aria-label="Open attendance"><i class="bi bi-check2-square"></i></a></div>
        <div class="text-muted small mb-3"><i class="bi bi-person-badge me-1"></i>${c.teacher_names ? escapeHtml(c.teacher_names) : "No teacher assigned"}</div>
        <div class="row text-center g-2"><div class="col-4"><div class="mini-stat">${c.total_students}<small>Students</small></div></div>
          <div class="col-4"><div class="mini-stat text-success">${c.recorded ? c.present : "—"}<small>Present</small></div></div>
          <div class="col-4"><div class="mini-stat text-danger">${c.recorded ? c.absent : "—"}<small>Absent</small></div></div></div>
        ${c.recorded ? "" : `<div class="small text-muted mt-2">Not recorded today</div>`}</div></div>`).join("")}</div>`;
  } catch (e) { root.innerHTML = errorBox(e.message); }
}
