import { supabase, friendlyDbError } from "./supabase.js";

// Thin query helpers. RLS decides what each role actually receives.
async function run(q) {
  const { data, error } = await q;
  if (error) throw new Error(friendlyDbError(error));
  return data;
}
export const loadClasses = () => run(supabase.from("classes").select("id,name,sort_order").order("sort_order"));
export const classSummary = (date) => run(supabase.rpc("class_summary", { p_date: date }));
export const dailyReport = (date, classId) => run(supabase.rpc("daily_report", { p_date: date, p_class_id: classId || null }));
export const monthlyReport = (year, month, classId) => run(supabase.rpc("monthly_report", { p_year: year, p_month: month, p_class_id: classId || null }));
export const classHistory = (classId, from, to) => run(supabase.rpc("class_history", { p_class_id: classId, p_from: from, p_to: to }));
export const saveAttendance = (classId, date, records) => run(supabase.rpc("save_attendance", { p_class_id: classId, p_date: date, p_records: records }));

export const loadStudents = (classId) => {
  let q = supabase.from("students").select("*, classes:class_id(name)").order("class_id").order("roll_number");
  if (classId) q = q.eq("class_id", classId);
  return run(q);
};
export const loadEligibleStudents = (classId, date) =>
  run(supabase.from("students").select("id,full_name,roll_number")
    .eq("class_id", classId).eq("is_active", true).lte("enrollment_date", date).order("roll_number"));
export const loadAttendanceFor = (studentIds, date) =>
  studentIds.length ? run(supabase.from("attendance").select("student_id,status").eq("attendance_date", date).in("student_id", studentIds)) : Promise.resolve([]);
export const studentHistory = (studentId) =>
  run(supabase.from("attendance").select("attendance_date,status").eq("student_id", studentId).order("attendance_date", { ascending: false }).limit(400));
