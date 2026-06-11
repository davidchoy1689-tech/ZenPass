/**
 * ZenPass 禪流 - 集中式錯誤處理
 * 所有未捕獲嘅 error 都會喺呢度處理
 */

// Custom error class
class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// 404 handler
function notFound(req, res, next) {
  const error = new AppError(`Not Found: ${req.originalUrl}`, 404);
  next(error);
}

// Centralized error handler
function errorHandler(err, req, res, _next) {
  // Default error
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : "伺服器內部錯誤";
  const details = err.details || null;

  // Structured logging with request context
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: statusCode >= 500 ? "ERROR" : "WARN",
    status: statusCode,
    method: req.method,
    url: req.originalUrl || req.url,
    ip: req.ip || req.connection?.remoteAddress,
    message: err.message,
    stack: statusCode >= 500 ? err.stack : undefined,
    details: details,
    // TODO: Integrate Sentry for production error tracking
    // sentry_dsn: process.env.SENTRY_DSN,
  };

  if (statusCode >= 500) {
    console.error(JSON.stringify(logEntry));
    try {
      const logger = require("../services/logger");
      logger.error(err.message, {
        statusCode,
        url: req.originalUrl,
        method: req.method,
        stack: err.stack,
      });
      // 電郵通知管理員（production only）
      if (process.env.NODE_ENV === 'production' && process.env.SMTP_HOST !== 'localhost') {
        try {
          const { sendNotification } = require("../services/notification");
          sendNotification('admin', 'error', `🚨 ZenPass 500 Error`, 
            `<h2>Server Error</h2><pre>${err.message}\n${(err.stack || '').slice(0, 1000)}</pre>`
          );
        } catch (e) { /* no-op */ }
      }
    } catch (e) {
      /* logger not available */
    }
  } else {
    console.log(`[${logEntry.timestamp}] WARN ${statusCode}:`, err.message);
  }

  // Response
  const body = { success: false, error: message };
  if (details && process.env.NODE_ENV !== "production") {
    body.details = details;
  }

  res.status(statusCode).json(body);
}

module.exports = { AppError, notFound, errorHandler };
