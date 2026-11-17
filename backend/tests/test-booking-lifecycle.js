#!/usr/bin/env node
/**
 * test-booking-lifecycle.js — 班次／預約生命週期狀態機 + 自動收尾（2026-11-17）
 *
 * 覆蓋：
 *  1) 狀態轉換白名單（session / booking）
 *  2) 自動收尾：完結班次 → completed、attended → completed_at
 *  3) confirmed 唔會被自動改（no-show／罰款維持原路徑）
 *  4) 過期 pending_payment（未聲稱付款）→ cancelled 並釋放名額
 *  5) 寬限分鐘設定（session_finalize_grace_minutes）
 *  6) 重複執行 idempotent（第二次 0 班）
 *  7) 非法轉換 → 409 code
 *  8) 冇改動任何金錢表（wallet_transactions / coach_earnings 數目不變）
 */
const os = require("os");
const path = require("path");

const TMP = path.join(os.tmpdir(), "zenpass-life-" + Date.now() + ".db");
process.env.DB_PATH = TMP;
process.env.JWT_SECRET = "test-secret-" + "x".repeat(40);

let pass = 0,
  bad = 0;
const ok = (c, m, x) =>
  c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)));

const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");
initDatabase();
try {
  updateDatabase();
} catch (e) {}

const Database = require("better-sqlite3");
const db = new Database(TMP);
db.pragma("foreign_keys = ON");

const L = require("../src/services/booking-lifecycle");
L.ensureCols(db);

// ===== 基本資料 =====
db.prepare(
  "INSERT INTO users (id,email,name,credits,phone,role,email_verified) VALUES ('u1','u1@t.hk','學員一',50,'90000001','user',1)",
).run();
db.prepare(
  "INSERT INTO users (id,email,name,credits,phone,role,email_verified) VALUES ('coachA','ca@t.hk','教練A',0,'90000002','coach',1)",
).run();
db.prepare(
  "INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status,venue_name) VALUES ('clA','coachA','樂齡伸展','樂齡',90,10,140,14,'active','青衣')",
).run();

const hrsAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
function mkSchedule(id, startHoursAgo, endHoursAgo) {
  db.prepare(
    "INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,session_state) VALUES (?,?,?,?,10,3,'available','scheduled')",
  ).run(id, "clA", hrsAgo(startHoursAgo), hrsAgo(endHoursAgo));
}
function mkBooking(id, scheduleId, status, extra = {}) {
  db.prepare(
    `INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, payment_type, payment_status, amount, status, hold_until)
     VALUES (?,?,?,?,?, 'single', 'paid', 140, ?, ?)`,
  ).run(id, "BK-" + id, "u1", scheduleId, "clA", status, extra.hold_until || null);
}

// s1：2 小時前完結；attended + confirmed + 過期未付款
mkSchedule("s1", 4, 2);
mkBooking("b1", "s1", "attended");
mkBooking("b2", "s1", "confirmed");
mkBooking("b3", "s1", "pending_payment", { hold_until: hrsAgo(3).replace("T", " ").slice(0, 19) });

// s2：5 分鐘前完結（測寬限）
mkSchedule("s2", 2, 0.083);
mkBooking("b4", "s2", "attended");

// s3：已取消班次
mkSchedule("s3", 4, 2);
db.prepare("UPDATE class_schedules SET status='cancelled' WHERE id='s3'").run();
mkBooking("b5", "s3", "attended");

const moneyBefore = (t) => {
  try {
    return db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  } catch (e) {
    return 0;
  }
};
const wtBefore = moneyBefore("wallet_transactions");
const ceBefore = moneyBefore("coach_earnings");

console.log("\n[1] 狀態機白名單");
ok(L.canTransitionSession("scheduled", "in_progress") === true, "scheduled → in_progress 允許");
ok(L.canTransitionSession("in_progress", "completed") === true, "in_progress → completed 允許");
ok(L.canTransitionSession("completed", "in_progress") === false, "completed → in_progress 拒絕");
ok(L.canTransitionSession("cancelled", "completed") === false, "cancelled → completed 拒絕");
ok(L.canTransitionBooking("pending_payment", "confirmed") === true, "pending_payment → confirmed 允許");
ok(L.canTransitionBooking("confirmed", "attended") === true, "confirmed → attended 允許");
ok(L.canTransitionBooking("confirmed", "no_show") === true, "confirmed → no_show 允許");
ok(L.canTransitionBooking("attended", "confirmed") === false, "attended → confirmed 拒絕（終態）");
ok(L.canTransitionBooking("cancelled", "confirmed") === false, "cancelled → confirmed 拒絕（須經 hold-control 還原）");

