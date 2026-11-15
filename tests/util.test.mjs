import { test } from "node:test";
import assert from "node:assert/strict";
import { todayKarachi, formatDate, percent, formatPercent, summarize, escapeHtml, usernameToEmail, validateUsername, validatePassword, padRoll, monthLabel } from "../public/assets/js/util.js";

test("todayKarachi uses Asia/Karachi (UTC+5), not UTC", () => {
  assert.equal(todayKarachi(new Date("2026-03-10T20:30:00Z")), "2026-03-11"); // 01:30 next day in Karachi
  assert.equal(todayKarachi(new Date("2026-03-10T18:59:00Z")), "2026-03-10");
});
test("date format is DD-MM-YYYY", () => { assert.equal(formatDate("2026-03-09"), "09-03-2026"); assert.equal(formatDate(null), ""); });
test("attendance percentage matches the spec examples", () => {
  assert.equal(percent(22, 24), 91.67);
  assert.equal(percent(24, 24), 100);
  assert.equal(percent(20, 24), 83.33);
  assert.equal(percent(0, 0), null);
  assert.equal(formatPercent(91.67), "91.67%");
  assert.equal(formatPercent(100), "100%");
  assert.equal(formatPercent(null), "—");
});
test("summarize counts present/absent", () => {
  assert.deepEqual(summarize(["present", "present", "absent", "present"]), { total: 4, present: 3, absent: 1, pct: 75 });
});
test("escapeHtml prevents injection", () => { assert.equal(escapeHtml(`<img src=x onerror="a">'`), "&lt;img src=x onerror=&quot;a&quot;&gt;&#39;"); });
test("username/password validation", () => {
  assert.equal(validateUsername("teacher_one"), null);
  assert.ok(validateUsername("ab")); assert.ok(validateUsername("has space")); assert.ok(validateUsername("a@b.com"));
  assert.equal(validatePassword("12345678"), null); assert.ok(validatePassword("short"));
  assert.equal(usernameToEmail(" Teacher_One ", "gpskg.app"), "teacher_one@gpskg.app");
});
test("misc formatting", () => { assert.equal(padRoll(3), "03"); assert.equal(monthLabel(2026, 2), "February 2026"); });
