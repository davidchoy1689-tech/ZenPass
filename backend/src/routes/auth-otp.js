/**
 * 工單十三 — 長者免密碼 OTP 登入
 *  POST /api/auth/otp/send    { phone }
 *  POST /api/auth/otp/verify  { phone, otp_code, name?, ref?, device_id? }
 *
 * 只影響 /api/auth/*（CSRF 白名單），唔會污染其他路由。
 */
const express = require("express");
const { setAuthCookie } = require("../middleware/auth");
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

module.exports = router;
