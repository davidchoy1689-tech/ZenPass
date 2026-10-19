/**
 * referral-service.js — 推薦碼兌換（2026-10-20）
 *
 * 雙方各得 5 Credits（≈HK$50），全部經 credit-ledger 入賬，
 * 支援「註冊時帶入、驗證電郵後自動入賬」。
 */
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("./database");
const { writeBlock } = require("./blockchain-audit");
const { applyCredits } = require("./credit-ledger");
const { awardPointsOnce, EARN_RULES } = require("./points");

const REFERRAL_CREDITS = 5;

function redeemCode(userId, code, { requireVerified = true } = {}) {
  const db = getDb();
  db.pragma("foreign_keys = ON");

  const c = String(code || "").trim();
  if (!c) return { status: 400, body: { success: false, error: "請輸入推薦碼" } };

  const ref = db.prepare("SELECT * FROM referral_codes WHERE code = ?").get(c);
  if (!ref) return { status: 404, body: { success: false, error: "推薦碼無效" } };
  if (ref.user_id === userId) {
    return { status: 400, body: { success: false, error: "唔可以用自己嘅推薦碼" } };
  }

  const existing = db
    .prepare("SELECT id FROM referral_redemptions WHERE referred_user_id = ?")
    .get(userId);
  if (existing) {
    return { status: 400, body: { success: false, error: "你已經用過推薦碼" } };
  }

  const acct = db.prepare("SELECT email_verified FROM users WHERE id = ?").get(userId);
  if (!acct) return { status: 404, body: { success: false, error: "用戶不存在" } };
  if (requireVerified && !acct.email_verified) {
    return {
      status: 403,
      body: {
        success: false,
        code: "EMAIL_NOT_VERIFIED",
        error: "請先驗證電郵地址，驗證後推薦獎賞會自動入賬。",
      },
    };
  }

  const id = uuidv4();
  let pointsAwarded = 0;
  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO referral_redemptions (id, referrer_id, referred_user_id, code_used, status) VALUES (?, ?, ?, ?, 'completed')",
    ).run(id, ref.user_id, userId, c);

    applyCredits(db, {
      userId,
      credits: REFERRAL_CREDITS,
      type: "earn",
      source: "referral",
      referenceId: id,
      description: "使用推薦碼迎新獎賞（5 Credits）",
    });
    db.prepare(
      "UPDATE users SET referral_credits_earned = COALESCE(referral_credits_earned,0) + ?, pending_referral_code = NULL WHERE id = ?",
    ).run(REFERRAL_CREDITS, userId);

    applyCredits(db, {
      userId: ref.user_id,
      credits: REFERRAL_CREDITS,
      type: "earn",
      source: "referral",
      referenceId: id,
      description: "推薦朋友獎賞（5 Credits）",
    });
    db.prepare(
      "UPDATE users SET referral_credits_earned = COALESCE(referral_credits_earned,0) + ? WHERE id = ?",
    ).run(REFERRAL_CREDITS, ref.user_id);
  });
  tx();

  try {
    writeBlock({
      entityType: "referral_redemption",
      entityId: id,
      data: {
        referrer_id: ref.user_id,
        referred_user_id: userId,
        code: c,
        credits_granted_referrer: REFERRAL_CREDITS,
        credits_granted_referred: REFERRAL_CREDITS,
      },
    });
  } catch (e) {}

  try {
    const award = awardPointsOnce(ref.user_id, {
      points: EARN_RULES.referral,
      source: "referral",
      referenceId: id,
      description: "🤝 推薦朋友加入 ZenPass",
    });
    if (award && award.awarded) pointsAwarded = award.awarded;
  } catch (e) {}

  return {
    status: 200,
    body: {
      message: `✅ 推薦碼已使用！你獲得 ${REFERRAL_CREDITS} Credits（≈HK$50），已存入錢包`,
      bonus: REFERRAL_CREDITS,
      credits: REFERRAL_CREDITS,
      referrer_points_awarded: pointsAwarded,
    },
  };
}

/** 驗證電郵後：自動兌換註冊時帶入嘅推薦碼 */
function autoRedeemPending(userId) {
  try {
    const db = getDb();
    const row = db.prepare("SELECT pending_referral_code FROM users WHERE id = ?").get(userId);
    const code = row && row.pending_referral_code;
    if (!code) return { redeemed: false };
    const out = redeemCode(userId, code, { requireVerified: false });
    if (out.status === 200) return { redeemed: true, credits: REFERRAL_CREDITS };
    // 無效／自己碼／已用過 → 清走，避免無限重試
    if ([400, 404].includes(out.status)) {
      db.prepare("UPDATE users SET pending_referral_code = NULL WHERE id = ?").run(userId);
    }
    return { redeemed: false, reason: out.body && out.body.error };
  } catch (e) {
    console.error("[REFERRAL] auto redeem failed:", e.message);
    return { redeemed: false, reason: e.message };
  }
}

module.exports = { redeemCode, autoRedeemPending, REFERRAL_CREDITS };
