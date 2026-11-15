import { guard } from "./auth.js";
import { mountShell } from "./layout.js";
import { loadClasses, dailyReport, monthlyReport } from "./data.js";
import { toast, loading, empty, errorBox, classOptions, escapeHtml, setBusy } from "./ui.js";
import { todayKarachi, formatDate, formatPercent, percent, padRoll, MONTHS, monthLabel, slug } from "./util.js";

const STATUS_LABEL = { present: "Present", absent: "Absent", null: "Not recorded" };

// ---- report model -------------------------------------------------------
function buildDaily(rows) {
  const recorded = rows.filter((r) => r.status);
  const present = recorded.filter((r) => r.status === "present").length;
  const absent = recorded.length - present;
  return { total: recorded.length, present, absent, pct: percent(present, recorded.length), notRecorded: rows.length - recorded.length };
}
function buildMonthly(rows) {
  const present = rows.reduce((a, r) => a + r.present_days, 0);
  const absent = rows.reduce((a, r) => a + r.absent_days, 0);
  return { students: rows.length, present, absent, total: present + absent, pct: percent(present, present + absent) };
}

// ---- exports --------------------------------------------------------------
function exportPdf(rep) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(7, 85, 201); doc.rect(0, 0, W, 28, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text("GPS KOTLI GHASI", W / 2, 13, { align: "center" });
  doc.setFontSize(12); doc.setFont("helvetica", "normal"); doc.text(rep.kind === "monthly" ? "Monthly Attendance Report" : "Daily Attendance Report", W / 2, 21, { align: "center" });
  doc.setTextColor(23, 32, 51); doc.setFontSize(10);
  const meta = [["School", "GPS Kotli Ghasi"], ["Class", rep.className],
    rep.kind === "monthly" ? ["Month", monthLabel(rep.year, rep.month)] : ["Date", formatDate(rep.date)],
    ["Generated", `${formatDate(todayKarachi())} (Asia/Karachi)`]];
  meta.forEach(([k, v], i) => { doc.setFont("helvetica", "bold"); doc.text(`${k}:`, 14, 37 + i * 6); doc.setFont("helvetica", "normal"); doc.text(String(v), 40, 37 + i * 6); });

  const multi = rep.allClasses;
  const head = rep.kind === "monthly"
    ? [["Roll", "Student", ...(multi ? ["Class"] : []), "Present", "Absent", "Total", "%"]]
    : [["Roll", "Student", ...(multi ? ["Class"] : []), "Status"]];
  const body = rep.rows.map((r) => rep.kind === "monthly"
    ? [padRoll(r.roll_number), r.full_name, ...(multi ? [r.class_name] : []), r.present_days, r.absent_days, r.total_days, formatPercent(r.percentage)]
    : [padRoll(r.roll_number), r.full_name, ...(multi ? [r.class_name] : []), STATUS_LABEL[r.status]]);
  doc.autoTable({ head, body, startY: 64, theme: "grid", styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [7, 85, 201] }, alternateRowStyles: { fillColor: [234, 243, 255] },
    columnStyles: rep.kind === "monthly" ? { [head[0].length - 4]: { halign: "right" }, [head[0].length - 3]: { halign: "right" }, [head[0].length - 2]: { halign: "right" }, [head[0].length - 1]: { halign: "right" } } : {},
    didParseCell: (d) => { if (rep.kind === "daily" && d.section === "body" && d.column.index === head[0].length - 1) { d.cell.styles.textColor = d.cell.raw === "Absent" ? [220, 38, 38] : d.cell.raw === "Present" ? [22, 163, 74] : [100, 100, 100]; } } });

  let y = doc.lastAutoTable.finalY + 8;
  if (y > 265) { doc.addPage(); y = 20; }
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text("Summary", 14, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  const s = rep.summary;
  const lines = rep.kind === "monthly"
    ? [`Students: ${s.students}`, `Total present days: ${s.present}`, `Total absent days: ${s.absent}`, `Overall attendance: ${formatPercent(s.pct)}`]
    : [`Total students: ${s.total}`, `Present: ${s.present}`, `Absent: ${s.absent}`, `Attendance: ${formatPercent(s.pct)}`, ...(s.notRecorded ? [`Not recorded: ${s.notRecorded}`] : [])];
  lines.forEach((l, i) => doc.text(l, 14, y + 6 + i * 5.5));

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFontSize(8); doc.setTextColor(120); doc.text(`GPS Kotli Ghasi · Page ${p} of ${pages}`, W / 2, 290, { align: "center" }); }
  doc.save(`${rep.kind}-attendance-${slug(rep.className)}-${rep.kind === "monthly" ? `${rep.year}-${String(rep.month).padStart(2, "0")}` : rep.date}.pdf`);
}

