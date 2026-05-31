/**
 * ZenPass 備份與還原 API
 * 支援 SQLite + Supabase
 */
const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const {
  createBackup,
  restoreBackup,
  listBackups,
  deleteBackup,
  checkIntegrity,
} = require("../services/backup");
const logger = require("../services/logger");

const router = express.Router();

// ===== GET /api/backup/health — 資料庫完整性檢查 =====
router.get("/health", async (req, res) => {
  try {
    const result = await checkIntegrity();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: "完整性檢查失敗：" + err.message });
  }
});

// ===== POST /api/backup/create — 創建備份 =====
router.post("/create", authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    const backupId = await createBackup(
      name || `手動備份 ${new Date().toLocaleString("zh-HK")}`,
      description || "",
    );
    res.json({ success: true, backupId, message: "備份已創建 ✅" });
  } catch (err) {
    logger.error("備份失敗:", err);
    res.status(500).json({ error: "備份失敗：" + err.message });
  }
});

// ===== POST /api/backup/restore/:id — 一鍵還原 =====
router.post("/restore/:id", authenticateToken, async (req, res) => {
  try {
    const result = await restoreBackup(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error("還原失敗:", err);
    res.status(500).json({ error: "還原失敗：" + err.message });
  }
});

// ===== GET /api/backup/list — 備份列表 =====
router.get("/list", authenticateToken, async (req, res) => {
  try {
    const backups = await listBackups(parseInt(req.query.limit) || 20);
    res.json({ success: true, data: { backups } });
  } catch (err) {
    res.status(500).json({ error: "無法獲取備份列表" });
  }
});

// ===== DELETE /api/backup/:id — 刪除備份 =====
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    await deleteBackup(req.params.id);
    res.json({ success: true, message: "備份已刪除" });
  } catch (err) {
    res.status(500).json({ error: "刪除失敗：" + err.message });
  }
});

// ===== GET /api/backup — 備份概況 =====
router.get("/", authenticateToken, async (req, res) => {
  try {
    const backups = await listBackups(5);
    const health = await checkIntegrity();
    res.json({
      success: true,
      data: {
        total_backups: backups.length,
        latest_backup: backups[0] || null,
        db_health: health.status,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
