/**
 * Phase 6.6（C 階段）：教練首次開通 5 步檢核
 *
 *   GET /api/coach/lifecycle/onboarding-status
 *
 * 全部由真實資料計算，冇假數據：
 *   C1 帳號開通   users.phone_verified_at
 *   C2 專長認證   coach_credentials（status=verified 或 有 license_no + qualified_sports）
 *   C3 收款戶口   users.bank_name + bank_account（或 payout_status）
 *   C4 保險核驗   coach_credentials.insurance_expiry_date 未過期
 *   C5 場地資料   名下班次有合作場地 或 已填自租地址／交通指引
 */
const express = require("express");
const router = express.Router();
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");

function safe(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

router.get("/onboarding-status", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const uid = req.user.id;

    const user = safe(
      () =>
        db
          .prepare(
            `SELECT id, name, phone, phone_verified_at, bank_name, bank_account, bank_code,
                    payout_status, wallet_balance
               FROM users WHERE id = ?`,
          )
          .get(uid),
      null,
    );
    if (!user) return res.status(404).json({ ok: false, error: "USER_NOT_FOUND" });

    const cred = safe(
      () =>
        db
          .prepare(
            `SELECT status, license_no, license_expiry, qualified_sports,
                    insurance_policy_no, insurance_expiry_date, first_aid_expiry
               FROM coach_credentials WHERE user_id = ?
              ORDER BY datetime(updated_at) DESC LIMIT 1`,
          )
          .get(uid),
      null,
    );

    // C5：名下班次有冇場地資料
    let venueReady = false;
    let venueNote = "未開過班";
    safe(() => {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n,
                  SUM(CASE WHEN COALESCE(cs.custom_venue_address,'') <> ''
                             OR COALESCE(cs.custom_transit_guide,'') <> ''
                             OR c.partner_venue_id IS NOT NULL THEN 1 ELSE 0 END) AS ok
             FROM class_schedules cs
             LEFT JOIN classes c ON c.id = cs.class_id
            WHERE cs.coach_id = ?`,
        )
        .get(uid);
      if (row && row.n > 0) {
        venueReady = Number(row.ok) > 0;
        venueNote = venueReady ? "已有場地地址" : `${row.n} 個班次未填地址`;
      }
    }, null);

    const today = new Date().toISOString().slice(0, 10);

    const c1 = !!user.phone_verified_at;
    const c2 = !!(cred && (cred.status === "verified" || (cred.license_no && (cred.qualified_sports || "").length > 0)));
    const c3 = !!(user.bank_name && user.bank_account);
    const c4 = !!(cred && cred.insurance_expiry_date && String(cred.insurance_expiry_date).slice(0, 10) >= today);
    const c5 = venueReady;

    const steps = [
      {
        key: "C1",
        label: "帳號開通",
        done: c1,
        hint: c1 ? "手機已驗證" : "未驗證手機",
        cta: c1 ? null : { text: "驗證手機", href: "profile.html" },
      },
      {
        key: "C2",
        label: "專長認證",
        done: c2,
        hint: c2 ? (cred.status === "verified" ? "已核實" : "已提交，待核實") : "未提交牌照／資歷",
        cta: c2 ? null : { text: "上傳資歷", href: "coach-profile.html" },
      },
      {
        key: "C3",
        label: "收款戶口",
        done: c3,
        hint: c3 ? `${user.bank_name} ••••${String(user.bank_account).slice(-3)}` : "未填銀行戶口",
        cta: c3 ? null : { text: "填寫戶口", href: "coach-earnings.html" },
      },
      {
        key: "C4",
        label: "保險核驗",
        done: c4,
        hint: c4 ? `有效至 ${String(cred.insurance_expiry_date).slice(0, 10)}` : "保單未填或已過期",
        cta: c4 ? null : { text: "上載保單", href: "coach-profile.html" },
      },
      {
        key: "C5",
        label: "場地資料",
        done: c5,
        hint: c5 ? "已有地址／交通指引" : venueNote,
        cta: c5 ? null : { text: "補場地資料", href: "coach-schedule.html" },
      },
    ];

    const completed = steps.filter((s) => s.done).length;
    return res.json({
      ok: true,
      completed,
      total: steps.length,
      percent: Math.round((completed / steps.length) * 100),
      steps,
      ready_to_teach: completed === steps.length,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "ONBOARDING_STATUS_FAILED", message: e.message });
  }
});

module.exports = router;
