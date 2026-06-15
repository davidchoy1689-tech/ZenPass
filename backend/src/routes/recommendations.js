/**
 * ZenPass 禪流 - 推薦與追蹤路由
 */

var express = require("express");
var router = express.Router();
var { authenticateToken, optionalAuth } = require("../middleware/auth");
var {
  trackUserAction,
  getRecommendations,
  getPopularByCategory,
} = require("../services/recommendation");
var path = require("path");
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "..", "data", "zenpass.db");

// ===== POST /api/track — 記錄用戶行為 =====
router.post("/", optionalAuth, function (req, res) {
  try {
    var { action, data } = req.body;

    if (!action) {
      return res.status(400).json({ error: "缺少 action 參數" });
    }

    var validActions = ["view_class", "book_class", "search", "favorite"];
    if (validActions.indexOf(action) === -1) {
      return res.status(400).json({ error: "無效的 action: " + action });
    }

    var userId = req.user ? req.user.id : null;

    // If no user logged in, we can still track anonymous actions by session
    // but for now, skip tracking if no user
    if (!userId) {
      return res.json({ tracked: false, reason: "未登入" });
    }

    var result = trackUserAction(userId, action, data || {});

    res.json({ tracked: result });
  } catch (err) {
    console.error("追蹤錯誤:", err);
    res.status(500).json({ error: "追蹤失敗" });
  }
});

// ===== GET /api/recommendations — 獲取推薦課程 =====
router.get("/", optionalAuth, function (req, res) {
  try {
    var limit = parseInt(req.query.limit) || 10;
    var userId = req.user ? req.user.id : null;

    var recommendations;

    if (userId) {
      recommendations = getRecommendations(userId, limit);
    } else {
      recommendations = getPopularByCategory(limit);
    }

    res.json({ classes: recommendations });
  } catch (err) {
    console.error("推薦錯誤:", err);
    res.status(500).json({ error: "無法獲取推薦" });
  }
});

// ===== POST /api/track/pageview — 匿名頁面瀏覽統計 =====
router.post("/pageview", function (req, res) {
  try {
    var body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
    var page = body.page;
    var referrer = body.referrer || '';
    var title = body.title || '';
    if (!page) {
      return res.json({ tracked: false });
    }

    const Database = require("better-sqlite3");
    var db = new Database(DB_PATH);

    db.exec("CREATE TABLE IF NOT EXISTS pageviews (id INTEGER PRIMARY KEY AUTOINCREMENT, page TEXT NOT NULL, referrer TEXT DEFAULT '', title TEXT DEFAULT '', ip_hash TEXT DEFAULT '', user_agent TEXT DEFAULT '', viewed_at TEXT DEFAULT (datetime('now')))");

    var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';
    var ipHash = ip.split('.').slice(0,2).join('.') + '.x.x';

    db.prepare("INSERT INTO pageviews (page, referrer, title, ip_hash, user_agent, viewed_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
      .run(page, (referrer || '').substring(0,500), (title || '').substring(0,200), ipHash, (req.headers['user-agent'] || '').substring(0,200));

    db.close();
    res.json({ tracked: true });
  } catch (err) {
    console.error("[PAGEVIEW] Error:", err);
    res.json({ tracked: false });
  }
});

// ===== GET /api/track/pageviews/stats — 瀏覽統計報表 =====
router.get("/pageviews/stats", function (req, res) {
  try {
    const Database = require("better-sqlite3");
    var db = new Database(DB_PATH);
    db.pragma("foreign_keys = ON");

    var total = db.prepare("SELECT COUNT(*) as count FROM pageviews").get();
    var topPages = db.prepare("SELECT page, COUNT(*) as views, MAX(viewed_at) as last_view FROM pageviews GROUP BY page ORDER BY views DESC LIMIT 20").all();
    var daily = db.prepare("SELECT DATE(viewed_at) as date, COUNT(*) as views FROM pageviews WHERE viewed_at >= datetime('now', '-30 days') GROUP BY DATE(viewed_at) ORDER BY date ASC").all();
    var referrers = db.prepare("SELECT CASE WHEN referrer = '' OR referrer IS NULL THEN 'direct' WHEN referrer LIKE '%google%' THEN 'google' WHEN referrer LIKE '%facebook%' THEN 'facebook' WHEN referrer LIKE '%instagram%' THEN 'instagram' ELSE 'other' END as source, COUNT(*) as count FROM pageviews GROUP BY source ORDER BY count DESC").all();

    db.close();
    res.json({ total: total.count, top_pages: topPages, daily_views: daily, referrers: referrers });
  } catch (err) {
    console.error("[PAGEVIEW STATS] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