console.log("\n[2] 自動收尾（grace 30 分鐘）");
const r1 = L.finalizePastSessions(db);
ok(r1.completed === 1, "只有 s1 被收尾（s2 未夠 grace、s3 已取消）", r1);
const s1 = db.prepare("SELECT session_state, completed_at FROM class_schedules WHERE id='s1'").get();
ok(s1.session_state === "completed", "s1 session_state = completed", s1);
ok(!!s1.completed_at, "s1 有 completed_at", s1);
const b1 = db.prepare("SELECT status, completed_at FROM bookings WHERE id='b1'").get();
ok(b1.status === "attended" && !!b1.completed_at, "attended 預約保留 status 並寫 completed_at", b1);
const b2 = db.prepare("SELECT status, completed_at FROM bookings WHERE id='b2'").get();
ok(b2.status === "confirmed" && !b2.completed_at, "confirmed 預約唔會被自動改（留給 no-show 處理）", b2);
const b3 = db.prepare("SELECT status FROM bookings WHERE id='b3'").get();
ok(b3.status === "cancelled", "過期未付款預約 → cancelled", b3);
const seats = db.prepare("SELECT enrolled_count FROM class_schedules WHERE id='s1'").get();
ok(Number(seats.enrolled_count) === 2, "過期鎖位釋放後名額 3 → 2", seats);
const s2a = db.prepare("SELECT session_state FROM class_schedules WHERE id='s2'").get();
ok(s2a.session_state === "scheduled", "未過寬限班次唔會被收尾", s2a);
const s3a = db.prepare("SELECT session_state FROM class_schedules WHERE id='s3'").get();
ok(s3a.session_state === "scheduled", "已取消班次唔會被改", s3a);

console.log("\n[3] 重複執行 idempotent");
const r2 = L.finalizePastSessions(db);
ok(r2.completed === 0, "第二次執行收尾 0 班", r2);

console.log("\n[4] 寬限設定 0 分鐘");
db.prepare(
  "INSERT OR REPLACE INTO platform_settings (key, value) VALUES ('session_finalize_grace_minutes','0')",
).run();
ok(L.finalizeGraceMinutes(db) === 0, "讀到 grace=0");
const r3 = L.finalizePastSessions(db);
ok(r3.completed === 1, "grace=0 時 s2 被收尾", r3);

console.log("\n[5] 手動狀態轉換");
const t = L.transitionSession(db, { scheduleId: "s1", to: "completed", actorId: "coachA" });
ok(t.unchanged === true, "已 completed 再轉 completed → unchanged（唔會報錯）", t);
let err = null;
try {
  L.transitionSession(db, { scheduleId: "s1", to: "in_progress", actorId: "coachA" });
} catch (e) {
  err = e;
}
ok(err && err.code === "INVALID_TRANSITION" && err.status === 409, "completed → in_progress 回 409 INVALID_TRANSITION", err && err.code);
err = null;
try {
  L.transitionSession(db, { scheduleId: "nope", to: "completed", actorId: "coachA" });
} catch (e) {
  err = e;
}
ok(err && err.status === 404, "不存在班次回 404", err && err.status);

// 真正轉換一次（scheduled → completed）要寫審計
mkSchedule("s4", 48, 47);
const t2 = L.transitionSession(db, { scheduleId: "s4", to: "completed", actorId: "coachA", reason: "測試" });
ok(t2.from === "scheduled" && t2.to === "completed", "scheduled → completed 成功", t2);

console.log("\n[6] 鎖位分鐘數（release-expired-holds 讀設定）");
const { readHoldMinutes } = require("../scripts/release-expired-holds");
ok(readHoldMinutes(db) === 15, "未設定時預設 15", readHoldMinutes(db));
db.prepare("INSERT OR REPLACE INTO platform_settings (key, value) VALUES ('booking_hold_minutes','3')").run();
ok(readHoldMinutes(db) === 3, "設定 3 分鐘生效（最短）", readHoldMinutes(db));
db.prepare("INSERT OR REPLACE INTO platform_settings (key, value) VALUES ('booking_hold_minutes','2')").run();
ok(readHoldMinutes(db) === 15, "低於下限 2 分鐘 → 回落 15", readHoldMinutes(db));
db.prepare("INSERT OR REPLACE INTO platform_settings (key, value) VALUES ('booking_hold_minutes','45')").run();
ok(readHoldMinutes(db) === 45, "設定 45 分鐘生效", readHoldMinutes(db));

console.log("\n[7] 審計");
const audits = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action_type IN ('schedule.auto_finalize','schedule.session_state')").get().c;
ok(audits >= 3, "有寫入 audit_log（自動收尾 + 手動轉換）", audits);

console.log("\n[8] 金錢表零改動");
ok(moneyBefore("wallet_transactions") === wtBefore, "wallet_transactions 數目不變");
ok(moneyBefore("coach_earnings") === ceBefore, "coach_earnings 數目不變");

db.close();
console.log(`\n${bad ? "❌" : "✅"} 生命週期測試：${pass} 通過，${bad} 失敗`);
process.exit(bad ? 1 : 0);
