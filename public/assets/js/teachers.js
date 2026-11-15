import { supabase, callAdminFn, friendlyDbError } from "./supabase.js";
import { guard } from "./auth.js";
import { mountShell } from "./layout.js";
import { loadClasses } from "./data.js";
import { formModal, showInfoModal, confirmDialog, toast, loading, empty, errorBox, badge, classOptions, escapeHtml } from "./ui.js";
import { validateUsername, validatePassword, formatDate } from "./util.js";

const passwordField = (label = "Password *") => `
  <div class="mb-3"><label class="form-label">${label}</label>
    <div class="input-group"><input name="password" type="password" class="form-control form-control-lg" minlength="8" maxlength="72" autocomplete="new-password" required>
    <button class="btn btn-outline-secondary btn-touch" type="button" data-toggle-pw aria-label="Show password"><i class="bi bi-eye"></i></button></div>
    <div class="form-text">At least 8 characters. Share it with the teacher privately.</div></div>`;

function wirePasswordToggle(form) {
  form.querySelectorAll("[data-toggle-pw]").forEach((b) => b.addEventListener("click", () => {
    const i = b.closest(".input-group").querySelector("input");
    i.type = i.type === "password" ? "text" : "password";
    b.firstElementChild.className = i.type === "password" ? "bi bi-eye" : "bi bi-eye-slash";
  }));
}

