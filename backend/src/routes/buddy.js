/**
 * Phase 2.6 — 二人同行 Buddy Pass（Stripe Checkout + 24h 自動退款）
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const passes = require("../services/passes");
const familyWallet = require("../services/family-wallet");
const { audit } = require("../services/audit");

const router = express.Router();
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const FRONTEND_URL = process.env.CORS_ORIGIN || "http://localhost:3001";
const BUDDY_PRICE = 46000;
let stripeClient = null;
function getStripe() {
  if (!stripeClient && STRIPE_SECRET && STRIPE_SECRET !== "sk_test_xxxx") stripeClient = require("stripe")(STRIPE_SECRET);
  return stripeClient;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS buddy_groups (
      id TEXT PRIMARY KEY,
      initiator_user_id TEXT NOT NULL,
      partner_user_id TEXT,
      plan_key TEXT NOT NULL DEFAULT 'buddy_pack_4',
      price_per_person_cents INTEGER NOT NULL DEFAULT 46000,
      status TEXT DEFAULT 'pending',
      share_token TEXT UNIQUE NOT NULL,
      payment_intent_id TEXT,
      partner_payment_intent_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_buddy_token ON buddy_groups(share_token,status);
    CREATE INDEX IF NOT EXISTS idx_buddy_expiry ON buddy_groups(status,expires_at);
    CREATE TABLE IF NOT EXISTS referral_rewards (
      id TEXT PRIMARY KEY,
      referrer_user_id TEXT NOT NULL,
      referred_user_id TEXT NOT NULL,
      reward_type TEXT DEFAULT 'bonus_pass_unit',
      reward_units INTEGER DEFAULT 1,
      status TEXT DEFAULT 'rewarded',
      trigger_pass_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_referral_referrer ON referral_rewards(referrer_user_id);
  `);
  const cols = db.prepare("PRAGMA table_info(buddy_groups)").all().map((c) => c.name);
  if (!cols.includes("payment_intent_id")) db.exec("ALTER TABLE buddy_groups ADD COLUMN payment_intent_id TEXT");
  if (!cols.includes("partner_payment_intent_id")) db.exec("ALTER TABLE buddy_groups ADD COLUMN partner_payment_intent_id TEXT");
}

function maskName(name) {
  const s = String(name || "學員");
  if (s.length <= 1) return s + "*";
  if (s.length === 2) return s[0] + "*";
  return s[0] + "*".repeat(s.length - 2) + s[s.length - 1];
}

function issueBuddyPass(db, group, userId, role, payRef) {
  const user = db.prepare("SELECT id,name,phone FROM users WHERE id=?").get(userId);
  if (!user) throw new Error("USER_NOT_FOUND");
  const existing = db.prepare("SELECT * FROM user_passes WHERE payment_intent_id=?").get(payRef);
  if (existing) return existing;
  const r = passes.issuePass(db, {
    userId,
    phone: user.phone,
    studentName: user.name,
    totalCredits: 4,
    pricePaid: 460,
    validDays: 60,
    notes: `buddy:${group.id}:${role}`,
    ownerUserId: userId,
  });
  if (!r.ok) throw new Error(r.error || "PASS_ISSUE_FAILED");
  db.prepare("UPDATE user_passes SET payment_intent_id=?, pass_type='buddy_pack_4', owner_user_id=? WHERE id=?").run(
    payRef,
    userId,
    r.pass.id,
  );
  return db.prepare("SELECT * FROM user_passes WHERE id=?").get(r.pass.id);
}

function completeGroup(db, { token, partnerUserId, partnerPaymentIntentId }) {
  let inTx = false;
  try {
    ensureSchema(db);
    passes.ensureSchema(db);
    familyWallet.ensureSchema(db);
    db.exec("BEGIN IMMEDIATE");
    inTx = true;
    const g = db.prepare("SELECT * FROM buddy_groups WHERE share_token=?").get(token);
    if (!g) throw Object.assign(new Error("找不到拼團"), { code: "BUDDY_NOT_FOUND" });
    if (g.status === "completed") {
      db.exec("COMMIT"); inTx = false;
      return { ok: true, duplicated: true, group: g };
    }
    if (g.status !== "pending") throw Object.assign(new Error("拼團已失效"), { code: "BUDDY_NOT_PENDING" });
    if (partnerUserId === g.initiator_user_id) throw Object.assign(new Error("不可以加入自己發起的拼團"), { code: "CANNOT_JOIN_OWN_GROUP" });
    if (new Date(g.expires_at.replace(" ", "T") + "Z").getTime() <= Date.now()) {
      throw Object.assign(new Error("拼團已過期"), { code: "BUDDY_EXPIRED" });
    }
    const initiatorPass = issueBuddyPass(db, g, g.initiator_user_id, "initiator", `buddy_${g.id}_a`);
    const partnerPass = issueBuddyPass(db, g, partnerUserId, "partner", `buddy_${g.id}_b`);
    db.prepare(
      "UPDATE buddy_groups SET partner_user_id=?, status='completed', completed_at=datetime('now'), partner_payment_intent_id=? WHERE id=? AND status='pending'",
    ).run(partnerUserId, partnerPaymentIntentId || null, g.id);
    try {
      db.prepare(
        `INSERT INTO referral_rewards (id,referrer_user_id,referred_user_id,reward_type,reward_units,status,trigger_pass_id)
         VALUES (?,?,?,'bonus_pass_unit',1,'rewarded',?)`,
      ).run("rf_" + crypto.randomBytes(8).toString("hex"), g.initiator_user_id, partnerUserId, partnerPass.id);
    } catch (e) {}
    db.exec("COMMIT");
    inTx = false;
    try {
      audit({
        actionType: "buddy_group.completed_both_issued",
        entityType: "buddy_group",
        entityId: g.id,
        userId: partnerUserId,
        newValues: { initiator_pass: initiatorPass.id, partner_pass: partnerPass.id, amount_cents: BUDDY_PRICE },
        description: "二人同行拼團完成，雙方各發 4 堂 Pass",
      });
    } catch (e) {}
    return { ok: true, duplicated: false, group: { ...g, partner_user_id: partnerUserId, status: "completed" }, initiatorPass, partnerPass };
  } catch (e) {
    if (inTx) { try { db.exec("ROLLBACK"); } catch (x) {} }
    return { ok: false, code: e.code || "BUDDY_COMPLETE_FAILED", error: e.message };
  }
}

router.post("/buddy/create-group", authenticateToken, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ success: false, error: "線上付款暫未開通" });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: req.user.email || undefined,
      client_reference_id: req.user.id,
      line_items: [{
        price_data: {
          currency: "hkd",
          product_data: { name: "二人同行 Buddy Pass（4 堂 / 人）", description: "24 小時內成團，雙方各得 4 堂" },
          unit_amount: BUDDY_PRICE,
        },
        quantity: 1,
      }],
      metadata: { kind: "buddy_create", user_id: req.user.id },
      success_url: `${FRONTEND_URL}/buddy.html?buddy_created=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/pass.html?buddy_cancel=1`,
    });
    res.json({ success: true, checkout_url: session.url, session_id: session.id, price_cents: BUDDY_PRICE });
  } catch (e) {
    console.error("[BUDDY] create:", e.message);
    res.status(500).json({ success: false, error: "建立拼團付款失敗" });
  }
});

router.post("/buddy/complete-create", authenticateToken, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ success: false, error: "線上付款暫未開通" });
    const session = await stripe.checkout.sessions.retrieve(String((req.body || {}).session_id || ""));
    if (!session || session.payment_status !== "paid") return res.status(402).json({ success: false, error: "付款尚未完成" });
    const md = session.metadata || {};
    if (md.kind !== "buddy_create" || md.user_id !== req.user.id) return res.status(403).json({ success: false, error: "付款不屬於你" });
    if (Number(session.amount_total) !== BUDDY_PRICE) return res.status(400).json({ success: false, error: "金額不符" });
    const db = getDb();
    ensureSchema(db);
    const existing = db.prepare("SELECT * FROM buddy_groups WHERE payment_intent_id=?").get(session.payment_intent || session.id);
    if (existing) return res.json({ success: true, token: existing.share_token, share_url: `${FRONTEND_URL}/buddy.html?token=${existing.share_token}`, duplicated: true });
    const id = "bg_" + crypto.randomBytes(8).toString("hex");
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 24 * 3600000).toISOString().slice(0, 19).replace("T", " ");
    db.prepare(
      `INSERT INTO buddy_groups (id,initiator_user_id,plan_key,price_per_person_cents,status,share_token,payment_intent_id,expires_at)
       VALUES (?,?, 'buddy_pack_4', ?, 'pending', ?, ?, ?)`,
    ).run(id, req.user.id, BUDDY_PRICE, token, session.payment_intent || session.id, expires);
    res.status(201).json({ success: true, group_id: id, token, share_url: `${FRONTEND_URL}/buddy.html?token=${token}`, expires_at: expires });
  } catch (e) {
    console.error("[BUDDY] complete-create:", e.message);
    res.status(500).json({ success: false, error: "建立拼團失敗" });
  }
});

router.get("/public/buddy/:token", (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const g = db.prepare(
      `SELECT b.*, u.name AS initiator_name FROM buddy_groups b JOIN users u ON u.id=b.initiator_user_id WHERE b.share_token=?`,
    ).get(req.params.token);
    if (!g) return res.status(404).json({ success: false, error: "找不到拼團" });
    const expired = new Date(g.expires_at.replace(" ", "T") + "Z").getTime() <= Date.now();
    res.json({
      success: true,
      status: expired && g.status === "pending" ? "expired" : g.status,
      initiator_name_masked: maskName(g.initiator_name),
      price_per_person_cents: g.price_per_person_cents,
      expires_at: g.expires_at,
      is_expired: expired,
      plan_key: g.plan_key,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取拼團失敗" });
  }
});

router.post("/buddy/:token/join", authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    ensureSchema(db);
    const g = db.prepare("SELECT * FROM buddy_groups WHERE share_token=?").get(req.params.token);
    if (!g) return res.status(404).json({ success: false, error: "找不到拼團" });
    if (g.initiator_user_id === req.user.id) return res.status(400).json({ success: false, code: "CANNOT_JOIN_OWN_GROUP", error: "不可以加入自己發起的拼團" });
    if (g.status !== "pending") return res.status(409).json({ success: false, code: "BUDDY_NOT_PENDING", error: "拼團已失效或已完成" });
    if (new Date(g.expires_at.replace(" ", "T") + "Z").getTime() <= Date.now()) return res.status(409).json({ success: false, code: "BUDDY_EXPIRED", error: "拼團已過期" });
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ success: false, error: "線上付款暫未開通" });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: req.user.email || undefined,
      client_reference_id: req.user.id,
      line_items: [{
        price_data: {
          currency: "hkd",
          product_data: { name: "二人同行 Buddy Pass（4 堂）", description: `與 ${maskName((db.prepare("SELECT name FROM users WHERE id=?").get(g.initiator_user_id) || {}).name)} 一同成團` },
          unit_amount: BUDDY_PRICE,
        },
        quantity: 1,
      }],
      metadata: { kind: "buddy_join", user_id: req.user.id, token: req.params.token },
      success_url: `${FRONTEND_URL}/buddy.html?token=${req.params.token}&buddy_joined=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/buddy.html?token=${req.params.token}`,
    });
    res.json({ success: true, checkout_url: session.url, session_id: session.id, price_cents: BUDDY_PRICE });
  } catch (e) {
    console.error("[BUDDY] join:", e.message);
    res.status(500).json({ success: false, error: "建立參團付款失敗" });
  }
});

router.post("/buddy/complete-join", authenticateToken, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ success: false, error: "線上付款暫未開通" });
    const b = req.body || {};
    const session = await stripe.checkout.sessions.retrieve(String(b.session_id || ""));
    if (!session || session.payment_status !== "paid") return res.status(402).json({ success: false, error: "付款尚未完成" });
    const md = session.metadata || {};
    if (md.kind !== "buddy_join" || md.user_id !== req.user.id || md.token !== b.token) {
      return res.status(403).json({ success: false, error: "付款不屬於此拼團" });
    }
    if (Number(session.amount_total) !== BUDDY_PRICE) return res.status(400).json({ success: false, error: "金額不符" });
    const r = completeGroup(getDb(), {
      token: md.token,
      partnerUserId: req.user.id,
      partnerPaymentIntentId: session.payment_intent || session.id,
    });
    if (!r.ok) return res.status(400).json({ success: false, code: r.code, error: r.error });
    res.status(r.duplicated ? 200 : 201).json({
      success: true,
      duplicated: r.duplicated,
      group_id: r.group.id,
      initiator_pass_id: r.initiatorPass && r.initiatorPass.id,
      partner_pass_id: r.partnerPass && r.partnerPass.id,
      message: "拼團成功，雙方各獲 4 堂 Pass",
    });
  } catch (e) {
    console.error("[BUDDY] complete-join:", e.message);
    res.status(500).json({ success: false, error: "完成拼團失敗" });
  }
});

function cleanupExpired(db, refundFn) {
  ensureSchema(db);
  const rows = db.prepare("SELECT * FROM buddy_groups WHERE status='pending' AND datetime(expires_at) <= datetime('now')").all();
  const done = [];
  for (const g of rows) {
    try {
      if (g.payment_intent_id && refundFn) refundFn(g.payment_intent_id);
      db.prepare("UPDATE buddy_groups SET status='expired' WHERE id=? AND status='pending'").run(g.id);
      try {
        audit({
          actionType: "buddy_group.expired_refunded",
          entityType: "buddy_group",
          entityId: g.id,
          userId: g.initiator_user_id,
          newValues: { payment_intent_id: g.payment_intent_id },
          description: "24 小時未成團，自動退款",
        });
      } catch (e) {}
      done.push(g.id);
    } catch (e) {
      console.error("[BUDDY] refund failed:", g.id, e.message);
    }
  }
  return { processed: done.length, expired: done };
}

router.post("/internal/cron/buddy-cleanup", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stripe = getStripe();
    const refundFn = stripe ? (pi) => stripe.refunds.create({ payment_intent: pi }) : null;
    const r = cleanupExpired(getDb(), refundFn);
    res.json({ success: true, ...r });
  } catch (e) {
    res.status(500).json({ success: false, error: "清理失敗" });
  }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
module.exports.completeGroup = completeGroup;
module.exports.cleanupExpired = cleanupExpired;
module.exports.BUDDY_PRICE = BUDDY_PRICE;
module.exports.maskName = maskName;
