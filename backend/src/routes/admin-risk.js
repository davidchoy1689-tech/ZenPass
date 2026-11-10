/**
 * admin-risk.js — 風控審核台（工單二十二 / 風控 Console）
 *  GET  /api/admin/risk-summary                    首屏統計
 *  GET  /api/admin/risk-tickets                    隊列
 *  GET  /api/admin/risk-tickets/:id                證據鏈詳情
 *  POST /api/admin/risk-tickets/:id/resolve        { action:'unlock'|'reject', notes, challenge? }
 *       unlock：金額 > 門檻 → 第一次回 challenge（初審），第二位管理員帶 challenge 完成覆核
 */
const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const risk = require("../services/risk-control");
const emergency = require("../services/emergency");

const router = express.Router();
router.use(authenticateToken, requireAdmin);

router.get("/risk-summary", (req, res) => {
  try {
    res.json({ success: true, data: risk.summary(getDb()) });
  } catch (e) {
    console.error("[RISK] summary:", e.message);
    res.status(500).json({ success: false, error: "讀取風控統計失敗" });
  }
});

router.get("/risk-tickets", (req, res) => {
  try {
    const rows = risk.listTickets(getDb(), { status: req.query.status || null });
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("[RISK] list:", e.message);
    res.status(500).json({ success: false, error: "讀取風控工單失敗" });
  }
});

router.get("/risk-tickets/:id", (req, res) => {
  try {
    const d = risk.detail(getDb(), req.params.id);
    if (!d) return res.status(404).json({ success: false, error: "找不到工單" });
    res.json({ success: true, data: d });
  } catch (e) {
    console.error("[RISK] detail:", e.message);
    res.status(500).json({ success: false, error: "讀取工單詳情失敗" });
  }
});

const ERR_STATUS = {
  NOT_FOUND: 404,
  BAD_ACTION: 400,
  NOTES_REQUIRED: 400,
  ALREADY_CLOSED: 409,
  SAME_ADMIN: 403,
  CHALLENGE_REQUIRED: 400,
  CHALLENGE_INVALID: 400,
  CHALLENGE_EXPIRED: 410,
};

router.post("/risk-tickets/:id/resolve", (req, res) => {
  try {
    const b = req.body || {};
    const out = risk.resolve(getDb(), {
      ticketId: req.params.id,
      action: String(b.action || ""),
      notes: b.notes || b.resolution_notes || "",
      adminId: req.user.id,
      challenge: b.challenge || b.secondary_challenge || "",
    });
    if (!out.ok) {
      const msgs = {
        NOT_FOUND: "找不到工單",
        NOTES_REQUIRED: "請填寫核實備註（最少 4 字）",
        ALREADY_CLOSED: "此工單已處理",
        SAME_ADMIN: "初審與覆核必須由不同管理員執行",
        CHALLENGE_REQUIRED: "請輸入初審產生的一次性覆核碼",
        CHALLENGE_INVALID: "覆核碼不正確",
        CHALLENGE_EXPIRED: "覆核碼已過期（10 分鐘），請重新初審",
        BAD_ACTION: "操作無效",
      };
      return res.status(ERR_STATUS[out.code] || 400).json({
        success: false,
        code: out.code,
        error: out.error || msgs[out.code] || "操作無效",
      });
    }
    res.json({ success: true, ...out });
  } catch (e) {
    console.error("[RISK] resolve:", e.message);
    res.status(500).json({ success: false, error: "處理失敗" });
  }
});

// ===== 管理員安全 PIN（緊急處置二次授權）=====
router.get("/security/admin-pin", (req, res) => {
  try {
    res.json({ success: true, data: emergency.pinStatus(getDb(), req.user.id) });
  } catch (e) {
    console.error("[RISK] pin status:", e.message);
    res.status(500).json({ success: false, error: "讀取安全 PIN 狀態失敗" });
  }
});

router.post("/security/admin-pin", (req, res) => {
  try {
    const b = req.body || {};
    const out = emergency.setAdminPin(getDb(), req.user.id, { pin: b.pin, password: b.password });
    if (!out.ok) {
      const msgs = {
        PIN_FORMAT: "安全 PIN 必須為 6 位數字",
        BAD_PASSWORD: "登入密碼不正確",
        NOT_FOUND: "找不到管理員帳戶",
      };
      return res.status(400).json({ success: false, code: out.code, error: msgs[out.code] || "設定失敗" });
    }
    res.json({ success: true, message: "安全 PIN 已設定" });
  } catch (e) {
    console.error("[RISK] pin set:", e.message);
    res.status(500).json({ success: false, error: "設定安全 PIN 失敗" });
  }
});

