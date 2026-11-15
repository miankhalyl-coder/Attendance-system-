import { supabase, friendlyDbError } from "./supabase.js";
import { guard } from "./auth.js";
import { mountShell } from "./layout.js";
import { loadClasses, loadStudents, studentHistory } from "./data.js";
import { formModal, showInfoModal, confirmDialog, toast, loading, empty, errorBox, badge, classOptions, escapeHtml } from "./ui.js";
import { formatDate, padRoll, summarize, formatPercent, todayKarachi } from "./util.js";

function studentForm(s, classes, defaultClass, nextRoll) {
  const v = s || {};
  return `
    <div class="mb-3"><label class="form-label">Student name *</label><input name="full_name" class="form-control form-control-lg" maxlength="100" required value="${escapeHtml(v.full_name)}"></div>
    <div class="mb-3"><label class="form-label">Father's name *</label><input name="father_name" class="form-control form-control-lg" maxlength="100" required value="${escapeHtml(v.father_name)}"></div>
    <div class="row g-3 mb-3">
      <div class="col-6"><label class="form-label">Class *</label><select name="class_id" class="form-select form-select-lg" required>${classOptions(classes, v.class_id || defaultClass, "Select")}</select></div>
      <div class="col-6"><label class="form-label">Roll number *</label><input name="roll_number" type="number" min="1" max="9999" inputmode="numeric" class="form-control form-control-lg" required value="${v.roll_number ?? nextRoll ?? ""}"></div>
    </div>
    <div class="row g-3">
      <div class="col-6"><label class="form-label">Admission no.</label><input name="admission_number" class="form-control form-control-lg" maxlength="30" value="${escapeHtml(v.admission_number)}"></div>
      <div class="col-6"><label class="form-label">Enrollment date *</label><input name="enrollment_date" type="date" max="${todayKarachi()}" class="form-control form-control-lg" required value="${v.enrollment_date || todayKarachi()}"></div>
    </div>`;
}

function readStudent(form) {
  const f = new FormData(form);
  const rec = {
    full_name: String(f.get("full_name")).trim(), father_name: String(f.get("father_name")).trim(),
    class_id: f.get("class_id"), roll_number: Number(f.get("roll_number")),
    admission_number: String(f.get("admission_number") || "").trim() || null, enrollment_date: f.get("enrollment_date"),
  };
  if (rec.full_name.length < 2) throw new Error("Enter the student's name.");
  if (rec.father_name.length < 2) throw new Error("Enter the father's name.");
  if (!rec.class_id) throw new Error("Select a class.");
  if (!Number.isInteger(rec.roll_number) || rec.roll_number < 1) throw new Error("Enter a valid roll number.");
  if (!rec.enrollment_date) throw new Error("Enter the enrollment date.");
  return rec;
}

