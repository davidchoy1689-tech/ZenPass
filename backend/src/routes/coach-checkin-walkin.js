/**
 * 教練點名連結專用：現場補錄（免登入，用 token）
 * 獨立掛載喺 /api/coach 最前面，避開其他 /api/coach router 嘅全局 authenticateToken。
 */
const express = require("express");
const { getDb } = require("../services/database");
const checkin = require("./coach-checkin");

const router = express.Router();

router.post("/checkin/walkin", express.json(), (req, res) => {
  try {
    const token = req.body && req.body.token;
    const v = checkin.verifyLinkToken ? checkin.verifyLinkToken(token) : null;
    if (!v || !v.ok) return res.status(403).json({ success: false, code: (v && v.code) || "TOKEN_INVALID", error: "連結無效或已過期" });
    const DB = getDb();
    const sched = DB.prepare("SELECT id, start_time, end_time FROM class_schedules WHERE id=?").get(v.scheduleId);
    if (!sched) return res.status(404).json({ success: false, error: "找不到班次" });
    const start = Date.parse(String(sched.start_time).replace(" ", "T") + (String(sched.start_time).endsWith("Z") ? "" : "Z"));
    const end = Date.parse(String(sched.end_time).replace(" ", "T") + (String(sched.end_time).endsWith("Z") ? "" : "Z"));
    const now = Date.now();
    if (!Number.isNaN(start) && now < start - 2 * 3600e3) return res.status(403).json({ success: false, code: "TOO_EARLY", error: "未到點名時間" });
    if (!Number.isNaN(end) && now > end + 3 * 3600e3) return res.status(403).json({ success: false, code: "TOKEN_EXPIRED", error: "點名時段已過" });

    req.user = { id: v.coachId, role: "coach" };
    req.params = Object.assign({}, req.params, { sid: v.scheduleId });
    req.body = Object.assign({}, req.body, { session_id: v.scheduleId });
    const walkin = require("./coach-walkin");
    const handler = walkin.handleWalkIn;
    if (!handler) return res.status(500).json({ success: false, error: "現場補錄未啟用" });
    return handler(req, res);
  } catch (e) {
    console.error("[WALKIN-LINK]", e.message);
    res.status(500).json({ success: false, error: "現場補錄失敗" });
  }
});

module.exports = router;
