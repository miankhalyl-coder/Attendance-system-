import { escapeHtml } from "./util.js";
export { escapeHtml };

export function toast(message, type = "success") {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    box.className = "toast-container position-fixed top-0 end-0 p-3";
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = `toast align-items-center text-bg-${type === "error" ? "danger" : "success"} border-0`;
  el.setAttribute("role", "alert");
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${escapeHtml(message)}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
  box.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: type === "error" ? 6000 : 3000 });
  el.addEventListener("hidden.bs.toast", () => el.remove());
  t.show();
}

export function confirmDialog({ title, body, confirmText = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.tabIndex = -1;
    wrap.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">${escapeHtml(title)}</h5><button class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-footer"><button class="btn btn-light btn-touch" data-bs-dismiss="modal">Cancel</button>
      <button class="btn ${danger ? "btn-danger" : "btn-primary"} btn-touch" data-ok>${escapeHtml(confirmText)}</button></div></div></div>`;
    document.body.appendChild(wrap);
    const m = new bootstrap.Modal(wrap);
    let ok = false;
    wrap.querySelector("[data-ok]").onclick = () => { ok = true; m.hide(); };
    wrap.addEventListener("hidden.bs.modal", () => { wrap.remove(); resolve(ok); });
    m.show();
  });
}

// Generic form modal. onSubmit(form) may throw Error(msg) to show an inline error.
export function formModal({ title, bodyHtml, submitText = "Save", onSubmit }) {
  const wrap = document.createElement("div");
  wrap.className = "modal fade";
  wrap.tabIndex = -1;
  wrap.innerHTML = `<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable"><form class="modal-content" novalidate>
    <div class="modal-header"><h5 class="modal-title">${escapeHtml(title)}</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
    <div class="modal-body">${bodyHtml}<div class="alert alert-danger d-none mt-3 mb-0" data-err role="alert"></div></div>
    <div class="modal-footer"><button type="button" class="btn btn-light btn-touch" data-bs-dismiss="modal">Cancel</button>
    <button type="submit" class="btn btn-primary btn-touch">${escapeHtml(submitText)}</button></div></form></div>`;
  document.body.appendChild(wrap);
  const m = new bootstrap.Modal(wrap);
  const form = wrap.querySelector("form");
  const err = wrap.querySelector("[data-err]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.classList.add("d-none");
    const btn = form.querySelector("[type=submit]");
    setBusy(btn, true);
    try { await onSubmit(form); m.hide(); }
    catch (ex) { err.textContent = ex.message || "Could not save."; err.classList.remove("d-none"); }
    finally { setBusy(btn, false); }
  });
  wrap.addEventListener("hidden.bs.modal", () => wrap.remove());
  m.show();
  return { wrap, form };
}

export function showInfoModal(title, html) {
  const wrap = document.createElement("div");
  wrap.className = "modal fade";
  wrap.tabIndex = -1;
  wrap.innerHTML = `<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable"><div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">${escapeHtml(title)}</h5><button class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
    <div class="modal-body">${html}</div></div></div>`;
  document.body.appendChild(wrap);
  const m = new bootstrap.Modal(wrap);
  wrap.addEventListener("hidden.bs.modal", () => wrap.remove());
  m.show();
  return wrap;
}

export function setBusy(btn, busy) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Please wait…`;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

export const loading = (text = "Loading…") => `<div class="state-box"><div class="spinner-border text-primary mb-2"></div><div>${escapeHtml(text)}</div></div>`;
export const empty = (icon, text) => `<div class="state-box"><i class="bi ${icon} fs-1 text-muted"></i><div class="mt-2">${escapeHtml(text)}</div></div>`;
export const errorBox = (text) => `<div class="alert alert-danger" role="alert"><i class="bi bi-exclamation-triangle me-2"></i>${escapeHtml(text)}</div>`;
export const badge = (active) => `<span class="badge ${active ? "text-bg-success" : "text-bg-secondary"}">${active ? "Active" : "Inactive"}</span>`;
export function classOptions(classes, selected = "", placeholder = "") {
  return (placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : "") +
    classes.map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
}
