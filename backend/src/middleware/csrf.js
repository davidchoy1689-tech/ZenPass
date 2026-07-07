/**
 * ZenPass 禪流 - CSRF Protection (Pure CommonJS)
 *
 * Self-contained Double Submit Cookie pattern.
 * No need for ESM bridge – uses Node built-in crypto.
 */

const crypto = require('crypto');

const CSRF_COOKIE = 'zenpass-csrf-token';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_LENGTH = 48;

/**
 * Generate a cryptographically random CSRF token, set it as a cookie,
 * and return it in the response body.
 *
 * GET /api/csrf-token → { token: "abc..." }
 */
function generateToken(req, res) {
  const token = crypto.randomBytes(CSRF_LENGTH).toString('hex');
  res.cookie(CSRF_COOKIE, token, {
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });
  res.json({ success: true, token });
}

/**
 * CSRF protection middleware.
 *
 * For every mutating request (POST/PUT/PATCH/DELETE):
 *  - Read csrf token from cookie and from x-csrf-token header
 *  - If they don't match → 403
 *
 * Bypass for public endpoints (school inquiry, payment webhooks, etc.)
 */
function doubleCsrfProtection(req, res, next) {
  // NOTE: req.path is RELATIVE to the mount point (e.g. '/api'),
  // so '/api/auth/login' becomes '/auth/login' when app.use('/api', ...)
  const publicPaths = [
    '/auth/',
    '/school/inquiry',
    '/partner/apply',
    '/health',
    '/webhook/',
    '/csrf-token',
    '/upload',
    '/track/',
  ];
  if (publicPaths.some(p => req.path.startsWith(p))) {
    return next();
  }

  // Only protect mutating methods
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  const cookieToken = req.cookies && req.cookies[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      success: false,
      error: 'invalid csrf token',
    });
  }

  next();
}

/**
 * Express cookie parser – exposed so index.js only needs require('./csrf').
 */
const cookieParser = require('cookie-parser');

module.exports = {
  generateToken,
  doubleCsrfProtection,
  cookieParser,
  initCsrf: () => Promise.resolve(), // No-op in pure CommonJS version
};
