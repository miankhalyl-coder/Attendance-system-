import { guard } from "./auth.js";
import { mountShell } from "./layout.js";
import { loadClasses, loadEligibleStudents, loadAttendanceFor, saveAttendance, classHistory } from "./data.js";
import { confirmDialog, toast, loading, empty, errorBox, classOptions, escapeHtml, setBusy } from "./ui.js";
import { todayKarachi, formatDate, padRoll } from "./util.js";

// Mark / edit attendance. Used by admin (any class) and teachers (own class, fixed).
export async function attendancePage(role) {
  const profile = await guard(role);
  const root = mountShell(profile, "attendance", role === "admin" ? "Attendance" : "Mark Attendance");
  const isAdmin = role === "admin";
  const today = todayKarachi();
  const params = new URLSearchParams(location.search);
  let classes = [];
  try { classes = await loadClasses(); } catch (e) { root.innerHTML = errorBox(e.message); return; }

  let classId = isAdmin ? (params.get("class") || "") : profile.assigned_class_id;
  let date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "") && params.get("date") <= today ? params.get("date") : today;
  let students = [], status = {}, hadExisting = false, saving = false;

  root.innerHTML = `
    <div class="card-app p-3 mb-3"><div class="row g-2 align-items-end">
      <div class="col-12 col-sm-6">${isAdmin
        ? `<label class="form-label mb-1">Class</label><select id="cls" class="form-select form-select-lg">${classOptions(classes, classId, "Select class")}</select>`
        : `<label class="form-label mb-1">Class</label><div class="form-control form-control-lg bg-light">${escapeHtml(profile.classes?.name)}</div>`}</div>
      <div class="col-12 col-sm-6"><label class="form-label mb-1">Date</label><input id="dt" type="date" max="${today}" value="${date}" class="form-control form-control-lg"></div>
    </div></div>
    <div id="sheet"></div>`;
  const sheet = root.querySelector("#sheet");

  const counts = () => {
    const absent = students.filter((s) => status[s.id] === "absent").length;
    return { total: students.length, absent, present: students.length - absent };
  };

  function paintCounts() {
    const c = counts();
    root.querySelector("#cP").textContent = c.present;
    root.querySelector("#cA").textContent = c.absent;
  }

  function render() {
    if (!classId) { sheet.innerHTML = empty("bi-collection", "Select a class to begin."); return; }
    if (!students.length) { sheet.innerHTML = empty("bi-people", "No active students in this class for the selected date."); return; }
    sheet.innerHTML = `
      ${hadExisting
        ? `<div class="alert alert-info py-2"><i class="bi bi-info-circle me-1"></i>Saved attendance for ${formatDate(date)} is loaded. Changes are only stored when you press Save.</div>`
        : `<div class="alert alert-light border py-2"><i class="bi bi-lightbulb me-1"></i>Everyone is <b>Present</b>. Tap <b>Absent</b> for students who are away, then Save.</div>`}
      <div class="card-app mb-3">${students.map((s) => `
        <div class="att-row" data-id="${s.id}">
          <div class="att-roll">${padRoll(s.roll_number)}</div>
          <div class="att-name">${escapeHtml(s.full_name)}</div>
          <div class="seg" role="group" aria-label="Status for ${escapeHtml(s.full_name)}">
            <button type="button" class="seg-btn seg-present ${status[s.id] === "present" ? "on" : ""}" data-s="present" aria-pressed="${status[s.id] === "present"}">Present</button>
            <button type="button" class="seg-btn seg-absent ${status[s.id] === "absent" ? "on" : ""}" data-s="absent" aria-pressed="${status[s.id] === "absent"}">Absent</button>
          </div></div>`).join("")}</div>
      <div class="save-bar"><div class="container-app d-flex align-items-center gap-3">
        <div class="flex-grow-1 small"><div><b>${students.length}</b> students</div>
          <div><span class="text-success fw-semibold">Present <span id="cP"></span></span> · <span class="text-danger fw-semibold">Absent <span id="cA"></span></span></div></div>
        <button id="allP" class="btn btn-light btn-touch d-none d-sm-inline-block">All present</button>
        <button id="save" class="btn btn-primary btn-lg px-4"><i class="bi bi-check2-circle me-1"></i>Save Attendance</button>
      </div></div><div class="save-spacer"></div>`;
    paintCounts();
  }

  async function load() {
    if (!classId) { students = []; render(); return; }
    sheet.innerHTML = loading("Loading students…");
    try {
      students = await loadEligibleStudents(classId, date);
      const existing = await loadAttendanceFor(students.map((s) => s.id), date);
      hadExisting = existing.length > 0;
      status = Object.fromEntries(students.map((s) => [s.id, "present"]));   // default PRESENT, never auto-saved
      existing.forEach((r) => { status[r.student_id] = r.status; });
      render();
    } catch (e) { sheet.innerHTML = errorBox(e.message); }
  }

  sheet.addEventListener("click", async (e) => {
    const seg = e.target.closest(".seg-btn");
    if (seg) {
      const row = seg.closest(".att-row"), id = row.dataset.id;
      status[id] = seg.dataset.s;
      row.querySelectorAll(".seg-btn").forEach((b) => { const on = b.dataset.s === status[id]; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
      paintCounts(); return;
    }
    if (e.target.closest("#allP")) { students.forEach((s) => { status[s.id] = "present"; }); render(); return; }
    const saveBtn = e.target.closest("#save");
    if (saveBtn && !saving) {
      const c = counts();
      const ok = await confirmDialog({ title: hadExisting ? "Update attendance?" : "Save attendance?", confirmText: "Save",
        body: `<p class="mb-2">${escapeHtml(classes.find((x) => x.id === classId)?.name ?? "")} · ${formatDate(date)}</p>
               <div class="row text-center g-2"><div class="col-4"><div class="mini-stat">${c.total}<small>Total</small></div></div>
               <div class="col-4"><div class="mini-stat text-success">${c.present}<small>Present</small></div></div>
               <div class="col-4"><div class="mini-stat text-danger">${c.absent}<small>Absent</small></div></div></div>` });
      if (!ok) return;
      saving = true; setBusy(saveBtn, true);
      try {
        const res = await saveAttendance(classId, date, students.map((s) => ({ student_id: s.id, status: status[s.id] })));
        saving = false; hadExisting = true;
        sheet.innerHTML = `<div class="card-app p-4 text-center">
          <i class="bi bi-check-circle-fill text-success" style="font-size:3.5rem"></i>
          <h2 class="h4 mt-2">Attendance Saved Successfully!</h2>
          <div class="text-muted mb-3">${formatDate(date)}</div>
          <div class="row g-2 text-center mb-4"><div class="col-4"><div class="mini-stat">${res.total}<small>Total Students</small></div></div>
            <div class="col-4"><div class="mini-stat text-success">${res.present}<small>Present</small></div></div>
            <div class="col-4"><div class="mini-stat text-danger">${res.absent}<small>Absent</small></div></div></div>
          <button id="again" class="btn btn-primary btn-lg">Review / edit</button></div>`;
        sheet.querySelector("#again").onclick = load;
        toast("Attendance Saved Successfully!");
      } catch (ex) { saving = false; setBusy(saveBtn, false); toast(ex.message, "error"); }
    }
  });

  root.querySelector("#dt").onchange = (e) => {
    const v = e.target.value;
    if (!v || v > today) { e.target.value = date; return toast("Choose today or an earlier date.", "error"); }
    date = v; load();
  };
  const clsSel = root.querySelector("#cls");
  if (clsSel) clsSel.onchange = () => { classId = clsSel.value; load(); };
  load();
}

// Teacher: list of recorded days with totals; tap one to open it in the editor.
export async function historyPage() {
  const profile = await guard("teacher");
  const root = mountShell(profile, "history", "Attendance History");
  root.innerHTML = loading();
  try {
    const to = todayKarachi();
    const from = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const rows = await classHistory(profile.assigned_class_id, from, to);
    root.innerHTML = rows.length ? `<p class="text-muted small">Last 90 days. Tap a day to view or edit.</p>
      <div class="card-app">${rows.map((r) => `
        <a class="hist-row" href="attendance.html?date=${r.attendance_date}">
          <div class="fw-semibold">${formatDate(r.attendance_date)}</div>
          <div class="small"><span class="text-success">${r.present} present</span> · <span class="text-danger">${r.absent} absent</span></div>
          <i class="bi bi-chevron-right text-muted"></i></a>`).join("")}</div>`
      : empty("bi-clock-history", "No attendance has been recorded in the last 90 days.");
  } catch (e) { root.innerHTML = errorBox(e.message); }
}
