/**
 * ZenPass 禪流 - 檔案上傳路由
 * 支援教練證書、場地照片等上傳
 */
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dateDir = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const uploadPath = path.join(__dirname, "../../uploads", dateDir);
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = uuidv4().slice(0, 8) + ext;
    cb(null, name);
  },
});

// File filter — allow images + PDFs only
const fileFilter = (req, file, cb) => {
  const allowed = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("只接受 JPG、PNG、GIF、WebP 或 PDF 格式"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ===== POST /api/upload — 上傳檔案（單個或多個） =====
router.post("/", authenticateToken, upload.array("files", 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "請選擇檔案" });
    }

    const files = req.files.map((f) => ({
      url: `/uploads/${f.path.split("uploads/").pop()}`,
      originalName: f.originalname,
      size: f.size,
      mimeType: f.mimetype,
    }));

    res.json({ files });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "上傳失敗：" + err.message });
  }
});

module.exports = router;
