#!/usr/bin/env node
/**
 * run-family-acceptance-flow.js — 家庭閉環驗收（方案 A：真實業務邏輯 + 精準整數 cents）
 *
 * 唔會猜欄位名：所有寫入都用 backend 真實 service（passes.issuePass / booking-service.insertBookingRow /
 * pass-deduction FIFO / coach-earnings.syncCoachEarningsForSchedule），欄位由各 service 自行適配。
 *
 * 流程：
 *   ① 自動揀班次（未來 2 小時–60 日、可預約、非 studio、優先 0 個預約嘅班）
 *   ② 建立／沿用陳氏家庭群組（付款人＝陳小姐 91234567）
 *   ③ 把陳大文（98765432）加入並開 can_consume_pass
 *   ④ 簽發 4 堂家庭通票（HK$520 = 52000 cents，pass_type=pack_4，綁 family_group_id）
 *   ⑤ 父親以家庭 Pass 扣 1 堂預約（FIFO 引擎，真實 transaction）
 *   ⑥ 現場點名 present（attendance_status='present'）→ 觸發真實結算 syncCoachEarningsForSchedule
 *   ⑦ 核對（Pass 4→3、redemption、present、coach_earnings 整數 cents）＋ 跑 family-e2e-check.sh
 *
 * 全部寫入都標記 is_acceptance_test=1（驗收測試帳目），報表可用 utils/test-audit 排除。
 *
 * 用法（VPS）：
 *   cd /var/www/zenpass
 *   node zenpass-tester/scripts/run-family-acceptance-flow.js                  # 自動揀班
 *   node zenpass-tester/scripts/run-family-acceptance-flow.js --schedule <id>
 *   node zenpass-tester/scripts/run-family-acceptance-flow.js --dry-run        # 只計劃，唔寫
 *   node zenpass-tester/scripts/run-family-acceptance-flow.js --rollback       # 作廢上次驗收（保留審計）
 *
 * 參數：--payer 91234567 --member 98765432 --db <path> --json <path> --no-check
 * 環境：DB_PATH 預設 ../backend/data/zenpass.db（相對 repo 根）
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");

// ---- 參數 ----
const argv = process.argv.slice(2);
const getArg = (name, def) => {
  const i = argv.indexOf("--" + name);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
};
const flag = (name) => argv.includes("--" + name);

const PAYER_PHONE = String(getArg("payer", "91234567"));
const MEMBER_PHONE = String(getArg("member", "98765432"));
const EXPLICIT_SCHED = typeof getArg("schedule", null) === "string" ? getArg("schedule", null) : null;
const DRY_RUN = flag("dry-run");
const ROLLBACK = flag("rollback");
const RUN_CHECK = !flag("no-check");
const KEEP_FINANCIALS = flag("keep-financials"); // 預設：驗收分錄即時沖回錢包（金錢零影響）
const GROUP_NAME = "陳氏家庭健康通票（驗收）";
const PASS_PLAN = "pack_4";
const PASS_CREDITS = 4;
const PASS_PRICE_CENTS = 52000; // HK$520
const EXPECTED_UNIT_CENTS = 14000; // 課堂牌價（會由 DB 實際 price_hkd 覆核）

const DB_PATH = path.resolve(
  ROOT,
  typeof getArg("db", null) === "string" ? getArg("db", null) : "backend/data/zenpass.db",
);
process.env.DB_PATH = DB_PATH;
process.chdir(BACKEND); // services 用相對路徑 ./data 等

// 載入 backend/.env（JWT_SECRET 等）；唔覆寫已設定嘅 DB_PATH
try {
  require(path.join(BACKEND, "node_modules/dotenv")).config({ path: path.join(BACKEND, ".env") });
} catch (e) {
  /* dotenv 可能未安裝；由外層 env 提供 */
}

