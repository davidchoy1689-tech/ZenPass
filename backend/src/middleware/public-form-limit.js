/**
 * 公開表單限流（防 spam leads / 假查詢）
 * 以 IP 計，預設每小時 10 次。
 */
const rateLimit = require("express-rate-limit");

function publicFormLimiter({ max = 10, windowMs = 60 * 60 * 1000, message = "提交太頻繁，請稍後再試" } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || req.connection?.remoteAddress || "unknown",
    message: { success: false, error: message },
  });
}

module.exports = { publicFormLimiter };
