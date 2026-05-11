/**
 * ZenPass 禪流 - 集中式錯誤處理
 * 所有未捕獲嘅錯誤會統一喺呢度處理
 */

const logger = require("../services/logger");
const { serverError } = require("../services/response");

class AppError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.details = details;
  }
}

function errorHandler(err, req, res, next) {
  // 已知嘅 AppError → 回傳對應 status
  if (err instanceof AppError) {
    const body = { success: false, error: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }

  // 輸入驗證錯誤
  if (err.name === "ValidationError" || err.type === "validation") {
    return res.status(400).json({
      success: false,
      error: "輸入驗證失敗",
      details: err.details || err.message,
    });
  }

  // JWT 錯誤
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return res.status(401).json({ success: false, error: "認證無效或已過期" });
  }

  // CORS 錯誤
  if (err.message && err.message.includes("CORS")) {
    return res.status(403).json({ success: false, error: "請求來源不被允許" });
  }

  // 未預期錯誤
  logger.error("未預期錯誤", {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
  });

  return res.status(500).json({
    success: false,
    error: "伺服器內部錯誤",
    ...(process.env.NODE_ENV === "development" && { detail: err.message }),
  });
}

module.exports = { AppError, errorHandler };
