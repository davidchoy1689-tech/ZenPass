/**
 * 極端天氣監察（2026-10-28）
 * 設計原則：系統只「報警」，唔會自動取消課堂 —— 決定權永遠在管理員手上。
 * 流程：讀天文台警告 → 與上次狀態比較 → 狀態轉變即建立 ops_alert（需要立即跟進）→ 通知所有管理員。
 */
const crypto = require("crypto");
const { getDb } = require("./database");
const { fetchWarnings } = require("./hko-warnings");
const { WEATHER_POLICY } = require("../config/weather-policy");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ops_alerts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      severity TEXT DEFAULT 'urgent',
      title TEXT,
      message TEXT,
      data TEXT,
      status TEXT DEFAULT 'open',
      decision TEXT,
      note TEXT,
      handled_by TEXT,
      handled_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ops_alerts_status ON ops_alerts(status, created_at);
  `);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT, description TEXT)`);
  } catch (e) {}
}

function getSetting(db, key) {
  try {
    const r = db.prepare("SELECT value FROM platform_settings WHERE key = ?").get(key);
    return r ? r.value : null;
  } catch (e) {
    return null;
  }
}

function setSetting(db, key, value, desc) {
  try {
    db.prepare(
      "INSERT INTO platform_settings (key, value, description) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, String(value), desc || null);
  } catch (e) {}
}

/** 近期課堂影響評估（今日及未來 24 小時） */
function impactSnapshot(db) {
  try {
    const rows = db
      .prepare(
        `SELECT cs.id, cs.start_time, c.title,
                (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id = cs.id AND b.status = 'confirmed') AS booked,
                (SELECT COUNT(*) FROM bookings b WHERE b.schedule_id = cs.id AND b.status = 'confirmed' AND b.payment_status = 'paid') AS paid_count,
                (SELECT COALESCE(SUM(b.amount),0) FROM bookings b WHERE b.schedule_id = cs.id AND b.status = 'confirmed' AND b.payment_status = 'paid') AS paid_amount
           FROM class_schedules cs JOIN classes c ON c.id = cs.class_id
          WHERE cs.status <> 'cancelled'
            AND cs.start_time >= datetime('now')
            AND cs.start_time <= datetime('now','+24 hours')
          ORDER BY cs.start_time ASC`,
      )
      .all();
    return {
      sessions: rows.length,
      booked: rows.reduce((a, r) => a + Number(r.booked || 0), 0),
      paid_amount: Math.round(rows.reduce((a, r) => a + Number(r.paid_amount || 0), 0) * 100) / 100,
      upcoming: rows.slice(0, 5),
    };
  } catch (e) {
    return { sessions: 0, booked: 0, paid_amount: 0, upcoming: [] };
  }
}

function notifyAdmins(type, data) {
  try {
    require("./notify-admins").notifyAdmins(type, data);
  } catch (e) {}
}

/**
 * 根據「上一次狀態」同「今次狀態」建立警報（唔會重複）
 * @param {object} state { ok, activity_suspended, warnings, codes }
 * @param {object|null} prev 上一次狀態
 */
function applyState(state, prev) {
  const db = getDb();
  ensureSchema(db);
  if (!state || state.ok !== true) return { created: null, reason: "no_data" };

  const wasActive = !!(prev && prev.activity_suspended);
  const isActive = !!state.activity_suspended;
  const names = (state.warnings || []).map((w) => w.name).filter(Boolean);
  const label = names.length ? names.join("、") : "八號或以上熱帶氣旋警告／黑色暴雨警告";
  const impact = impactSnapshot(db);

  let created = null;
  if (isActive && !wasActive) {
    const id = crypto.randomUUID();
    const title = `⚠️ 需要立即跟進：${label} 生效`;
    const message =
      `天文台現時發出：${label}。\n` +
      `未來 24 小時有 ${impact.sessions} 堂（${impact.booked} 人報名，已付 HK$${impact.paid_amount.toFixed(2)}）受影響。\n` +
      `按《極端天氣條款》：警告生效期間課堂取消。請人手決定是否取消受影響課堂，並通知學員。`;
    db.prepare(
      `INSERT INTO ops_alerts (id, type, severity, title, message, data, status, created_at)
       VALUES (?, 'weather_signal', 'urgent', ?, ?, ?, 'open', datetime('now'))`,
    ).run(id, title, message, JSON.stringify({ codes: state.codes || [], warnings: names, impact }));
    created = { id, title, message, type: "weather_signal" };
    notifyAdmins("ops.weather_alert", { title, message });
  } else if (!isActive && wasActive) {
    const id = crypto.randomUUID();
    const title = "🌤️ 天氣警告已除下 — 請確認今日課堂安排";
    const message =
      `天文台已取消所有熱帶氣旋／暴雨警告。\n` +
      `按《極端天氣條款》：10:00 前除下 → 12:00 後課堂照常；15:00 前除下 → 18:00 後課堂照常；15:00 後才除下 → 當日餘下課堂取消。\n` +
      `未來 24 小時有 ${impact.sessions} 堂（${impact.booked} 人報名）。請人手確認是否需要取消或照常舉行。`;
    db.prepare(
      `INSERT INTO ops_alerts (id, type, severity, title, message, data, status, created_at)
       VALUES (?, 'weather_lifted', 'info', ?, ?, ?, 'open', datetime('now'))`,
    ).run(id, title, message, JSON.stringify({ impact, cutoffs: WEATHER_POLICY.cutoffs }));
    created = { id, title, message, type: "weather_lifted" };
    notifyAdmins("ops.weather_alert", { title, message });
  }

  setSetting(db, "weather.last_state", JSON.stringify({ activity_suspended: isActive, codes: state.codes || [], at: new Date().toISOString() }), "上次天氣警告狀態（用於偵測轉變）");
  return { created, active: isActive, label };
}

/** 讀天文台 → 比較 → 建警報 */
async function poll({ force = true } = {}) {
  const db = getDb();
  ensureSchema(db);
  let prev = null;
  try {
    const raw = getSetting(db, "weather.last_state");
    prev = raw ? JSON.parse(raw) : null;
  } catch (e) {}
  const state = await fetchWarnings({ force });
  return applyState(state, prev);
}

function listAlerts(status = "open", limit = 50) {
  const db = getDb();
  ensureSchema(db);
  return db
    .prepare(
      status === "all"
        ? "SELECT * FROM ops_alerts ORDER BY created_at DESC LIMIT ?"
        : "SELECT * FROM ops_alerts WHERE status = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(...(status === "all" ? [limit] : [status, limit]));
}

function handleAlert(id, { decision, note, userId } = {}) {
  const db = getDb();
  ensureSchema(db);
  const row = db.prepare("SELECT * FROM ops_alerts WHERE id = ?").get(id);
  if (!row) return { ok: false, status: 404, error: "警報不存在" };
  if (row.status === "handled") return { ok: false, status: 409, error: "此警報已處理" };
  const d = ["cancel", "continue", "ack"].includes(decision) ? decision : "ack";
  db.prepare(
    `UPDATE ops_alerts SET status='handled', decision=?, note=?, handled_by=?, handled_at=datetime('now') WHERE id=?`,
  ).run(d, String(note || "").slice(0, 300) || null, userId || null, id);
  try {
    db.prepare(
      `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
       VALUES (?, 'ops.weather_alert_handled', 'ops_alert', ?, ?, ?, ?, datetime('now'))`,
    ).run(
      crypto.randomUUID(), id, userId || null,
      JSON.stringify({ decision: d, note: note || "", alert_type: row.type }),
      `處理天氣警報：${d}`,
    );
  } catch (e) {}
  return { ok: true, id, decision: d };
}

let _timer = null;
function start(intervalMs = 10 * 60 * 1000) {
  if (_timer) return;
  const tick = async () => {
    try {
      const r = await poll({ force: true });
      if (r && r.created) console.log("[WEATHER] alert:", r.created.title);
    } catch (e) {
      console.error("[WEATHER] poll failed:", e.message);
    }
  };
  setTimeout(tick, 20 * 1000);
  _timer = setInterval(tick, intervalMs);
  if (_timer.unref) _timer.unref();
}

module.exports = { ensureSchema, applyState, poll, listAlerts, handleAlert, start, impactSnapshot };