export async function adminTeachers() {
  const profile = await guard("admin");
  const root = mountShell(profile, "teachers", "Teachers");
  root.innerHTML = loading();
  let classes, teachers = [];
  try { classes = await loadClasses(); } catch (e) { root.innerHTML = errorBox(e.message); return; }

  root.innerHTML = `<div class="d-grid d-sm-flex justify-content-sm-end mb-3"><button id="add" class="btn btn-primary btn-lg"><i class="bi bi-person-plus me-1"></i>Create teacher</button></div><div id="list"></div>`;
  const list = root.querySelector("#list");

  const render = () => {
    if (!teachers.length) { list.innerHTML = empty("bi-person-badge", "No teachers yet. Create the first teacher account."); return; }
    list.innerHTML = `<div class="card-app"><div class="table-responsive"><table class="table align-middle mb-0 table-stack">
      <thead><tr><th>Teacher</th><th>Username</th><th>Class</th><th>Status</th><th class="text-end">Actions</th></tr></thead><tbody>
      ${teachers.map((t) => `<tr>
        <td data-label="Teacher" class="fw-semibold">${escapeHtml(t.full_name)}</td>
        <td data-label="Username"><code>${escapeHtml(t.username)}</code></td>
        <td data-label="Class">${escapeHtml(t.classes?.name)}</td>
        <td data-label="Status">${badge(t.is_active)}</td>
        <td class="text-end text-nowrap actions">
          <button class="btn btn-light btn-touch" data-act="view" data-id="${t.id}" aria-label="View"><i class="bi bi-eye"></i></button>
          <button class="btn btn-light btn-touch" data-act="edit" data-id="${t.id}" aria-label="Edit"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-light btn-touch" data-act="pw" data-id="${t.id}" aria-label="Reset password"><i class="bi bi-key"></i></button>
          <button class="btn ${t.is_active ? "btn-outline-danger" : "btn-outline-success"} btn-touch" data-act="toggle" data-id="${t.id}" aria-label="${t.is_active ? "Deactivate" : "Activate"}"><i class="bi ${t.is_active ? "bi-person-dash" : "bi-person-check"}"></i></button>
        </td></tr>`).join("")}
      </tbody></table></div></div>`;
  };

  async function reload() {
    list.innerHTML = loading();
    const { data, error } = await supabase.from("profiles").select("id,full_name,username,is_active,created_at,assigned_class_id,classes:assigned_class_id(name)")
      .eq("role", "teacher").order("full_name");
    if (error) { list.innerHTML = errorBox(friendlyDbError(error)); return; }
    teachers = data; render();
  }

  root.querySelector("#add").onclick = () => {
    const m = formModal({ title: "Create teacher account", submitText: "Create account",
      bodyHtml: `
        <div class="mb-3"><label class="form-label">Full name *</label><input name="full_name" class="form-control form-control-lg" maxlength="100" required></div>
        <div class="mb-3"><label class="form-label">Username *</label><input name="username" class="form-control form-control-lg" maxlength="30" autocapitalize="none" autocomplete="off" required>
          <div class="form-text">Lowercase letters, numbers, dot or underscore.</div></div>
        ${passwordField()}
        <div class="mb-1"><label class="form-label">Assigned class *</label><select name="class_id" class="form-select form-select-lg" required>${classOptions(classes, "", "Select class")}</select></div>`,
      onSubmit: async (form) => {
        const f = new FormData(form);
        const username = String(f.get("username")).trim().toLowerCase();
        const err = validateUsername(username) || validatePassword(f.get("password"));
        if (err) throw new Error(err);
        if (!f.get("class_id")) throw new Error("Select a class.");
        if (String(f.get("full_name")).trim().length < 2) throw new Error("Enter the teacher's name.");
        await callAdminFn({ action: "create_teacher", full_name: f.get("full_name"), username, password: f.get("password"), class_id: f.get("class_id") });
        toast("Teacher account created."); reload();
      } });
    wirePasswordToggle(m.form);
  };

  list.onclick = async (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const t = teachers.find((x) => x.id === b.dataset.id); if (!t) return;
    if (b.dataset.act === "view") showInfoModal("Teacher information", `<dl class="row mb-0">
      <dt class="col-5">Name</dt><dd class="col-7">${escapeHtml(t.full_name)}</dd>
      <dt class="col-5">Username</dt><dd class="col-7"><code>${escapeHtml(t.username)}</code></dd>
      <dt class="col-5">Class</dt><dd class="col-7">${escapeHtml(t.classes?.name)}</dd>
      <dt class="col-5">Status</dt><dd class="col-7">${badge(t.is_active)}</dd>
      <dt class="col-5">Created</dt><dd class="col-7">${formatDate(t.created_at)}</dd></dl>`);
    if (b.dataset.act === "edit") formModal({ title: "Edit teacher", submitText: "Save changes",
      bodyHtml: `<div class="mb-3"><label class="form-label">Full name *</label><input name="full_name" class="form-control form-control-lg" maxlength="100" required value="${escapeHtml(t.full_name)}"></div>
        <div class="mb-1"><label class="form-label">Assigned class *</label><select name="class_id" class="form-select form-select-lg" required>${classOptions(classes, t.assigned_class_id)}</select></div>
        <div class="form-text">Username cannot be changed.</div>`,
      onSubmit: async (form) => {
        const f = new FormData(form);
        if (String(f.get("full_name")).trim().length < 2) throw new Error("Enter the teacher's name.");
        await callAdminFn({ action: "update_teacher", user_id: t.id, full_name: f.get("full_name"), class_id: f.get("class_id") });
        toast("Teacher updated."); reload();
      } });
    if (b.dataset.act === "pw") {
      const m = formModal({ title: `Reset password — ${t.full_name}`, submitText: "Reset password", bodyHtml: passwordField("New password *"),
        onSubmit: async (form) => {
          const pw = new FormData(form).get("password");
          const err = validatePassword(pw); if (err) throw new Error(err);
          await callAdminFn({ action: "reset_password", user_id: t.id, password: pw });
          toast("Password reset.");
        } });
      wirePasswordToggle(m.form);
    }
    if (b.dataset.act === "toggle") {
      const to = !t.is_active;
      const ok = await confirmDialog({ title: to ? "Activate account?" : "Deactivate account?", danger: !to, confirmText: to ? "Activate" : "Deactivate",
        body: to ? `<b>${escapeHtml(t.full_name)}</b> will be able to log in again.` : `<b>${escapeHtml(t.full_name)}</b> will be signed out and unable to log in.` });
      if (!ok) return;
      try { await callAdminFn({ action: "set_active", user_id: t.id, is_active: to }); toast(to ? "Account activated." : "Account deactivated."); reload(); }
      catch (ex) { toast(ex.message, "error"); }
    }
  };
  reload();
}