// ===== 🚨 緊急熔斷 =====
router.post("/emergency-lockdown", (req, res) => {
  try {
    const db = getDb();
    const b = req.body || {};
    const coachId = String(b.coach_id || b.coachId || "");
    const reason = String(b.reason || "").trim();
    if (!coachId) return res.status(400).json({ success: false, code: "COACH_REQUIRED", error: "缺少教練 ID" });
    if (reason.length < 4) return res.status(400).json({ success: false, code: "REASON_REQUIRED", error: "請填寫事故原因（最少 4 字）" });

    const pin = emergency.verifyAdminPin(db, req.user.id, b.admin_pin);
    if (!pin.ok) {
      const msgs = {
        PIN_NOT_CONFIGURED: "未設定安全 PIN，請先於風控台設定",
        PIN_INVALID: "管理員安全 PIN 碼錯誤，操作拒絕",
        PIN_LOCKED: "PIN 錯誤次數過多，請 15 分鐘後再試",
      };
      return res.status(pin.code === "PIN_LOCKED" ? 429 : 403).json({
        success: false,
        code: pin.code,
        error: msgs[pin.code] || "授權失敗",
        retry_after: pin.retry_after,
      });
    }

    const out = emergency.lockdown(db, {
      coachId,
      ticketId: b.ticket_id || b.ticketId || null,
      adminId: req.user.id,
      reason,
      ip: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
    });
    if (!out.ok) {
      const msgs = {
        COACH_NOT_FOUND: "找不到教練帳戶",
        PROTECTED_ROLE: "不可對管理員帳戶執行緊急熔斷",
        TICKET_REQUIRED: "需要先有風控工單才能熔斷",
        ALREADY_LOCKED: "此帳號已處於熔斷狀態",
      };
      return res.status(out.code === "NOT_FOUND" ? 404 : 400).json({
        success: false,
        code: out.code,
        error: msgs[out.code] || "熔斷失敗",
      });
    }
    res.json({ success: true, ...out, message: "教練帳號已緊急封鎖，所有 Session 已踢除，資金已急凍。" });
  } catch (e) {
    console.error("[RISK] lockdown:", e.message);
    res.status(500).json({ success: false, error: "緊急熔斷失敗" });
  }
});

// ===== 帳號復原 =====
router.post("/account-recovery", (req, res) => {
  try {
    const db = getDb();
    const b = req.body || {};
    const coachId = String(b.coach_id || b.coachId || "");
    const action = String(b.action || "");
    if (!coachId) return res.status(400).json({ success: false, error: "缺少教練 ID" });
    let out;
    if (action === "issue_reset") {
      out = emergency.issueReset(db, { coachId, adminId: req.user.id, notes: b.notes, ip: req.ip || "" });
    } else if (action === "reactivate") {
      out = emergency.reactivate(db, {
        coachId,
        adminId: req.user.id,
        notes: b.notes,
        idVerified: b.id_verified === true || b.id_verified === 1 || b.id_verified === "true",
        ip: req.ip || "",
      });
    } else {
      return res.status(400).json({ success: false, code: "BAD_ACTION", error: "操作無效" });
    }
    if (!out.ok) {
      const msgs = {
        NOT_FOUND: "找不到帳戶",
        NO_PHONE: "帳戶未綁定有效手機，無法發送重設連結",
        ID_NOT_VERIFIED: "必須完成身份核實（HKID 對名）才能復原",
        NOTES_REQUIRED: "請填寫核實備註（最少 4 字）",
      };
      return res.status(out.code === "NOT_FOUND" ? 404 : 400).json({
        success: false,
        code: out.code,
        error: msgs[out.code] || "操作失敗",
      });
    }
    res.json({ success: true, ...out });
  } catch (e) {
    console.error("[RISK] recovery:", e.message);
    res.status(500).json({ success: false, error: "帳號復原操作失敗" });
  }
});

// ===== 黑名單 =====
router.get("/fraud-blacklist", (req, res) => {
  try {
    res.json({ success: true, data: emergency.listBlacklist(getDb()) });
  } catch (e) {
    console.error("[RISK] blacklist:", e.message);
    res.status(500).json({ success: false, error: "讀取黑名單失敗" });
  }
});

router.delete("/fraud-blacklist/:id", (req, res) => {
  try {
    const out = emergency.removeBlacklist(getDb(), req.params.id, req.user.id);
    if (!out.ok) return res.status(404).json({ success: false, error: "找不到紀錄" });
    res.json({ success: true });
  } catch (e) {
    console.error("[RISK] blacklist remove:", e.message);
    res.status(500).json({ success: false, error: "移除失敗" });
  }
});

module.exports = router;
