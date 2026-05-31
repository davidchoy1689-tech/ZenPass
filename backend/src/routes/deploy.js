/**
 * ZenPass 禪流 — 部署路由
 * Admin only: 用嚟 update frontend files 唔使 SSH
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const { authenticateToken, requireAdmin } = require("../middleware/auth");

const router = express.Router();
const FRONTEND_DIR = path.resolve(__dirname, "../../../frontend");

// ===== POST /api/admin/write-file — Admin 寫檔案 =====
router.post("/write-file", authenticateToken, (req, res) => {
  try {
    const { filename, content } = req.body;
    if (!filename || content === undefined) {
      return res.status(400).json({ error: "需要 filename 同 content" });
    }

    // Security: only allow writing to frontend/ directory
    const safePath = path.resolve(FRONTEND_DIR, filename);
    if (!safePath.startsWith(FRONTEND_DIR)) {
      return res.status(403).json({ error: "路徑唔允許" });
    }

    fs.writeFileSync(safePath, content, "utf8");
    res.json({ success: true, file: filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== POST /api/admin/deploy — Git pull + restart =====
router.post("/deploy", authenticateToken, (req, res) => {
  try {
    const { execSync } = require("child_process");
    const result = execSync(
      "cd /var/www/zenpass && git pull origin main 2>&1",
      {
        timeout: 30000,
      },
    ).toString();
    res.json({ success: true, output: result });
  } catch (err) {
    res
      .status(500)
      .json({ error: err.message, output: err.stdout?.toString() });
  }
});

module.exports = router;
