/**
 * ZenPass 禪流 - 認證中介軟體
 */

const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET 未設定或太短！請喺 .env 設定一個強密碼');
  process.exit(1);
}
const DB_PATH = process.env.DB_PATH || './data/zenpass.db';

/**
 * 驗證 JWT Token
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: '需要登入認證' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: '認證無效或已過期' });
  }
}

/**
 * 可選認證（有 token 就解析，冇都唔阻）
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      // Token invalid, just continue without user
    }
  }
  next();
}

/**
 * 驗證用戶是否為教練
 */
function requireCoach(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '需要登入認證' });
  }

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  const user = db.prepare('SELECT is_coach, coach_verified FROM users WHERE id = ?').get(req.user.id);
  db.close();

  if (!user || !user.is_coach || !user.coach_verified) {
    return res.status(403).json({ error: '需要教練權限' });
  }

  next();
}

/**
 * 生成 JWT Token
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      is_coach: user.is_coach || 0,
      membership_type: user.membership_type || 'none'
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { authenticateToken, optionalAuth, requireCoach, generateToken };
