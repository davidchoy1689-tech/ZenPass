/**
 * ZenPass A/B Testing Framework
 * Simple variant tracking for CTA text/color/price experiments
 */
const express = require("express");
const router = express.Router();
const path = require("path");
const Database = require("better-sqlite3");
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "..", "data", "zenpass.db");

function getDb() {
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS ab_experiments (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
    variants TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), status TEXT DEFAULT 'active'
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS ab_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, experiment_id TEXT NOT NULL,
    variant TEXT NOT NULL, event_type TEXT NOT NULL,
    session_id TEXT, user_id TEXT, page TEXT, created_at TEXT DEFAULT (datetime('now'))
  )`);
  return db;
}

// GET /api/ab/experiments — 取得 active experiments + variants
router.get("/experiments", (req, res) => {
  try {
    var db = getDb();
    var exps = db.prepare("SELECT * FROM ab_experiments WHERE status = 'active'").all();
    db.close();
    res.json({ experiments: exps.map(function(e) {
      try { e.variants = JSON.parse(e.variants); } catch(x) { e.variants = []; }
      return e;
    })});
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/ab/track — 記錄 variant impression 或 conversion
router.post("/track", (req, res) => {
  try {
    var { experiment_id, variant, event_type, session_id, page } = req.body;
    if (!experiment_id || !variant || !event_type) return res.json({ tracked: false });

    var db = getDb();
    db.prepare("INSERT INTO ab_events (experiment_id, variant, event_type, session_id, page) VALUES (?, ?, ?, ?, ?)")
      .run(experiment_id, variant, event_type, session_id || '', page || '');
    db.close();
    res.json({ tracked: true });
  } catch(err) { res.json({ tracked: false }); }
});

// GET /api/ab/results/:id — 實驗結果
router.get("/results/:id", (req, res) => {
  try {
    var db = getDb();
    var exp = db.prepare("SELECT * FROM ab_experiments WHERE id = ?").get(req.params.id);
    if (!exp) { db.close(); return res.status(404).json({ error: "Experiment not found" }); }

    var rows = db.prepare("SELECT variant, event_type, COUNT(*) as count FROM ab_events WHERE experiment_id = ? GROUP BY variant, event_type").all(req.params.id);
    db.close();

    try { exp.variants = JSON.parse(exp.variants); } catch(x) { exp.variants = []; }
    res.json({ experiment: exp, results: rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