const out = [];
const log = (line) => {
  console.log(line);
  out.push(line);
};
const fails = [];
const ok = (cond, label, detail) => {
  if (cond) log(`  ✅ ${label}${detail !== undefined ? `（${detail}）` : ""}`);
  else {
    fails.push(label);
    log(`  ❌ ${label}${detail !== undefined ? `（實際 ${detail}）` : ""}`);
  }
};

function die(msg) {
  console.error("❌ " + msg);
  process.exit(2);
}

if (!fs.existsSync(DB_PATH)) die(`找不到 DB: ${DB_PATH}`);

const { getDb } = require(path.join(BACKEND, "src/services/database"));
const passes = require(path.join(BACKEND, "src/services/passes"));
const familyWallet = require(path.join(BACKEND, "src/services/family-wallet"));
const passDeduction = require(path.join(BACKEND, "src/services/pass-deduction"));
const bookingService = require(path.join(BACKEND, "src/services/booking-service"));
const coachEarnings = require(path.join(BACKEND, "src/routes/coach-earnings"));
const { audit } = require(path.join(BACKEND, "src/services/audit"));

const db = getDb();

// ---------- 小工具 ----------
function cols(table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  } catch (e) {
    return [];
  }
}
function hasCol(table, col) {
  return cols(table).includes(col);
}
function addCol(table, col, type) {
  if (!hasCol(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}
function ensureAcceptanceSchema() {
  // 驗收帳目標記（idempotent；唔影響現有查詢）
  for (const t of ["bookings", "coach_earnings", "user_passes", "pass_redemptions", "family_groups"]) {
    if (cols(t).length) addCol(t, "is_acceptance_test", "INTEGER DEFAULT 0");
  }
  bookingService.ensureAttendeeColumns(db);
  bookingService.ensureLegalColumns(db);
  bookingService.ensureRefundColumns(db);
  passes.ensureSchema(db);
  familyWallet.ensureSchema(db);
  passDeduction.ensureSchema(db);
}
function normPhone(p) {
  return String(p || "").replace(/\D/g, "").replace(/^852/, "");
}
function findUser(phone) {
  const p = normPhone(phone);
  return db
    .prepare("SELECT id, name, phone, role FROM users WHERE phone = ? OR phone = ? ORDER BY created_at LIMIT 1")
    .get(p, "852" + p);
}
function yuan(cents) {
  return "HK$" + (Number(cents || 0) / 100).toFixed(2);
}

ensureAcceptanceSchema();

log("════════════════════════════════════════════════════════════");
log(" ZenPass 家庭閉環驗收（方案 A · 真實 service 邏輯）");
log(` ${new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", hour12: false })} HKT`);
log(` DB: ${DB_PATH}`);
log(` 付款人: ${PAYER_PHONE}   家人: ${MEMBER_PHONE}${DRY_RUN ? "   [DRY-RUN]" : ""}${ROLLBACK ? "   [ROLLBACK]" : ""}`);
log("════════════════════════════════════════════════════════════");

// ---------- 帳戶 ----------
const payer = findUser(PAYER_PHONE);
const member = findUser(MEMBER_PHONE);
if (!payer) die(`找不到付款人帳戶（電話 ${PAYER_PHONE}）`);
if (!member) die(`找不到家人帳戶（電話 ${MEMBER_PHONE}）`);
log(`\n① 帳戶\n  付款人：${payer.name} (${payer.id})\n  家人：  ${member.name} (${member.id})`);

// ---------- Rollback 模式 ----------
if (ROLLBACK) {
  const p = db
    .prepare(
      `SELECT * FROM user_passes WHERE COALESCE(owner_user_id,user_id)=? AND notes LIKE 'acceptance:%' ORDER BY created_at DESC LIMIT 1`,
    )
    .get(payer.id);
  if (!p) die("找不到驗收 Pass，無需回滾");
  const bks = db.prepare("SELECT * FROM bookings WHERE pass_id=?").all(p.id);
  const run = db.transaction(() => {
    for (const b of bks) {
      db.prepare(
        "UPDATE bookings SET status='cancelled', cancel_reason='acceptance_rollback', updated_at=datetime('now') WHERE id=?",
      ).run(b.id);
      db.prepare("UPDATE class_schedules SET enrolled_count = MAX(0, COALESCE(enrolled_count,0)-1) WHERE id=?").run(b.schedule_id);
      db.prepare("UPDATE pass_redemptions SET status='voided' WHERE booking_id=?").run(b.id);
      db.prepare(
        "UPDATE coach_earnings SET status='cancelled', updated_at=datetime('now') WHERE schedule_id=? AND COALESCE(is_acceptance_test,0)=1",
      ).run(b.schedule_id);
    }
    db.prepare("UPDATE user_passes SET status='superseded', updated_at=datetime('now') WHERE id=?").run(p.id);
  });
  run();
  try {
    audit({
      actionType: "acceptance.rollback",
      entityType: "user_pass",
      entityId: p.id,
      userId: payer.id,
      newValues: { pass_id: p.id, bookings: bks.map((b) => b.id) },
      description: "驗收回滾：作廢 Pass／取消 booking／取消測試教練收益（保留審計足跡）",
    });
  } catch (e) {}
  log(`\n↩️ 已回滾驗收：pass ${p.id}、booking ${bks.length} 筆（紀錄保留，只改狀態）`);
  process.exit(0);
}

// ---------- ② 班次 ----------
function pickSchedule() {
  if (EXPLICIT_SCHED) {
    const s = db
      .prepare(
        `SELECT s.*, c.title, c.price_hkd, c.status AS class_status, c.booking_open AS class_booking_open,
                COALESCE(s.max_participants, c.max_participants, 20) AS cap,
                COALESCE(s.enrolled_count,0) AS enrolled,
                COALESCE(s.coach_override_id, c.coach_id) AS actual_coach,
                (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id=s.id AND b.status<>'cancelled') AS bk
           FROM class_schedules s JOIN classes c ON c.id=s.class_id WHERE s.id=?`,
      )
      .get(EXPLICIT_SCHED);
    if (!s) die(`找不到指定班次 ${EXPLICIT_SCHED}`);
    return s;
  }
  return db
    .prepare(
      `SELECT s.*, c.title, c.price_hkd, c.status AS class_status, c.booking_open AS class_booking_open,
              COALESCE(s.max_participants, c.max_participants, 20) AS cap,
              COALESCE(s.enrolled_count,0) AS enrolled,
              COALESCE(s.coach_override_id, c.coach_id) AS actual_coach,
              (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id=s.id AND b.status<>'cancelled') AS bk
         FROM class_schedules s JOIN classes c ON c.id=s.class_id
        WHERE s.status='available'
          AND COALESCE(s.booking_open,1)=1
          AND COALESCE(c.booking_open,1)=1
          AND c.status='active'
          AND COALESCE(s.studio_id,'')=''
          AND COALESCE(s.coach_override_id,c.coach_id) IS NOT NULL
          AND datetime(s.start_time) > datetime('now','+2 hours')
          AND datetime(s.start_time) < datetime('now','+60 days')
          AND NOT EXISTS (SELECT 1 FROM bookings b2 WHERE b2.schedule_id=s.id AND b2.user_id=? AND b2.status<>'cancelled')
        ORDER BY CASE WHEN (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id=s.id AND b.status<>'cancelled')=0 THEN 0 ELSE 1 END,
                 datetime(s.start_time) ASC
        LIMIT 1`,
    )
    .get(member.id);
}

const sched = pickSchedule();
if (!sched) die("找不到可驗收班次（未來 2 小時–60 日、可預約、非 studio）");

// 同一家人同一班只可以有一筆有效驗收預約（避免重跑造成重複）
const dupBooking = db
  .prepare("SELECT id, booking_reference, status FROM bookings WHERE schedule_id=? AND user_id=? AND status<>'cancelled' LIMIT 1")
  .get(sched.id, member.id);
if (dupBooking) {
  die(
    `班次 ${sched.id} 已有 ${member.name} 的預約 ${dupBooking.booking_reference}（${dupBooking.status}）。\n` +
      `   請先回滾：node zenpass-tester/scripts/run-family-acceptance-flow.js --rollback\n` +
      `   或改用其他班次：--schedule <id>`,
  );
}
const coach = db.prepare("SELECT id, name, commission_rate FROM users WHERE id=?").get(sched.actual_coach);
if (!coach) die(`班次 ${sched.id} 沒有有效教練`);
const unitCents = Math.round(Number(sched.price_hkd || 0) * 100);
const rate = Number(coach.commission_rate) > 0 ? Number(coach.commission_rate) : 0.8;
const onlyTestSchedule = Number(sched.bk) === 0;

log(
  `\n② 班次\n  ${sched.id}\n  ${sched.title} · ${String(sched.start_time).replace("T", " ").slice(0, 16)} UTC\n` +
    `  教練：${coach.name}（${(rate * 100).toFixed(0)}%）· 牌價 ${yuan(unitCents)} · 現有預約 ${sched.bk} 筆`,
);
if (!onlyTestSchedule) {
  log("  ⚠️ 此班已有真實預約 → 教練收益為混合金額，本腳本唔會把該分錄標記為測試帳目");
}

if (DRY_RUN) {
  log(
    `\n[DRY-RUN] 將會：\n  · 建立／沿用家庭群組「${GROUP_NAME}」，加入 ${member.name}\n` +
      `  · 簽發 ${PASS_CREDITS} 堂家庭通票 ${yuan(PASS_PRICE_CENTS)}（${PASS_PLAN}）\n` +
      `  · ${member.name} 扣 1 堂預約 ${sched.title}\n  · 點名 present → 結算 ${yuan(Math.floor(unitCents * rate))} cents 整數`,
  );
  process.exit(0);
}

// ---------- ③ 家庭群組 ----------
let family = db
  .prepare("SELECT * FROM family_groups WHERE owner_user_id=? AND group_name=?")
  .get(payer.id, GROUP_NAME);
let familyId;
if (!family) {
  familyId = "fam_" + crypto.randomBytes(8).toString("hex");
  db.transaction(() => {
    db.prepare("INSERT INTO family_groups (id, owner_user_id, group_name) VALUES (?,?,?)").run(
      familyId,
      payer.id,
      GROUP_NAME,
    );
    if (hasCol("family_groups", "is_acceptance_test"))
      db.prepare("UPDATE family_groups SET is_acceptance_test=1 WHERE id=?").run(familyId);
    db.prepare(
      "INSERT OR IGNORE INTO family_members (id, family_group_id, member_user_id, relation_title, can_consume_pass) VALUES (?,?,?,'self',1)",
    ).run("fm_" + crypto.randomBytes(6).toString("hex"), familyId, payer.id);
    db.prepare(
      "INSERT OR IGNORE INTO family_members (id, family_group_id, member_user_id, relation_title, can_consume_pass) VALUES (?,?,?,'father',1)",
    ).run("fm_" + crypto.randomBytes(6).toString("hex"), familyId, member.id);
  })();
  log(`\n③ 家庭群組\n  新建 ${familyId}（${GROUP_NAME}）`);
} else {
  familyId = family.id;
  db.transaction(() => {
    db.prepare(
      "INSERT OR IGNORE INTO family_members (id, family_group_id, member_user_id, relation_title, can_consume_pass) VALUES (?,?,?,'self',1)",
    ).run("fm_" + crypto.randomBytes(6).toString("hex"), familyId, payer.id);
    db.prepare(
      "INSERT OR IGNORE INTO family_members (id, family_group_id, member_user_id, relation_title, can_consume_pass) VALUES (?,?,?,'father',1)",
    ).run("fm_" + crypto.randomBytes(6).toString("hex"), familyId, member.id);
    db.prepare(
      "UPDATE family_members SET can_consume_pass=1 WHERE family_group_id=? AND member_user_id=?",
    ).run(familyId, member.id);
  })();
  log(`\n③ 家庭群組\n  沿用 ${familyId}（${GROUP_NAME}）`);
}
const fmRow = db
  .prepare(
    "SELECT fm.*, u.name FROM family_members fm JOIN users u ON u.id=fm.member_user_id WHERE fm.family_group_id=? AND fm.member_user_id=?",
  )
  .get(familyId, member.id);
ok(!!fmRow && Number(fmRow.can_consume_pass) === 1, "家人已入家庭組且可扣堂", fmRow ? `can_consume_pass=${fmRow.can_consume_pass}` : "missing");

// 作廢之前嘅驗收 Pass（保留審計）
db.prepare(
  "UPDATE user_passes SET status='superseded', updated_at=datetime('now') WHERE family_group_id=? AND notes LIKE 'acceptance:%' AND status='active'",
).run(familyId);

// ---------- ④ 簽發家庭 Pass ----------
const issued = passes.issuePass(db, {
  userId: payer.id,
  phone: payer.phone,
  studentName: payer.name,
  totalCredits: PASS_CREDITS,
  pricePaid: PASS_PRICE_CENTS / 100,
  validDays: 60,
  notes: `acceptance:${PASS_PLAN}`,
  createdBy: "system:acceptance-flow",
  familyGroupId: familyId,
  ownerUserId: payer.id,
});
if (!issued.ok) die(`簽發 Pass 失敗：${issued.error}`);
const passId = issued.pass.id;
db.prepare("UPDATE user_passes SET pass_type=?, is_acceptance_test=1 WHERE id=?").run(PASS_PLAN, passId);
try {
  audit({
    actionType: "pass.issued",
    entityType: "user_pass",
    entityId: passId,
    userId: payer.id,
    newValues: {
      pass_id: passId,
      total_credits: PASS_CREDITS,
      price_paid: PASS_PRICE_CENTS / 100,
      family_group_id: familyId,
      plan: PASS_PLAN,
      mode: "acceptance_flow",
    },
    description: `驗收：簽發 ${PASS_CREDITS} 堂家庭通票（${yuan(PASS_PRICE_CENTS)}，${PASS_PLAN}）`,
  });
} catch (e) {}

const passBefore = db.prepare("SELECT * FROM user_passes WHERE id=?").get(passId);
log(
  `\n④ 家庭通票\n  ${passId}\n  ${passBefore.total_credits} 堂 · 實付 ${yuan(Math.round(Number(passBefore.price_paid) * 100))} · 到期 ${passBefore.expires_at} UTC`,
);
ok(Number(passBefore.total_credits) === PASS_CREDITS, "Pass 堂數 = 4", passBefore.total_credits);
ok(
  Math.round(Number(passBefore.price_paid) * 100) === PASS_PRICE_CENTS,
  "Pass 實付 = 52000 cents",
  Math.round(Number(passBefore.price_paid) * 100),
);
ok(passBefore.family_group_id === familyId, "Pass 已綁定家庭群組", passBefore.family_group_id);

// ---------- ⑤ 扣堂預約（FIFO 真實引擎） ----------
let plan;
try {
  plan = passDeduction.planPassDeduction(db, { userId: member.id, familyGroupId: familyId, units: 1 });
} catch (e) {
  die(`扣堂計劃失敗：${e.code || ""} ${e.message}`);
}
const bookingId = crypto.randomUUID();
const bookingRef = bookingService.generateBookingRef();
let inTx = false;
try {
  db.exec("BEGIN IMMEDIATE");
  inTx = true;
  const upd = db
    .prepare(
      "UPDATE class_schedules SET enrolled_count = COALESCE(enrolled_count,0) + 1 WHERE id=? AND COALESCE(enrolled_count,0) < ?",
    )
    .run(sched.id, Number(sched.cap));
  if (upd.changes !== 1) throw Object.assign(new Error("該班次已額滿"), { code: "CLASS_FULL" });

  bookingService.insertBookingRow(db, {
    bookingId,
    bookingRef,
    userId: member.id,
    scheduleId: sched.id,
    classId: sched.class_id,
    paymentType: "pass",
    paymentStatus: "paid",
    bookingStatus: "confirmed",
    amount: 0,
    groupSize: 1,
    groupInviteCode: null,
    attendee: null,
    meta: { ip: "acceptance-flow", ua: "zenpass-acceptance/1.0" },
  });
  passDeduction.applyPlanInTx(db, { plan: plan.plan, bookingId, userId: member.id });
  passDeduction.recordPlanOnBooking(db, bookingId, plan.plan);
  db.prepare("UPDATE bookings SET is_acceptance_test=1 WHERE id=?").run(bookingId);
  db.exec("COMMIT");
  inTx = false;
} catch (e) {
  if (inTx) {
    try {
      db.exec("ROLLBACK");
    } catch (_e) {}
  }
  die(`預約失敗（已回滾）：${e.message}`);
}

try {
  audit({
    actionType: "booking.pass_booked",
    entityType: "booking",
    entityId: bookingId,
    userId: payer.id,
    newValues: {
      attendee_user_id: member.id,
      schedule_id: sched.id,
      pass_id: plan.plan[0].passId,
      pass_source: plan.source,
      pass_plan: plan.plan.map((p) => ({ pass_id: p.passId, units: p.units })),
      mode: "acceptance_flow",
    },
    description: `驗收：家庭 Pass 扣堂預約 ${sched.title}`,
  });
} catch (e) {}

const bkRow = db.prepare("SELECT * FROM bookings WHERE id=?").get(bookingId);
log(
  `\n⑤ 扣堂預約\n  booking ${bookingRef} (${bookingId})\n  ${member.name} · ${sched.title} · payment_type=pass · ${bkRow.status}/${bkRow.payment_status}\n  Pass 來源：${plan.source}（扣 ${plan.plan[0].units} 堂）`,
);
ok(bkRow.status === "confirmed", "booking 狀態 = confirmed", bkRow.status);

// ---------- ⑥ 現場點名 present ----------
db.prepare(
  `UPDATE bookings SET status='attended', attendance_status='present', checked_in_at=datetime('now'),
          checkin_method='acceptance_flow', fraud_audit_status='clean', updated_at=datetime('now')
    WHERE id=?`,
).run(bookingId);
try {
  audit({
    actionType: "booking.checked_in",
    entityType: "booking",
    entityId: bookingId,
    userId: null,
    newValues: { method: "acceptance_flow", schedule_id: sched.id, attendance_status: "present" },
    description: `驗收：現場點名 ${bookingRef}`,
  });
} catch (e) {}

let settleErr = null;
try {
  coachEarnings.syncCoachEarningsForSchedule(sched.id);
} catch (e) {
  settleErr = e.message;
  log(`  ⚠️ 結算呼叫失敗：${e.message}`);
}
if (onlyTestSchedule && settleErr === null) {
  db.prepare(
    "UPDATE coach_earnings SET is_acceptance_test=1 WHERE schedule_id=? AND COALESCE(earning_type,'primary')='primary'",
  ).run(sched.id);
}

const earn = db
  .prepare(
    "SELECT * FROM coach_earnings WHERE schedule_id=? AND COALESCE(earning_type,'primary')='primary' ORDER BY created_at DESC LIMIT 1",
  )
  .get(sched.id);

// 💰 金錢零影響：驗收分錄唔可以令真教練錢包多錢。
// 做法：先沖回錢包入帳（反向 adjustment，保留審計），再把該分錄標 cancelled + is_acceptance_test=1，
//       並重算 users.total_earnings / pending_payout。分錄金額（net_amount_cents）仍然保留俾核對用。
let neutralised = null;
if (onlyTestSchedule && earn && !KEEP_FINANCIALS) {
  try {
    const walletService = require(path.join(BACKEND, "src/services/wallet-service"));
    const creditTx = db
      .prepare("SELECT * FROM wallet_transactions WHERE coach_earning_id=? AND type='class_income'")
      .get(earn.id);
    if (creditTx) {
      const rev = walletService.debitWallet({
        userId: earn.coach_id,
        amount: Number(creditTx.amount),
        type: "adjustment",
        description: `驗收測試自動沖回（${sched.title} · ${sched.id}）`,
        reference: `acceptance-reverse:${earn.id}`,
        sourceType: "acceptance",
        sourceId: earn.id,
      });
      neutralised = { reversed_tx: rev.transaction_id || null, amount: Number(creditTx.amount), ok: !!rev.success, error: rev.error || null };
    }
    db.prepare("UPDATE coach_earnings SET status='cancelled', is_acceptance_test=1, updated_at=datetime('now') WHERE id=?").run(earn.id);
    db.prepare(
      `UPDATE users SET total_earnings = COALESCE((SELECT SUM(net_amount) FROM coach_earnings
         WHERE coach_id=? AND status!='cancelled' AND COALESCE(is_acceptance_test,0)=0),0),
         pending_payout = COALESCE(wallet_balance,0) WHERE id=?`,
    ).run(earn.coach_id, earn.coach_id);
    audit({
      actionType: "acceptance.financial_neutralised",
      entityType: "coach_earning",
      entityId: earn.id,
      userId: null,
      newValues: { net_cents: earn.net_amount_cents, wallet_reversed: neutralised },
      description: "驗收：教練收益分錄標記測試並沖回錢包（金錢零影響）",
    });
  } catch (e) {
    neutralised = { ok: false, error: e.message };
    log(`  ⚠️ 沖回錢包失敗，請人手檢查：${e.message}`);
  }
}

log(
  `\n⑥ 點名 + 結算\n  attendance_status=${db.prepare("SELECT attendance_status FROM bookings WHERE id=?").get(bookingId).attendance_status}` +
    (earn
      ? `\n  教練 ${coach.name}：enrolled=${earn.enrolled_count} · gross=${earn.gross_amount_cents} cents · net=${earn.net_amount_cents} cents（${yuan(earn.net_amount_cents)}）`
      : "\n  ⚠️ 找不到 coach_earnings 分錄"),
);
if (neutralised) {
  log(
    neutralised.ok
      ? `  💰 已即時沖回教練錢包 ${yuan(Math.round(neutralised.amount * 100))}，分錄標記 cancelled + is_acceptance_test=1（金錢零影響；--keep-financials 可保留）`
      : `  ⚠️ 沖回未完成：${neutralised.error}`,
  );
}

// ---------- ⑦ 核對 ----------
log("\n⑦ 核對");
const passAfter = db.prepare("SELECT * FROM user_passes WHERE id=?").get(passId);
ok(Number(passAfter.remaining_credits) === PASS_CREDITS - 1, "Pass 餘額 4 → 3", passAfter.remaining_credits);

const red = db.prepare("SELECT * FROM pass_redemptions WHERE booking_id=?").all(bookingId);
ok(red.length === 1 && Number(red[0].credits) === 1, "pass_redemptions 有 1 筆扣 1 堂", red.length ? `${red[0].credits} 堂` : "0 筆");

const att = db.prepare("SELECT attendance_status, status FROM bookings WHERE id=?").get(bookingId);
ok(att.attendance_status === "present", "attendance_status = present", att.attendance_status);

ok(!!earn, "coach_earnings 分錄存在", earn ? earn.id : "無");
if (earn) {
  const net = earn.net_amount_cents;
  const isInt = net != null && Number.isInteger(Number(net));
  ok(isInt, "教練淨額為整數 cents（無浮點）", net);
  const expectGross = unitCents * Number(earn.enrolled_count || 0);
  ok(
    Number(earn.gross_amount_cents) === expectGross,
    "gross = 牌價 × 席位（整數 cents）",
    `${earn.gross_amount_cents} vs ${expectGross}`,
  );
  const expectNet = Number(earn.enrolled_count || 0) * Math.floor(unitCents * rate);
  ok(Number(net) === expectNet, `net = Σ floor(席位價 × ${(rate * 100).toFixed(0)}%)`, `${net} vs ${expectNet}`);
  const noFloatDrift = Math.abs(Number(earn.net_amount) * 100 - Number(net)) <= 1;
  ok(noFloatDrift, "net_amount（元）與 cents 一致（誤差 ≤1 cent）", `${earn.net_amount} vs ${net} cents`);
  if (unitCents === EXPECTED_UNIT_CENTS) {
    ok(
      Number(net) === 11200 * Number(earn.enrolled_count || 0),
      "淨額符合 HK$140 × 80% = 11200 cents／位",
      `${net} vs ${11200 * Number(earn.enrolled_count || 0)}`,
    );
  }
}

// ---------- ⑧ family-e2e-check.sh ----------
let checkExit = null;
let checkTail = "";
if (RUN_CHECK) {
  log("\n⑧ 執行 family-e2e-check.sh");
  try {
    const { spawnSync } = require("child_process");
    const r = spawnSync(
      "bash",
      [path.join(ROOT, "zenpass-tester/scripts/family-e2e-check.sh"), PAYER_PHONE, MEMBER_PHONE, sched.id],
      { encoding: "utf8", env: { ...process.env, DB_PATH }, maxBuffer: 8 * 1024 * 1024 },
    );
    checkExit = r.status;
    const all = `${r.stdout || ""}${r.stderr || ""}`;
    console.log(all);
    checkTail = all.trim().split("\n").slice(-8).join("\n");
  } catch (e) {
    checkExit = 1;
    checkTail = e.message;
    log(`  ❌ 無法執行核對腳本：${e.message}`);
  }
}

// ---------- 報告 ----------
const report = {
  generated_at: new Date().toISOString(),
  db: DB_PATH,
  dry_run: DRY_RUN,
  payer: { id: payer.id, name: payer.name, phone: payer.phone },
  member: { id: member.id, name: member.name, phone: member.phone },
  family_group_id: familyId,
  pass: { id: passId, plan: PASS_PLAN, total: PASS_CREDITS, remaining: passAfter.remaining_credits, price_cents: PASS_PRICE_CENTS },
  schedule: { id: sched.id, title: sched.title, start_time: sched.start_time, coach: coach.name, rate },
  booking: { id: bookingId, reference: bookingRef, status: att.status, attendance_status: att.attendance_status },
  redemption: red.map((x) => ({ id: x.id, credits: x.credits, status: x.status })),
  coach_earning: earn
    ? {
        id: earn.id,
        enrolled: earn.enrolled_count,
        gross_cents: earn.gross_amount_cents,
        net_cents: earn.net_amount_cents,
        is_acceptance_test: onlyTestSchedule ? 1 : 0,
        neutralised,
      }
    : null,
  checks_failed: fails,
  family_e2e_check: { exit_code: checkExit, tail: checkTail },
};

const jsonPath =
  typeof getArg("json", null) === "string"
    ? getArg("json", null)
    : path.join(ROOT, "test-reports", `family-acceptance-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
try {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
} catch (e) {
  console.error("寫報告失敗：", e.message);
}

log("\n────────────────────────────────────────────");
log(` 自我核對：${fails.length === 0 ? "全綠 ✅" : `❌ ${fails.length} 項未達標：` + fails.join("、")}`);
log(
  RUN_CHECK
    ? ` family-e2e-check：${checkExit === 0 ? "exit 0 ✅ 可簽核" : `exit ${checkExit} ⚠️`}`
    : " family-e2e-check：略過（--no-check）",
);
log(` 報告：${jsonPath}`);
log("────────────────────────────────────────────");

const bad = fails.length > 0 || (RUN_CHECK && checkExit !== 0);
process.exit(bad ? 1 : 0);
