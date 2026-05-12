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
  const message = err.isOperational ? err.message : '伺服器內部錯誤';
  const details = err.details || null;

  // Log error
  if (statusCode >= 500) {
    console.error(`[${new Date().toISOString()}] ERROR ${statusCode}:`, err.stack || err.message);
  } else {
    console.log(`[${new Date().toISOString()}] WARN ${statusCode}:`, err.message);
  }

  // Response
  const body = { success: false, error: message };
  if (details && process.env.NODE_ENV !== 'production') {
    body.details = details;
  }

  res.status(statusCode).json(body);
}

module.exports = { AppError, notFound, errorHandler };