function exportXlsx(rep) {
  const aoa = rep.kind === "monthly"
    ? [["Roll Number", "Student Name", "Class", "Present Days", "Absent Days", "Total Recorded Days", "Attendance Percentage"],
       ...rep.rows.map((r) => [r.roll_number, r.full_name, r.class_name, r.present_days, r.absent_days, r.total_days, r.percentage === null ? "" : Number(r.percentage)])]
    : [["Roll Number", "Student Name", "Class", "Date", "Status"],
       ...rep.rows.map((r) => [r.roll_number, r.full_name, r.class_name, formatDate(rep.date), STATUS_LABEL[r.status]])];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = aoa[0].map((_, i) => ({ wch: i === 1 ? 28 : 16 }));
  XLSX.utils.book_append_sheet(wb, ws, rep.kind === "monthly" ? "Monthly" : "Daily");
  XLSX.writeFile(wb, `${rep.kind}-attendance-${slug(rep.className)}-${rep.kind === "monthly" ? `${rep.year}-${String(rep.month).padStart(2, "0")}` : rep.date}.xlsx`);
}

// ---- page -------------------------------------------------------------------
export async function reportsPage(role) {
  const profile = await guard(role);
  const root = mountShell(profile, "reports", "Reports");
  const isAdmin = role === "admin";
  let classes = [];
  try { classes = await loadClasses(); } catch (e) { root.innerHTML = errorBox(e.message); return; }
  const now = todayKarachi(), [ny, nm] = now.split("-").map(Number);
  const qp = new URLSearchParams(location.search);
  let kind = qp.get("kind") === "monthly" ? "monthly" : "daily";
  let current = null;

  root.innerHTML = `
    <div class="card-app p-3 mb-3">
      <div class="btn-group w-100 mb-3" role="group">
        <button class="btn btn-lg" id="kD">Daily</button><button class="btn btn-lg" id="kM">Monthly</button>
      </div>
      <div class="row g-2 align-items-end">
        <div class="col-12 col-md-4" id="fDaily"><label class="form-label mb-1">Date</label><input id="date" type="date" max="${now}" value="${now}" class="form-control form-control-lg"></div>
        <div class="col-6 col-md-3 d-none" id="fMonth"><label class="form-label mb-1">Month</label><select id="month" class="form-select form-select-lg">${MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === nm ? "selected" : ""}>${m}</option>`).join("")}</select></div>
        <div class="col-6 col-md-2 d-none" id="fYear"><label class="form-label mb-1">Year</label><select id="year" class="form-select form-select-lg">${[ny, ny - 1, ny - 2, ny - 3].map((y) => `<option>${y}</option>`).join("")}</select></div>
        <div class="col-12 col-md-3">${isAdmin
          ? `<label class="form-label mb-1">Class</label><select id="cls" class="form-select form-select-lg">${classOptions(classes, "", "All classes")}</select>`
          : `<label class="form-label mb-1">Class</label><div class="form-control form-control-lg bg-light">${escapeHtml(profile.classes?.name)}</div>`}</div>
        <div class="col-12 col-md-3 d-grid"><button id="go" class="btn btn-primary btn-lg"><i class="bi bi-search me-1"></i>Show report</button></div>
      </div>
    </div>
    <div id="out"></div>`;
  const $ = (s) => root.querySelector(s), out = $("#out");

  const setKind = (k) => {
    kind = k;
    $("#kD").className = `btn btn-lg ${k === "daily" ? "btn-primary" : "btn-outline-primary"}`;
    $("#kM").className = `btn btn-lg ${k === "monthly" ? "btn-primary" : "btn-outline-primary"}`;
    $("#fDaily").classList.toggle("d-none", k !== "daily");
    $("#fMonth").classList.toggle("d-none", k !== "monthly");
    $("#fYear").classList.toggle("d-none", k !== "monthly");
    out.innerHTML = ""; current = null;
  };
  $("#kD").onclick = () => setKind("daily"); $("#kM").onclick = () => setKind("monthly");
  setKind(kind);

  $("#go").onclick = async () => {
    const classId = isAdmin ? $("#cls").value : profile.assigned_class_id;
    const className = classId ? classes.find((c) => c.id === classId)?.name : "All Classes";
    const btn = $("#go"); setBusy(btn, true); out.innerHTML = loading("Preparing report…");
    try {
      if (kind === "daily") {
        const date = $("#date").value;
        if (!date || date > now) throw new Error("Choose today or an earlier date.");
        const rows = await dailyReport(date, classId);
        current = { kind, date, className, allClasses: !classId, rows, summary: buildDaily(rows) };
      } else {
        const month = Number($("#month").value), year = Number($("#year").value);
        if (year * 12 + month > ny * 12 + nm) throw new Error("Future months have no attendance.");
        const rows = await monthlyReport(year, month, classId);
        current = { kind, month, year, className, allClasses: !classId, rows, summary: buildMonthly(rows) };
      }
      draw();
    } catch (e) { current = null; out.innerHTML = errorBox(e.message); }
    finally { setBusy(btn, false); }
  };

  function draw() {
    const r = current, s = r.summary;
    if (!r.rows.length) { out.innerHTML = empty("bi-file-earmark-x", "No students or attendance found for this selection."); return; }
    const stats = r.kind === "monthly"
      ? [["Students", s.students], ["Present days", s.present, "text-success"], ["Absent days", s.absent, "text-danger"], ["Attendance", formatPercent(s.pct)]]
      : [["Total Students", s.total], ["Present", s.present, "text-success"], ["Absent", s.absent, "text-danger"], ["Attendance", formatPercent(s.pct)]];
    const th = r.kind === "monthly" ? "<th class='text-end'>Present</th><th class='text-end'>Absent</th><th class='text-end'>%</th>" : "<th>Status</th>";
    out.innerHTML = `
      <div class="row g-2 mb-3">${stats.map(([k, v, c]) => `<div class="col-6 col-md-3"><div class="stat-card"><div class="stat-val ${c || ""}">${v}</div><div class="stat-lbl">${k}</div></div></div>`).join("")}</div>
      ${r.kind === "daily" && s.notRecorded ? `<div class="alert alert-warning py-2">Attendance has not been recorded for ${s.notRecorded} student(s) on this date.</div>` : ""}
      ${r.kind === "monthly" && !s.total ? `<div class="alert alert-warning py-2">No attendance has been recorded for this month.</div>` : ""}
      <div class="d-grid d-sm-flex gap-2 mb-3"><button id="pdf" class="btn btn-danger btn-lg"><i class="bi bi-file-earmark-pdf me-1"></i>Download PDF</button>
        <button id="xls" class="btn btn-success btn-lg"><i class="bi bi-file-earmark-excel me-1"></i>Download Excel</button></div>
      <div class="card-app"><div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>Roll</th><th>Student</th>${r.allClasses ? "<th>Class</th>" : ""}${th}</tr></thead><tbody>
        ${r.rows.map((x) => `<tr><td>${padRoll(x.roll_number)}</td><td class="fw-semibold">${escapeHtml(x.full_name)}</td>${r.allClasses ? `<td>${escapeHtml(x.class_name)}</td>` : ""}
          ${r.kind === "monthly"
            ? `<td class="text-end text-success">${x.present_days}</td><td class="text-end text-danger">${x.absent_days}</td><td class="text-end">${formatPercent(x.percentage)}</td>`
            : `<td><span class="badge ${x.status === "present" ? "text-bg-success" : x.status === "absent" ? "text-bg-danger" : "text-bg-secondary"}">${STATUS_LABEL[x.status]}</span></td>`}</tr>`).join("")}
        </tbody></table></div></div>`;
    $("#pdf").onclick = () => { try { exportPdf(current); } catch (e) { toast("Could not create the PDF: " + e.message, "error"); } };
    $("#xls").onclick = () => { try { exportXlsx(current); } catch (e) { toast("Could not create the Excel file: " + e.message, "error"); } };
  }
  if (qp.get("auto")) $("#go").click();
}
