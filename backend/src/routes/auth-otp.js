/**
 * 工單十三 — 長者免密碼 OTP 登入
 *  POST /api/auth/otp/send    { phone }
 *  POST /api/auth/otp/verify  { phone, otp_code, name?, ref?, device_id? }
 *
 * 只影響 /api/auth/*（CSRF 白名單），唔會污染其他路由。
 */
const express = require("express");
const { setAuthCookie } = require("../middleware/auth");
const { authenticateToken } = require("../middleware/auth");
const phoneGate = require("../services/phone-gate");
const otp = require("../services/otp-service");
const referral = require("../services/referral-rewards");
const { getDb } = require("../services/database");

const router = express.Router();

router.post("/otp/send", async (req, res) => {
  try {
    const out = await otp.sendOtp({
      phone: (req.body || {}).phone,
      ip: req.ip || "",
    });
    return res.status(out.status).json(out.body);
  } catch (e) {
    console.error("[OTP] send:", e.message);
    res.status(500).json({ success: false, error: "發送驗證碼失敗，請再試" });
  }
});

router.post("/otp/verify", async (req, res) => {
  try {
    const b = req.body || {};
    try {
      if (require("../services/emergency").isBlacklisted(getDb(), "ip", req.ip || "")) {
        return res.status(403).json({ success: false, code: "IP_BLOCKED", error: "此網絡已被安全系統攔截，請聯絡客服" });
      }
    } catch (e) {}
    const out = await otp.verifyOtp({
      phone: b.phone,
      code: b.otp_code || b.code,
      name: b.name,
      deviceId: b.device_id || b.deviceId,
    });
    if (out.status !== 200 || !out.token) return res.status(out.status).json(out.body);

    setAuthCookie(res, out.token, 30 * 86400 * 1000);
    try { phoneGate.markVerified(out.user.id); } catch (e) {}

    // 登入時帶推薦碼（?ref=）→ 即刻綁定，待首堂出席先派堂
    let referral_result = null;
    const refCode = String(b.ref || "").trim();
    if (refCode) {
      try {
        const r = referral.claimCode(out.user.id, refCode, {
          deviceId: b.device_id || b.deviceId,
          ip: req.ip || "",
        });
        referral_result = { ok: r.status === 200, ...r.body };
      } catch (e) {
        referral_result = { ok: false, error: e.message };
      }
    }

    res.json({ ...out.body, referral: referral_result });
  } catch (e) {
    console.error("[OTP] verify:", e.message);
    res.status(500).json({ success: false, error: "驗證失敗，請再試" });
  }
});

// ===== 已登入用戶驗證自己手機（購買 Pass / 家庭錢包前置）=====
router.post("/phone/send-otp", authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    const u = db.prepare("SELECT phone FROM users WHERE id=?").get(req.user.id);
    const p = String(u?.phone || "").replace(/\D/g, "").replace(/^852/, "");
    if (!/^[4-9]\d{7}$/.test(p)) {
      return res.status(400).json({ success: false, code: "PHONE_REQUIRED", error: "請先在個人資料補填有效香港手機號碼" });
    }
    const out = await otp.sendOtp({ phone: p, ip: req.ip || "" });
    return res.status(out.status).json(out.body);
  } catch (e) {
    console.error("[PHONE GATE] send:", e.message);
    res.status(500).json({ success: false, error: "發送驗證碼失敗" });
  }
});

router.post("/phone/confirm-otp", authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    const u = db.prepare("SELECT phone FROM users WHERE id=?").get(req.user.id);
    const p = String(u?.phone || "").replace(/\D/g, "").replace(/^852/, "");
    if (!/^[4-9]\d{7}$/.test(p)) {
      return res.status(400).json({ success: false, code: "PHONE_REQUIRED", error: "請先在個人資料補填有效香港手機號碼" });
    }
    const out = await otp.verifyOtp({ phone: p, code: (req.body || {}).otp_code || (req.body || {}).code });
    if (out.status !== 200) return res.status(out.status).json(out.body);
    if (!out.user || out.user.id !== req.user.id) {
      return res.status(409).json({ success: false, code: "PHONE_IN_USE", error: "此號碼已綁定其他帳戶，請聯絡客服" });
    }
    phoneGate.markVerified(req.user.id);
    res.json({ success: true, phone_verified: true, message: "手機號碼已驗證" });
  } catch (e) {
    console.error("[PHONE GATE] confirm:", e.message);
    res.status(500).json({ success: false, error: "驗證失敗" });
  }
});

module.exports = router;
