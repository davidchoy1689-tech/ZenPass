#!/usr/bin/env node
/**
 * settle-manual-booking-payment.js — 人手確認線下付款（FPS／PayMe／現金）
 *
 * 用途：學員以 FPS 補付某張已存在 booking（例如定價錯誤導致 $0 出票），
 *       管理員核對入數後，一次性把 booking 轉為已付款並補寫 ledger + 教練收入。
 *
 * 用法：
 *   node scripts/settle-manual-booking-payment.js --booking <id> --amount 160 \
 *        --ref <FPS 交易編號> [--method fps|payme|cash] [--apply]
 *
 * 預設 dry-run（只顯示將會做乜）；加 --apply 才寫入。
 * 安全：已存在 payment ledger 嘅 booking 一律拒絕（idempotent，防重複入帳）。
 */
const path = require("path");
const BACKEND_ROOT = process.env.ZP_BACKEND || path.join(__dirname, "..");
process.chdir(BACKEND_ROOT);

const args = process.argv.slice(2);
const get = (k, d = null) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const APPLY = args.includes("--apply");
const bookingId = get("booking");
const amount = Number(get("amount"));
const ref = String(get("ref") || "").trim();
const method = String(get("method") || "fps").toLowerCase();

if (!bookingId || !Number.isFinite(amount) || amount <= 0) {
  console.error("用法：node scripts/settle-manual-booking-payment.js --booking <id> --amount 160 --ref <FPS ref> [--method fps] [--apply]");
  process.exit(2);
}
if (!["fps", "payme", "cash"].includes(method)) {
  console.error("method 只准 fps / payme / cash");
  process.exit(2);
}

const { getDb } = require(path.join(BACKEND_ROOT, "src/services/database"));
const accounting = require(path.join(BACKEND_ROOT, "src/services/accounting"));
const { audit } = require(path.join(BACKEND_ROOT, "src/services/audit"));

const db = getDb();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const b = db.prepare("SELECT * FROM bookings WHERE id = ?").get(bookingId);
if (!b) {
  console.error("❌ 找不到 booking:", bookingId);
  process.exit(1);
}

const existingLedger = accounting
  .getEntriesByBooking(bookingId)
  .filter((e) => e.transaction_type === "payment");
if (existingLedger.length) {
  console.error("❌ 此 booking 已有 payment ledger，拒絕重複入帳（", existingLedger.length, "筆）");
  process.exit(1);
}

const rate = Number(b.platform_commission_rate);
const effectiveRate = Number.isFinite(rate) && rate > 0 ? rate : 0.25;
const hasVenue = !!b.venue_partner_id;
const platform = hasVenue ? round2(amount * effectiveRate) : 0;
const venue = hasVenue ? round2(amount - platform) : 0;

console.log("========================================");
console.log(APPLY ? "🔴 APPLY 模式：將會寫入" : "🟡 DRY-RUN（加 --apply 才寫入）");
console.log("Booking        :", b.id.slice(0, 8), b.booking_reference || "");
console.log("用戶           :", b.user_id.slice(0, 8));
console.log("現狀           :", b.status, "/", b.payment_status, "/", b.payment_type, "/ HK$" + (b.amount || 0));
console.log("新付款         :", method.toUpperCase(), ref || "(冇 reference)", "/ HK$" + amount);
console.log("拆賬           : 平台", platform, "/ 場地", venue, "/ 教練應付", round2(amount - platform - venue));
console.log("========================================");

if (!APPLY) process.exit(0);

const tx = db.transaction(() => {
  db.prepare(
    `UPDATE bookings SET
       amount = ?, amount_cents = ?,
       payment_type = 'single', payment_method = ?,
       fps_reference = COALESCE(NULLIF(?, ''), fps_reference),
       payme_reference = COALESCE(NULLIF(?, ''), payme_reference),
       payment_status = 'paid', status = 'confirmed',
       platform_earned_amount = ?, venue_earned_amount = ?,
       platform_earned_amount_cents = ?, venue_earned_amount_cents = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    amount,
    Math.round(amount * 100),
    method,
    method === "fps" ? ref : "",
    method === "payme" ? ref : "",
    platform,
    venue,
    Math.round(platform * 100),
    Math.round(venue * 100),
    bookingId,
  );
});

try {
  tx();
} catch (e) {
  // 舊 schema 未必有 *_cents 欄位 → 退回基本更新
  console.warn("⚠️ 完整更新失敗，改用基本欄位:", e.message);
  db.prepare(
    `UPDATE bookings SET amount = ?, payment_type = 'single', payment_method = ?,
       fps_reference = COALESCE(NULLIF(?, ''), fps_reference),
       payme_reference = COALESCE(NULLIF(?, ''), payme_reference), payment_status = 'paid',
       status = 'confirmed', platform_earned_amount = ?, venue_earned_amount = ?,
       updated_at = datetime('now') WHERE id = ?`,
  ).run(
    amount, method,
    method === "fps" ? ref : "",
    method === "payme" ? ref : "",
    platform, venue, bookingId,
  );
}

let ledgerOk = false;
try {
  ledgerOk = accounting.postBookingSplitLedger(bookingId, b.user_id, amount, method);
} catch (e) {
  console.error("⚠️ ledger 寫入失敗:", e.message);
}

try {
  require(path.join(BACKEND_ROOT, "src/routes/coach-earnings")).syncCoachEarningsForSchedule(b.schedule_id);
} catch (e) {
  console.error("⚠️ 教練收入同步失敗:", e.message);
}

try {
  audit({
    actionType: "booking.manual_payment_confirmed",
    entityType: "booking",
    entityId: bookingId,
    userId: "system",
    oldValues: { amount: b.amount, payment_status: b.payment_status, payment_type: b.payment_type },
    newValues: { amount, method, reference: ref, platform_earned_amount: platform, venue_earned_amount: venue },
    description: `人手確認線下付款 HK$${amount}（${method}${ref ? " / " + ref : ""}）並補寫 ledger`,
  });
} catch (e) {
  console.error("⚠️ audit 寫入失敗:", e.message);
}

console.log(ledgerOk ? "✅ 已更新 booking、寫入 ledger、同步教練收入" : "⚠️ booking 已更新，但 ledger 未寫入，請檢查");
