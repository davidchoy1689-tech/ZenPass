/**
 * ZenPass 禪流 — 完課電子證書（Certificate of Completion）
 *
 * 設計目的：出席證書 = 平台背書的數位資產（升學 Portfolio / 課外活動時數），
 * 令學員有理由留在平台報名（防私下交易），同時係社交分享素材。
 *
 * 觸發：教練／學員簽到（bookings.status = 'attended'）→ 自動發證（每個 booking 一張，idempotent）
 * 驗證：公開頁 /verify.html?cert=<code> → GET /api/certificates/verify/:code
 * 2026-10-27
 */

const crypto = require("crypto");
const { getDb } = require("./database");

const _schemaReady = new WeakSet();

function ensureSchema(db) {
  if (_schemaReady.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS certificates (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      booking_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      class_id TEXT,
      schedule_id TEXT,
      student_name TEXT,
      class_title TEXT,
      sport TEXT,
      level INTEGER DEFAULT 1,
      level_label TEXT,
      hours REAL DEFAULT 0,
      coach_id TEXT,
      coach_name TEXT,
      coach_starred INTEGER DEFAULT 0,
      issued_at TEXT DEFAULT (datetime('now')),
      revoked INTEGER DEFAULT 0,
      revoked_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_certificates_user ON certificates(user_id);
    CREATE INDEX IF NOT EXISTS idx_certificates_code ON certificates(code);
  `);
  // 示範證書標記（2026-10-27）：唔碰真實訂單，獨立可辨識
  try {
    const cols = db.prepare("PRAGMA table_info(certificates)").all().map((c) => c.name);
    if (!cols.includes("is_demo")) {
      db.exec("ALTER TABLE certificates ADD COLUMN is_demo INTEGER DEFAULT 0");
    }
  } catch (e) {}
  _schemaReady.add(db);
}

/** 運動 slug → 證書序號用的英文代碼 */
function sportCode(slug, category, title) {
  const s = String(slug || "").toLowerCase();
  const map = {
    molkky: "MOLKKY",
    moelkkyla: "MOLKKY",
    "floor-curling": "CURLING",
    curling: "CURLING",
    cornhole: "CORNHOLE",
    "air-storm": "AIRSTORM",
    "nordic-walking": "NORDIC",
    roundnet: "ROUNDNET",
    rouliqiu: "ROULIQIU",
    "flexi-bar": "FLEXIBAR",
    stretch: "STRETCH",
  };
  if (map[s]) return map[s];
  const t = String(title || "") + String(category || "");
  if (/木柱|mölkky|molkky/i.test(t)) return "MOLKKY";
  if (/冰壺|curling/i.test(t)) return "CURLING";
  if (/布袋球|cornhole/i.test(t)) return "CORNHOLE";
  if (/穿雲箭|air.?storm/i.test(t)) return "AIRSTORM";
  if (/伸展|stretch|瑜伽|yoga/i.test(t)) return "STRETCH";
  if (/北歐|健走|nordic/i.test(t)) return "NORDIC";
  return "SPORT";
}

function levelFor(count, emerging) {
  const pre = emerging ? "新興運動" : "";
  if (count >= 12) return { level: 5, label: "Level 5 · 項目導師級" };
  if (count >= 9) return { level: 4, label: "Level 4 · 資深運動員" };
  if (count >= 6) return { level: 3, label: "Level 3 · 進階實踐者" };
  if (count >= 3) return { level: 2, label: "Level 2 · 持續練習者" };
  return { level: 1, label: "Level 1 · " + pre + "初階探索者" };
}

/**
 * 為一張已出席的 booking 發證（重複呼叫安全）
 * @returns {object|null} certificate row
 */
function issueForBooking(bookingId) {
  if (!bookingId) return null;
  const db = getDb();
  ensureSchema(db);

  const existing = db.prepare("SELECT * FROM certificates WHERE booking_id = ?").get(bookingId);
  if (existing) return existing;

  // 舊 DB 可能缺 attendee_type / child_name → 動態 fallback
  const bcols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  const BC = (col, alt) => (bcols.includes(col) ? `b.${col}` : alt);

  const row = db
    .prepare(
      `SELECT b.id AS booking_id, b.user_id, b.class_id, b.schedule_id, b.status,
              ${BC("attendee_type", "'self'")} AS attendee_type,
              ${BC("child_name", "NULL")} AS child_name,
              ${BC("group_size", "1")} AS group_size,
              u.name AS user_name,
              c.title AS class_title, c.category, c.sport_slug, c.duration, c.coach_id,
              cu.name AS coach_name,
              cs.start_time
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       JOIN classes c ON c.id = b.class_id
       LEFT JOIN users cu ON cu.id = c.coach_id
       LEFT JOIN class_schedules cs ON cs.id = b.schedule_id
       WHERE b.id = ?`,
    )
    .get(bookingId);

  if (!row) return null;
  if (row.status !== "attended") return null; // 只為真正出席者發證

  // 同一項目（sport/category）已出席次數 → 等級
  const sportKey = row.sport_slug || row.category || "";
  const attendedCount =
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM bookings b JOIN classes c ON c.id = b.class_id
         WHERE b.user_id = ? AND b.status = 'attended'
           AND COALESCE(c.sport_slug, c.category, '') = ?`,
      )
      .get(row.user_id, sportKey).n || 1;
  const lv = levelFor(attendedCount, /新興/.test(String(sportKey)));

  let starred = 0;
  try {
    const cc = db
      .prepare(
        `SELECT CASE WHEN status='verified' AND COALESCE(is_starred,0)=1
                 AND (license_expiry IS NULL OR license_expiry='' OR license_expiry >= date('now'))
                THEN 1 ELSE 0 END AS s
         FROM coach_credentials WHERE user_id = ? ORDER BY s DESC LIMIT 1`,
      )
      .get(row.coach_id);
    starred = cc ? Number(cc.s) || 0 : 0;
  } catch (e) {}

  const hours = Math.round(((Number(row.duration) || 60) / 60) * 10) / 10;
  const code =
    "ZP-" + new Date().getFullYear() + "-" + sportCode(row.sport_slug, row.category, row.class_title) +
    "-" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const cert = {
    id: crypto.randomUUID(),
    code,
    booking_id: row.booking_id,
    user_id: row.user_id,
    class_id: row.class_id,
    schedule_id: row.schedule_id,
    student_name: row.attendee_type === "child" && row.child_name ? row.child_name : row.user_name || "學員",
    class_title: row.class_title || "",
    sport: sportKey,
    level: lv.level,
    level_label: lv.label,
    hours,
    coach_id: row.coach_id,
    coach_name: row.coach_name || "",
    coach_starred: starred,
  };

  try {
    db.prepare(
      `INSERT INTO certificates
        (id, code, booking_id, user_id, class_id, schedule_id, student_name, class_title,
         sport, level, level_label, hours, coach_id, coach_name, coach_starred, issued_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
    ).run(
      cert.id, cert.code, cert.booking_id, cert.user_id, cert.class_id, cert.schedule_id,
      cert.student_name, cert.class_title, cert.sport, cert.level, cert.level_label,
      cert.hours, cert.coach_id, cert.coach_name, cert.coach_starred,
    );
  } catch (e) {
    // UNIQUE 衝突（併發簽到）→ 回傳既有紀錄
    return db.prepare("SELECT * FROM certificates WHERE booking_id = ?").get(bookingId) || null;
  }

  return db.prepare("SELECT * FROM certificates WHERE id = ?").get(cert.id);
}

function listForUser(userId) {
  const db = getDb();
  ensureSchema(db);
  return db
    .prepare(
      `SELECT * FROM certificates WHERE user_id = ? AND COALESCE(revoked,0) = 0
       ORDER BY issued_at DESC`,
    )
    .all(userId);
}

function summaryForUser(userId) {
  const db = getDb();
  ensureSchema(db);
  const s = db
    .prepare(
      `SELECT COUNT(*) AS certs, COALESCE(SUM(hours),0) AS hours,
              COUNT(DISTINCT COALESCE(sport,'')) AS sports
       FROM certificates WHERE user_id = ? AND COALESCE(revoked,0) = 0`,
    )
    .get(userId);
  return { certs: s.certs || 0, hours: Math.round((s.hours || 0) * 10) / 10, sports: s.sports || 0 };
}

function getByCode(code) {
  const db = getDb();
  ensureSchema(db);
  return db.prepare("SELECT * FROM certificates WHERE code = ?").get(String(code || "").trim());
}

/**
 * 示範證書（只限管理員預覽用）
 * booking_id = 'demo-<uuid>' 隔離，唔會出現在學員帳戶，亦唔會計入出席／結算統計。
 */
function createDemo(opts) {
  const db = getDb();
  ensureSchema(db);
  const o = opts || {};
  const code =
    "ZP-DEMO-" + sportCode(o.sportSlug, o.sport, o.classTitle) + "-" +
    crypto.randomBytes(3).toString("hex").toUpperCase();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO certificates
      (id, code, booking_id, user_id, class_id, schedule_id, student_name, class_title,
       sport, level, level_label, hours, coach_id, coach_name, coach_starred, issued_at, is_demo)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), 1)`,
  ).run(
    id, code, "demo-" + crypto.randomUUID(), "demo", null, null,
    o.studentName || "示範學員 CHAN TAI MAN",
    o.classTitle || "芬蘭木柱體驗班（週末首發）",
    o.sport || "新興運動", 1,
    o.levelLabel || "Level 1 · 新興運動初階探索者",
    Number(o.hours) || 2, null,
    o.coachName || "Sam Lee",
    o.coachStarred === false ? 0 : 1,
  );
  return db.prepare("SELECT * FROM certificates WHERE id = ?").get(id);
}

module.exports = {
  ensureSchema, issueForBooking, listForUser, summaryForUser, getByCode, createDemo, sportCode, levelFor,
};
