/**
 * GET /api/qr?text=...&size=300  — 產生 QR 圖（server-side，唔靠 CDN）
 * 2026-10-26
 */
const express = require("express");
const QRCode = require("qrcode");
const router = express.Router();

router.get("/qr", async (req, res) => {
  try {
    const text = String(req.query.text || "").slice(0, 500);
    if (!text) return res.status(400).json({ success: false, error: "缺少 text" });
    const size = Math.min(800, Math.max(120, Number(req.query.size) || 300));
    const dataUrl = await QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: "M" });
    res.json({ success: true, data_url: dataUrl, text });
  } catch (err) {
    console.error("qr error:", err.message);
    res.status(500).json({ success: false, error: "生成失敗" });
  }
});

module.exports = router;