async function showHistory(s) {
  const modal = showInfoModal(`${s.full_name} — attendance`, loading());
  const body = modal.querySelector(".modal-body");
  try {
    const rows = await studentHistory(s.id);
    const sum = summarize(rows.map((r) => r.status));
    body.innerHTML = `
      <div class="small text-muted mb-2">Father: ${escapeHtml(s.father_name)} · Class ${escapeHtml(s.classes?.name)} · Roll ${padRoll(s.roll_number)} · Enrolled ${formatDate(s.enrollment_date)}</div>
      <div class="row g-2 text-center mb-3">
        <div class="col-3"><div class="mini-stat">${sum.total}<small>Days</small></div></div>
        <div class="col-3"><div class="mini-stat text-success">${sum.present}<small>Present</small></div></div>
        <div class="col-3"><div class="mini-stat text-danger">${sum.absent}<small>Absent</small></div></div>
        <div class="col-3"><div class="mini-stat">${formatPercent(sum.pct)}<small>Attendance</small></div></div>
      </div>
      ${rows.length ? `<div class="table-responsive" style="max-height:40vh"><table class="table table-sm align-middle mb-0"><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${formatDate(r.attendance_date)}</td><td><span class="badge ${r.status === "present" ? "text-bg-success" : "text-bg-danger"}">${r.status === "present" ? "Present" : "Absent"}</span></td></tr>`).join("")}
      </tbody></table></div>` : empty("bi-calendar-x", "No attendance recorded yet.")}`;
  } catch (e) { body.innerHTML = errorBox(e.message); }
}

export async function adminStudents() {
  const profile = await guard("admin");
  const root = mountShell(profile, "students", "Students");
  root.innerHTML = loading();
  let classes, students = [];
  try { classes = await loadClasses(); } catch (e) { root.innerHTML = errorBox(e.message); return; }

  root.innerHTML = `
    <div class="card-app p-3 mb-3">
      <div class="row g-2">
        <div class="col-12 col-md-5"><input id="q" class="form-control form-control-lg" type="search" placeholder="Search name, father, roll…"></div>
        <div class="col-7 col-md-3"><select id="fc" class="form-select form-select-lg">${classOptions(classes, "", "All classes")}</select></div>
        <div class="col-5 col-md-2"><select id="fs" class="form-select form-select-lg"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option></select></div>
        <div class="col-12 col-md-2 d-grid"><button id="add" class="btn btn-primary btn-lg"><i class="bi bi-plus-lg me-1"></i>Add</button></div>
      </div>
    </div>
    <div id="list"></div>`;
  const list = root.querySelector("#list");
  const $ = (id) => root.querySelector(id);

  const render = () => {
    const q = $("#q").value.trim().toLowerCase(), st = $("#fs").value;
    const rows = students.filter((s) =>
      (st === "all" || (st === "active") === s.is_active) &&
      (!q || [s.full_name, s.father_name, String(s.roll_number), s.admission_number || ""].some((x) => x.toLowerCase().includes(q))));
    if (!rows.length) { list.innerHTML = empty("bi-people", students.length ? "No students match your search." : "No students yet. Tap Add to register the first one."); return; }
    list.innerHTML = `<div class="card-app"><div class="table-responsive"><table class="table align-middle mb-0 table-stack">
      <thead><tr><th>Roll</th><th>Student</th><th>Class</th><th>Status</th><th class="text-end">Actions</th></tr></thead><tbody>
      ${rows.map((s) => `<tr>
        <td data-label="Roll">${padRoll(s.roll_number)}</td>
        <td data-label="Student"><div class="fw-semibold">${escapeHtml(s.full_name)}</div><div class="small text-muted">S/O ${escapeHtml(s.father_name)}</div></td>
        <td data-label="Class">${escapeHtml(s.classes?.name)}</td>
        <td data-label="Status">${badge(s.is_active)}</td>
        <td class="text-end text-nowrap actions">
          <button class="btn btn-light btn-touch" data-act="view" data-id="${s.id}" aria-label="View"><i class="bi bi-eye"></i></button>
          <button class="btn btn-light btn-touch" data-act="edit" data-id="${s.id}" aria-label="Edit"><i class="bi bi-pencil"></i></button>
          <button class="btn ${s.is_active ? "btn-outline-danger" : "btn-outline-success"} btn-touch" data-act="toggle" data-id="${s.id}" aria-label="${s.is_active ? "Deactivate" : "Activate"}"><i class="bi ${s.is_active ? "bi-person-dash" : "bi-person-check"}"></i></button>
        </td></tr>`).join("")}
      </tbody></table></div></div>`;
  };

  async function reload() {
    list.innerHTML = loading();
    try {
      const order = Object.fromEntries(classes.map((c) => [c.id, c.sort_order]));
      students = (await loadStudents($("#fc").value)).sort((a, b) => order[a.class_id] - order[b.class_id] || a.roll_number - b.roll_number);
      render();
    } catch (e) { list.innerHTML = errorBox(e.message); }
  }
  const find = (id) => students.find((s) => s.id === id);

  $("#q").oninput = render; $("#fs").onchange = render; $("#fc").onchange = reload;
  $("#add").onclick = () => {
    const cls = $("#fc").value;
    const next = cls ? Math.max(0, ...students.filter((s) => s.class_id === cls).map((s) => s.roll_number)) + 1 : "";
    formModal({ title: "Add student", bodyHtml: studentForm(null, classes, cls, next), submitText: "Add student",
      onSubmit: async (form) => {
        const { error } = await supabase.from("students").insert(readStudent(form));
        if (error) throw new Error(friendlyDbError(error));
        toast("Student added."); reload();
      } });
  };
  list.onclick = async (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const s = find(b.dataset.id); if (!s) return;
    if (b.dataset.act === "view") showHistory(s);
    if (b.dataset.act === "edit") formModal({ title: "Edit student", bodyHtml: studentForm(s, classes), submitText: "Save changes",
      onSubmit: async (form) => {
        const { error } = await supabase.from("students").update(readStudent(form)).eq("id", s.id);
        if (error) throw new Error(friendlyDbError(error));
        toast("Student updated."); reload();
      } });
    if (b.dataset.act === "toggle") {
      const to = !s.is_active;
      const ok = await confirmDialog({ title: to ? "Activate student?" : "Deactivate student?", danger: !to,
        body: to ? `<b>${escapeHtml(s.full_name)}</b> will appear in attendance lists again.`
                 : `<b>${escapeHtml(s.full_name)}</b> will no longer appear in attendance lists. Attendance history is kept.`,
        confirmText: to ? "Activate" : "Deactivate" });
      if (!ok) return;
      const { error } = await supabase.from("students").update({ is_active: to }).eq("id", s.id);
      if (error) return toast(friendlyDbError(error), "error");
      toast(to ? "Student activated." : "Student deactivated."); reload();
    }
  };
  reload();
}

// Read-only list for the class teacher (RLS limits rows to their class).
export async function teacherStudents() {
  const profile = await guard("teacher");
  const root = mountShell(profile, "students", "My Students");
  root.innerHTML = loading();
  try {
    const rows = (await loadStudents(profile.assigned_class_id)).filter((s) => s.is_active);
    root.innerHTML = rows.length ? `<div class="card-app"><div class="table-responsive"><table class="table align-middle mb-0">
      <thead><tr><th>Roll</th><th>Student</th><th>Father</th><th></th></tr></thead><tbody>
      ${rows.map((s) => `<tr><td>${padRoll(s.roll_number)}</td><td class="fw-semibold">${escapeHtml(s.full_name)}</td><td>${escapeHtml(s.father_name)}</td>
        <td class="text-end"><button class="btn btn-light btn-touch" data-id="${s.id}" aria-label="History"><i class="bi bi-clock-history"></i></button></td></tr>`).join("")}
      </tbody></table></div></div>` : empty("bi-people", "No students in your class yet. Ask the administrator to add them.");
    root.onclick = (e) => { const b = e.target.closest("button[data-id]"); if (b) showHistory(rows.find((s) => s.id === b.dataset.id)); };
  } catch (e) { root.innerHTML = errorBox(e.message); }
}
