#!/usr/bin/env node
/**
 * Phase 4.4 — 智慧開課門檻仲裁（Quorum Guard）＋ WhatsApp 履約提醒引擎
 * AC-1 未達門檻自動流標＋100% 退堂
 * AC-2 達門檻自動確認
 * AC-3 通知冪等（跑 3 次唔會重發）
 * AC-4 No-Show 教練保底結算
 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");

process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-quorum-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  if (c) { pass++; console.log("  ✅ " + m); }
  else { bad++; console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)); }
};

const { getDb } = require("../src/services/database");
const db = getDb();
const quorum = require("../src/services/quorum-worker");
const notifWorker = require("../src/services/notification-worker");
const passes = require("../src/services/passes");

quorum.ensureSchema(db);
passes.ensureSchema(db);

function user(id, name, phone, role = "user", coach = 0) {
  db.prepare(
    "INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version,credits) VALUES (?,?,?,?,?,?,?,?,0,?)",
  ).run(id, id + "@t.hk", name, phone, role, coach, coach, coach ? 0.8 : 0, 0);
}
user("coach", "蔡教練", "60000001", "coach", 1);
user("s1", "陳大文", "98764532");
user("s2", "李玉蘭", "61234567");
user("s3", "黃小強", "63334444");
db.prepare("UPDATE users SET credits = 50 WHERE id = 's2'").run();

db.prepare(
  `INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open,venue_name,credits_cost)
   VALUES ('cls1','coach','樂齡防跌班','fitness',60,140,8,'active',1,'葵芳體育館',14)`,
).run();

const iso = (mins) => new Date(Date.now() + mins * 60000).toISOString().slice(0, 19).replace("T", " ");
function schedule(id, mins, extra = {}) {
  const minQ = extra.min_quorum === undefined ? 2 : extra.min_quorum;
  db.prepare(
    `INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,min_quorum,quorum_status)
     VALUES (?,?,?,?,8,?,?,?, 'pending')`,
  ).run(id, "cls1", iso(mins), iso(mins + 60), extra.enrolled || 1, extra.status || "available", minQ);
}
function booking(id, uid, schId, { status = "confirmed", paymentType = "pass", passId = null, amount = 140 } = {}) {
  db.prepare(
    `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,pass_id,payment_type,payment_status,status,amount,amount_cents,created_at)
     VALUES (?,?,?,?,?,?,?,'paid',?,?,?,datetime('now'))`,
  ).run(id, "ZP-" + id, uid, schId, "cls1", passId, paymentType, status, amount, Math.round(amount * 100));
}
function makePass(id, userId, remaining = 4) {
  db.prepare(
    `INSERT INTO user_passes (id,user_id,user_phone,student_name,total_credits,remaining_credits,price_paid,status,expires_at)
     VALUES (?,?,?,?,?,?,520,'active',datetime('now','+30 days'))`,
  ).run(id, userId, "98764532", "陳大文", 4, remaining);
}

// ── 場景 ───────────────────────────────────────────────
// schLow：11h45 後開課、門檻 2、只有 1 人（Pass 付款）→ 應流標
schedule("schLow", 11 * 60 + 45, { enrolled: 1 });
makePass("pass1", "s1", 4);
db.prepare("UPDATE user_passes SET remaining_credits = 3 WHERE id = 'pass1'").run();
booking("bk-low", "s1", "schLow", { passId: "pass1" });
passes.redeemUnitsInTx(db, { passId: "pass1", userId: "s1", bookingId: "bk-low", units: 1 });

// schOk：11h30 後開課、門檻 2、2 人 → 應確認
schedule("schOk", 11 * 60 + 30, { enrolled: 2 });
booking("bk-ok1", "s1", "schOk", { paymentType: "credits" });
booking("bk-ok2", "s2", "schOk", { paymentType: "credits" });

// schCredits：9h 後、門檻 2、1 人用 Credits → 流標＋退 Credits
schedule("schCredits", 9 * 60, { enrolled: 1 });
booking("bk-cr", "s2", "schCredits", { paymentType: "credits", amount: 140 });

// schCash：8h 後、門檻 2、1 人用 FPS → 流標但金錢只標記人手退款
schedule("schCash", 8 * 60, { enrolled: 1 });
booking("bk-cash", "s3", "schCash", { paymentType: "single", amount: 140 });
db.prepare("UPDATE bookings SET payment_method = 'fps' WHERE id = 'bk-cash'").run();

// schFar：30h 後 → 未到窗口，不動
schedule("schFar", 30 * 60, { enrolled: 1 });
booking("bk-far", "s1", "schFar", { paymentType: "credits" });

// schPast：已開課 2h、未仲裁 → 標記 confirmed，唔會取消
schedule("schPast", -120, { enrolled: 1, status: "available" });
booking("bk-past", "s1", "schPast", { paymentType: "credits" });

// ── 執行 ───────────────────────────────────────────────
(async () => {
  console.log("🧪 0. Schema");
  const cols = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);
  ok(cols.includes("min_quorum"), "class_schedules.min_quorum");
  ok(cols.includes("quorum_checked_at"), "class_schedules.quorum_checked_at");
  ok(cols.includes("quorum_status"), "class_schedules.quorum_status");
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_notifications_log'").get();
  ok(!!tbl, "scheduled_notifications_log 表存在");
  const uniq = db
    .prepare("PRAGMA index_list('scheduled_notifications_log')")
    .all()
    .some((ix) => {
      if (!ix.unique) return false;
      const cols = db.prepare(`PRAGMA index_info('${ix.name}')`).all().map((c) => c.name);
      return (
        cols.length === 3 &&
        cols.includes("schedule_id") &&
        cols.includes("recipient_user_id") &&
        cols.includes("notification_type")
      );
    });
  ok(uniq, "具備 UNIQUE(schedule_id, recipient_user_id, notification_type)");

  console.log("\n🧪 1. AC-1 未達門檻自動流標＋100% 退堂");
  const before = db.prepare("SELECT remaining_credits FROM user_passes WHERE id='pass1'").get().remaining_credits;
  const r1 = await quorum.runOnce({ db });
  const schedLow = db.prepare("SELECT * FROM class_schedules WHERE id='schLow'").get();
  ok(schedLow.status === "cancelled", "班次 → cancelled", schedLow.status);
  ok(schedLow.quorum_status === "cancelled_low_quorum", "quorum_status → cancelled_low_quorum", schedLow.quorum_status);
  const bkLow = db.prepare("SELECT * FROM bookings WHERE id='bk-low'").get();
  ok(bkLow.status === "cancelled", "預約 → cancelled", bkLow.status);
  ok(bkLow.cancel_reason === "system_low_quorum_auto_refund", "cancel_reason 正確", bkLow.cancel_reason);
  const after = db.prepare("SELECT remaining_credits FROM user_passes WHERE id='pass1'").get().remaining_credits;
  ok(after === 3 && before === 2, `Pass 堂數精準原路返還（${before} → ${after}）`);
  ok(db.prepare("SELECT status FROM pass_redemptions WHERE booking_id='bk-low'").get().status === "refunded", "pass_redemption → refunded");
  ok(r1.cancelled >= 1, `今次流標 ${r1.cancelled} 班`);
  const auditRow = db.prepare("SELECT 1 FROM audit_log WHERE action_type='schedule.quorum_auto_cancelled' AND entity_id='schLow'").get();
  ok(!!auditRow, "有流標審計紀錄");

  console.log("\n🧪 2. AC-1b Credits 全額退回 / 金錢只標記人手退款");
  const s2 = db.prepare("SELECT credits FROM users WHERE id='s2'").get().credits;
  ok(Math.round(s2 * 10) / 10 === 64, `Credits 50 → ${s2}（+14）`);
  const ledger = db.prepare("SELECT * FROM credit_transactions WHERE reference_id='bk-cr'").get();
  ok(!!ledger && Number(ledger.credits) === 14, "credit_transactions 有退款分錄", ledger && ledger.credits);
  const bkCash = db.prepare("SELECT * FROM bookings WHERE id='bk-cash'").get();
  ok(bkCash.status === "cancelled", "FPS 預約同樣取消");
  const cashTxn = db.prepare("SELECT * FROM credit_transactions WHERE reference_id='bk-cash'").get();
  ok(!cashTxn, "金錢付款唔會自動入 Credits（等人手退款）");
  ok((r1.details.find((d) => d.schedule_id === "schCash") || {}).refunds?.[0]?.method === "manual_refund_required", "標記 manual_refund_required");

  console.log("\n🧪 3. AC-2 達門檻自動鎖定確認");
  const schedOk = db.prepare("SELECT * FROM class_schedules WHERE id='schOk'").get();
  ok(schedOk.quorum_status === "confirmed", "quorum_status → confirmed", schedOk.quorum_status);
  ok(schedOk.status === "available", "班次狀態保持原狀（未被取消）", schedOk.status);
  ok(!!schedOk.quorum_checked_at, "有 quorum_checked_at");
  const coachMsg = db
    .prepare("SELECT * FROM scheduled_notifications_log WHERE schedule_id='schOk' AND notification_type='coach_quorum_confirmed'")
    .get();
  ok(!!coachMsg, "教練收到開班確認通知");

  console.log("\n🧪 4. 窗口外／已開課唔會誤觸");
  const far = db.prepare("SELECT * FROM class_schedules WHERE id='schFar'").get();
  ok(far.quorum_status === "pending", "30 小時後嘅班次未進入仲裁", far.quorum_status);
  const past = db.prepare("SELECT * FROM class_schedules WHERE id='schPast'").get();
  ok(past.quorum_status === "confirmed" && past.status === "available", "已開課班次標記 confirmed、唔會取消");
  ok((r1.skipped_past || 0) >= 1, "統計有 skipped_past");

  console.log("\n🧪 5. AC-3 通知冪等（連續跑 3 次）");
  const countRows = () =>
    db.prepare("SELECT COUNT(*) c FROM scheduled_notifications_log WHERE schedule_id='schLow'").get().c;
  const n1 = countRows();
  await quorum.runOnce({ db });
  await quorum.runOnce({ db });
  await notifWorker.runOnce({ db, now: new Date(), dispatch: false });
  const n2 = countRows();
  ok(n1 === n2, `通知列數不變（${n1} → ${n2}）`);
  const lowMsgs = db
    .prepare("SELECT * FROM scheduled_notifications_log WHERE schedule_id='schLow' AND recipient_user_id='s1'")
    .all();
  ok(lowMsgs.length === 1, "同一學員同一類型只有 1 條", lowMsgs.length);
  ok(/人數不足/.test(quorum.messageOfLog(lowMsgs[0])), "取消通知文案含原因");

  console.log("\n🧪 6. 通知派送（WhatsApp 未配置時走站內備援）");
  const sent = [];
  const fakeSend = async (p) => {
    sent.push(p);
    return { sms: "not_configured", whatsapp: "sent", in_app: true };
  };
  const d1 = await notifWorker.dispatchPending({ db, send: fakeSend });
  ok(d1.scanned >= 1 && d1.sent >= 1, `派送 ${d1.sent}/${d1.scanned} 條`);
  ok(sent.some((m) => /人數不足/.test(m.message)), "實際送出取消通知");
  const resent = await notifWorker.dispatchPending({ db, send: fakeSend });
  ok(resent.scanned === 0, "已 sent 嘅唔會再派（重跑 scanned=0）", resent.scanned);

  console.log("\n🧪 7. T-24h / T-2h 履約提醒");
  schedule("sch24", 23 * 60, { enrolled: 1 });
  booking("bk-24", "s1", "sch24", { paymentType: "credits" });
  schedule("sch2h", 90, { enrolled: 1 });
  booking("bk-2h", "s1", "sch2h", { paymentType: "credits" });
  const q = notifWorker.enqueueReminders({ db });
  ok(q.t24 >= 1, `T-24h 已入隊 ${q.t24} 條`);
  ok(q.t2 >= 1, `T-2h 已入隊 ${q.t2} 條`);
  const t24 = db
    .prepare("SELECT * FROM scheduled_notifications_log WHERE schedule_id='sch24' AND notification_type='t_minus_24h_reminder'")
    .get();
  ok(!!t24, "T-24h 通知列存在");
  ok(/免費取消/.test(quorum.messageOfLog(t24)), "T-24h 文案提示免費取消窗口");
  const t2 = db
    .prepare("SELECT * FROM scheduled_notifications_log WHERE schedule_id='sch2h' AND notification_type='t_minus_2h_pass_link'")
    .get();
  ok(!!t2, "T-2h 通知列存在");
  const t2msg = quorum.messageOfLog(t2);
  ok(/入場憑證/.test(t2msg) && /後 4 位/.test(t2msg), "T-2h 文案含入場連結＋電話後 4 位");
  ok(/senior-view\.html\?id=/.test(t2msg) && /share=/.test(t2msg), "入場連結帶簽章 share");
  const q2 = notifWorker.enqueueReminders({ db });
  ok(q2.t24 === 0 && q2.t2 === 0, "重跑唔會再加提醒", q2);

  console.log("\n🧪 8. AC-4 No-Show 教練保底結算");
  const bookingSvc = require("../src/services/booking-service");
  const r4 = bookingSvc.markNoShow({ user: { id: "s1" }, params: { id: "bk-ok2" } });
  // s1 唔係教練 → 應拒；改用教練身份
  ok(r4.status === 403, "非教練不可標記 no-show", r4.status);
  const r4b = bookingSvc.markNoShow({ user: { id: "coach" }, params: { id: "bk-ok2" } });
  ok(r4b.status === 200, "教練標記 no-show 成功", r4b.status);
  const noShow = db.prepare("SELECT status FROM bookings WHERE id='bk-ok2'").get().status;
  ok(noShow === "no_show", "booking → no_show", noShow);
  const earn = db.prepare("SELECT * FROM coach_earnings WHERE schedule_id='schOk'").get();
  ok(!!earn, "已生成 coach_earnings");
  ok(Number(earn.enrolled_count) === 2, `缺席席位照計（enrolled_count=${earn && earn.enrolled_count}）`);
  ok(Math.round(Number(earn.net_amount) * 100) / 100 === 224, `教練淨收 140×2×80% = ${earn && earn.net_amount}`);
  const passAfterNoShow = db.prepare("SELECT remaining_credits FROM user_passes WHERE id='pass1'").get().remaining_credits;
  ok(passAfterNoShow === 3, "no-show 唔會退堂（Pass 仍為 3）", passAfterNoShow);

  console.log("\n🧪 9. 接線檢查");
  const idx = require("fs").readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  ok(/quorum-worker/.test(idx) && /quorumWorker\.start/.test(idx), "index.js 已掛 quorum worker");
  ok(/notification-worker/.test(idx) && /notifyWorker\.start/.test(idx), "index.js 已掛通知 worker");
  ok(/status IN \('confirmed', 'attended', 'no_show'\)/.test(
    require("fs").readFileSync(path.join(__dirname, "../src/routes/coach-earnings.js"), "utf8"),
  ), "教練收益計算已包含 no_show");

  console.log(`\n📊 結果: ${pass} passed / ${bad} failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error("💥 測試異常:", e);
  process.exit(1);
});
