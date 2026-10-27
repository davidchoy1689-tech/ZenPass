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
    if (!cols.includes("cert_type")) {
      db.exec("ALTER TABLE certificates ADD COLUMN cert_type TEXT DEFAULT 'session'");
    }
  } catch (e) {}
  _schemaReady.add(db);
  // 期制班「出席證明」補發（只做一次；已結業或已存在者自動略過）
  try {
    backfillAttendanceStatements(db);
  } catch (e) {}
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

/** 證書只顯示正式課程名稱：去掉「（週末首發）」等推廣字眼 */
function cleanClassTitle(title) {
  let t = String(title || "");
  t = t.replace(/[（(][^）)]*(?:首發|週末)[^）)]*[）)]/g, " ");
  t = t.replace(/(?:週末)?首發(?:班|課程)?/g, " ");
  return t.replace(/\s{2,}/g, " ").trim();
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
    class_title: cleanClassTitle(row.class_title || ""),
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
         sport, level, level_label, hours, coach_id, coach_name, coach_starred, issued_at, cert_type)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), 'session')`,
    ).run(
      cert.id, cert.code, cert.booking_id, cert.user_id, cert.class_id, cert.schedule_id,
      cert.student_name, cert.class_title, cert.sport, cert.level, cert.level_label,
      cert.hours, cert.coach_id, cert.coach_name, cert.coach_starred,
    );
  } catch (e) {
    // UNIQUE 衝突（併發簽到）→ 回傳既有紀錄
    return db.prepare("SELECT * FROM certificates WHERE booking_id = ?").get(bookingId) || null;
  }

  // 🎓 期制課程：出席率達門檻 → 自動發結業證書（每學員每班一張）
  try {
    maybeIssueGraduation(db, row);
  } catch (e) {
    console.error("⚠️ 結業證書發證失敗:", e.message);
  }

  // 📋 期制課程未達門檻 → 出席證明（實際出席時數；達標後自動作廢）
  try {
    syncAttendanceStatement(db, row.class_id, row.user_id);
  } catch (e) {
    console.error("⚠️ 出席證明發證失敗:", e.message);
  }

  return db.prepare("SELECT * FROM certificates WHERE id = ?").get(cert.id);
}

/** 期制班結業判斷：出席堂數 / 全期堂數 ≥ min_attendance_rate */
function maybeIssueGraduation(db, row) {
  const ccols = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
  const CC = (col, alt) => (ccols.includes(col) ? `c.${col}` : alt);
  const cls = db
    .prepare(
      `SELECT ${CC("course_type", "'single'")} AS course_type,
              ${CC("total_sessions", "1")} AS total_sessions,
              ${CC("min_attendance_rate", "0.8")} AS min_attendance_rate,
              c.title, c.duration, c.coach_id, c.category, c.sport_slug
       FROM classes c WHERE c.id = ?`,
    )
    .get(row.class_id);
  if (!cls || String(cls.course_type || "single") !== "term") return null;

  const total = Math.max(1, Number(cls.total_sessions) || 1);
  const rate = Math.min(1, Math.max(0.1, Number(cls.min_attendance_rate) || 0.8));
  const attended =
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM bookings b
         WHERE b.user_id = ? AND b.class_id = ? AND b.status = 'attended'`,
      )
      .get(row.user_id, row.class_id).n || 0;
  if (attended / total < rate) return null;

  const key = "term:" + row.class_id + ":" + row.user_id;
  const exists = db.prepare("SELECT * FROM certificates WHERE booking_id = ?").get(key);
  if (exists) return exists;

  // 認證時數 = 全期堂數 × 每堂時長（達出席率門檻即按全期計算）
  const hours = Math.round((((Number(cls.duration) || 60) * total) / 60) * 10) / 10;
  const sportKey = cls.sport_slug || cls.category || "";
  const code =
    "ZP-" + new Date().getFullYear() + "-" + sportCode(cls.sport_slug, cls.category, cls.title) +
    "-G" + crypto.randomBytes(2).toString("hex").toUpperCase();
  let starred = 0;
  try {
    const cc = db
      .prepare(
        `SELECT CASE WHEN status='verified' AND COALESCE(is_starred,0)=1
                AND (license_expiry IS NULL OR license_expiry='' OR license_expiry >= date('now'))
                THEN 1 ELSE 0 END AS s
         FROM coach_credentials WHERE user_id = ? ORDER BY s DESC LIMIT 1`,
      )
      .get(cls.coach_id);
    starred = cc ? Number(cc.s) || 0 : 0;
  } catch (e) {}

  const coach = db.prepare("SELECT name FROM users WHERE id = ?").get(cls.coach_id) || {};
  const studentName =
    row.attendee_type === "child" && row.child_name ? row.child_name : row.user_name || "學員";

  db.prepare(
    `INSERT INTO certificates
      (id, code, booking_id, user_id, class_id, schedule_id, student_name, class_title,
       sport, level, level_label, hours, coach_id, coach_name, coach_starred, issued_at, cert_type)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), 'graduation')`,
  ).run(
    crypto.randomUUID(), code, key, row.user_id, row.class_id, row.schedule_id,
    studentName, cleanClassTitle(cls.title || ""), sportKey, 2,
    `Level 2 · 中階進階者（全期 ${total} 堂結業）`, hours,
    cls.coach_id, coach.name || "", starred,
  );

  try {
    db.prepare("UPDATE bookings SET term_completed = 1 WHERE user_id = ? AND class_id = ?").run(
      row.user_id, row.class_id,
    );
  } catch (e) {}

  // 已達出席率 → 出席證明由結業證取代
  try {
    revokeAttendanceStatement(db, row.class_id, row.user_id, "已達出席率門檻，改發結業證書");
  } catch (e) {}

  return db.prepare("SELECT * FROM certificates WHERE booking_id = ?").get(key);
}

/**
 * 📋 期制班「出席證明 / Attendance Statement」
 *
 * 用途：未達出席率門檻（未能獲結業證）的學員，仍可取得一份載明
 *      「已出席 X/Y 堂、共 Z 小時」的正式紀錄，供升學／課外活動申報。
 * 規則：
 *  - 只限期制班（course_type = 'term'），單堂班本身已有單堂出席證
 *  - 每個（班 × 學員）一張，隨每次簽到更新堂數／時數
 *  - 達到門檻並發出結業證後自動作廢，避免家長混淆
 *  - hours = 實際出席堂數 × 每堂時長
 */
function syncAttendanceStatement(db, classId, userId) {
  if (!classId || !userId) return null;
  const ccols = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
  const CC = (col, alt) => (ccols.includes(col) ? `c.${col}` : alt);
  const cls = db
    .prepare(
      `SELECT ${CC("course_type", "'single'")} AS course_type,
              ${CC("total_sessions", "1")} AS total_sessions,
              ${CC("min_attendance_rate", "0.8")} AS min_attendance_rate,
              c.title, c.duration, c.coach_id, c.category, c.sport_slug
       FROM classes c WHERE c.id = ?`,
    )
    .get(classId);
  if (!cls || String(cls.course_type || "single") !== "term") return null;

  const total = Math.max(1, Number(cls.total_sessions) || 1);
  const rate = Math.min(1, Math.max(0.1, Number(cls.min_attendance_rate) || 0.8));
  const required = Math.ceil(total * rate);
  const attended =
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM bookings b
         WHERE b.user_id = ? AND b.class_id = ? AND b.status = 'attended'`,
      )
      .get(userId, classId).n || 0;

  const key = "attend:" + classId + ":" + userId;

  // 已結業（或已達門檻）→ 唔需要出席證明
  const gradKey = "term:" + classId + ":" + userId;
  const grad = db
    .prepare("SELECT * FROM certificates WHERE booking_id = ? AND COALESCE(revoked,0) = 0")
    .get(gradKey);
  if (grad || attended / total >= rate || attended >= required) {
    revokeAttendanceStatement(db, classId, userId, "已達出席率門檻，改發結業證書");
    return null;
  }
  if (attended <= 0) return null;

  // 學員姓名（小朋友 → 用子女姓名）
  const bcols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  const BC = (col, alt) => (bcols.includes(col) ? `b.${col}` : alt);
  const orderBy = bcols.includes("checked_in_at")
    ? "COALESCE(b.checked_in_at, b.created_at) DESC"
    : "b.rowid DESC";
  const stu = db
    .prepare(
      `SELECT ${BC("attendee_type", "'self'")} AS attendee_type,
              ${BC("child_name", "NULL")} AS child_name, u.name AS user_name
       FROM bookings b JOIN users u ON u.id = b.user_id
       WHERE b.user_id = ? AND b.class_id = ? AND b.status = 'attended'
       ORDER BY ${orderBy} LIMIT 1`,
    )
    .get(userId, classId);
  const studentName =
    stu && stu.attendee_type === "child" && stu.child_name
      ? stu.child_name
      : (stu && stu.user_name) ||
        (db.prepare("SELECT name FROM users WHERE id = ?").get(userId) || {}).name ||
        "學員";

  const hours = Math.round((((Number(cls.duration) || 60) * attended) / 60) * 10) / 10;
  const pct = Math.round((attended / total) * 100);
  const label = `已出席 ${attended}/${total} 堂（${pct}%）`;
  const sportKey = cls.sport_slug || cls.category || "";

  let starred = 0;
  try {
    const cc = db
      .prepare(
        `SELECT CASE WHEN status='verified' AND COALESCE(is_starred,0)=1
                AND (license_expiry IS NULL OR license_expiry='' OR license_expiry >= date('now'))
                THEN 1 ELSE 0 END AS s
         FROM coach_credentials WHERE user_id = ? ORDER BY s DESC LIMIT 1`,
      )
      .get(cls.coach_id);
    starred = cc ? Number(cc.s) || 0 : 0;
  } catch (e) {}
  const coach = db.prepare("SELECT name FROM users WHERE id = ?").get(cls.coach_id) || {};

  const existing = db.prepare("SELECT * FROM certificates WHERE booking_id = ?").get(key);
  if (existing) {
    // 隨出席更新內容（簽發日期同步更新為最新紀錄日）
    db.prepare(
      `UPDATE certificates
          SET student_name = ?, class_title = ?, sport = ?, level_label = ?, hours = ?,
              coach_id = ?, coach_name = ?, coach_starred = ?, issued_at = datetime('now'),
              revoked = 0, revoked_reason = NULL
        WHERE id = ?`,
    ).run(
      studentName, cleanClassTitle(cls.title || ""), sportKey, label, hours,
      cls.coach_id, coach.name || "", starred, existing.id,
    );
    return db.prepare("SELECT * FROM certificates WHERE id = ?").get(existing.id);
  }

  const code =
    "ZP-" + new Date().getFullYear() + "-" + sportCode(cls.sport_slug, cls.category, cls.title) +
    "-A" + crypto.randomBytes(2).toString("hex").toUpperCase();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO certificates
      (id, code, booking_id, user_id, class_id, schedule_id, student_name, class_title,
       sport, level, level_label, hours, coach_id, coach_name, coach_starred, issued_at, cert_type)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), 'attendance')`,
  ).run(
    id, code, key, userId, classId, null, studentName, cleanClassTitle(cls.title || ""),
    sportKey, 1, label, hours, cls.coach_id, coach.name || "", starred,
  );
  return db.prepare("SELECT * FROM certificates WHERE id = ?").get(id);
}

/** 達標／取消時作廢出席證明（保留紀錄，唔刪） */
function revokeAttendanceStatement(db, classId, userId, reason) {
  const key = "attend:" + classId + ":" + userId;
  const row = db.prepare("SELECT * FROM certificates WHERE booking_id = ?").get(key);
  if (!row || Number(row.revoked) === 1) return null;
  db.prepare("UPDATE certificates SET revoked = 1, revoked_reason = ? WHERE id = ?").run(
    reason || "已改發結業證書", row.id,
  );
  return row.id;
}

/** 一次性補發：為已有出席紀錄但未達門檻的期制班學員建立出席證明 */
function backfillAttendanceStatements(db) {
  const ccols = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
  if (!ccols.includes("course_type")) return 0;
  const pairs = db
    .prepare(
      `SELECT b.class_id, b.user_id, COUNT(*) AS n
         FROM bookings b JOIN classes c ON c.id = b.class_id
        WHERE b.status = 'attended' AND COALESCE(c.course_type,'single') = 'term'
        GROUP BY b.class_id, b.user_id`,
    )
    .all();
  let made = 0;
  for (const p of pairs) {
    try {
      const r = syncAttendanceStatement(db, p.class_id, p.user_id);
      if (r) made++;
    } catch (e) {}
  }
  return made;
}

function listForUser(userId) {
  const db = getDb();
  ensureSchema(db);
  return db
    .prepare(
      `SELECT * FROM certificates WHERE user_id = ? AND COALESCE(revoked,0) = 0
       ORDER BY issued_at DESC`,
    )
    .all(userId)
    .map((r) => ({ ...r, class_title: cleanClassTitle(r.class_title) }));
}

function summaryForUser(userId) {
  const db = getDb();
  ensureSchema(db);
  const s = db
    .prepare(
      `SELECT COUNT(*) AS certs,
              COUNT(DISTINCT COALESCE(sport,'')) AS sports
       FROM certificates WHERE user_id = ? AND COALESCE(revoked,0) = 0`,
    )
    .get(userId);

  // 累計時數：
  // ・期制班已結業 → 按全期堂數計
  // ・期制班未結業 → 按已出席堂數計
  // ・單堂班 → 按出席堂數計
  // （避免 session 證 + 結業證重複相加）
  let hours = 0;
  try {
    const rows = db
      .prepare(
        `SELECT c.id, COALESCE(c.course_type,'single') AS ct,
                COALESCE(c.total_sessions,1) AS total,
                COALESCE(c.duration,60) AS dur,
                (SELECT COUNT(*) FROM bookings b2
                  WHERE b2.user_id = ? AND b2.class_id = c.id AND b2.status = 'attended') AS attended,
                (SELECT COUNT(*) FROM certificates ce
                  WHERE ce.user_id = ? AND ce.class_id = c.id
                    AND ce.cert_type = 'graduation' AND COALESCE(ce.revoked,0) = 0) AS grad
         FROM classes c
         WHERE c.id IN (SELECT class_id FROM bookings WHERE user_id = ? AND status = 'attended')`,
      )
      .all(userId, userId, userId);
    let mins = 0;
    rows.forEach((r) => {
      const isTerm = String(r.ct) === "term";
      const sessions = isTerm && Number(r.grad) > 0 ? Number(r.total) : Number(r.attended);
      mins += sessions * Number(r.dur);
    });
    hours = Math.round((mins / 60) * 10) / 10;
  } catch (e) {
    // 舊 DB fallback：用證書手數加總（僅排除重複計算嘅結業證）
    const f = db
      .prepare(
        `SELECT COALESCE(SUM(hours),0) AS hours FROM certificates
         WHERE user_id = ? AND COALESCE(revoked,0)=0
           AND COALESCE(cert_type,'session') NOT IN ('graduation','attendance')`,
      )
      .get(userId);
    hours = Math.round((f.hours || 0) * 10) / 10;
  }

  return { certs: s.certs || 0, hours, sports: s.sports || 0 };
}

/** 進行中／已完成期制課程進度 */
function termProgressForUser(userId) {
  const db = getDb();
  ensureSchema(db);
  const ccols = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
  if (!ccols.includes("course_type")) return [];
  const rows = db
    .prepare(
      `SELECT c.id, c.title, COALESCE(c.total_sessions,1) AS total_sessions,
              COALESCE(c.min_attendance_rate,0.8) AS min_attendance_rate,
              COALESCE(c.duration,60) AS duration,
              (SELECT COUNT(*) FROM bookings b
                WHERE b.user_id = ? AND b.class_id = c.id AND b.status = 'attended') AS attended,
              (SELECT COUNT(*) FROM certificates ce
                WHERE ce.user_id = ? AND ce.class_id = c.id AND ce.cert_type = 'graduation') AS graduated
       FROM classes c
       WHERE COALESCE(c.course_type,'single') = 'term'
         AND c.id IN (SELECT class_id FROM bookings WHERE user_id = ? AND status IN ('confirmed','attended'))`,
    )
    .all(userId, userId, userId);
  return rows.map((r) => {
    const total = Math.max(1, Number(r.total_sessions) || 1);
    const attended = Number(r.attended) || 0;
    const need = Math.ceil(total * (Number(r.min_attendance_rate) || 0.8));
    return {
      class_id: r.id,
      title: r.title,
      total_sessions: total,
      attended: Math.min(attended, total),
      required: need,
      percent: Math.min(100, Math.round((attended / total) * 100)),
      completed: Number(r.graduated) > 0 || attended >= need,
      hours_total: Math.round((((Number(r.duration) || 60) * total) / 60) * 10) / 10,
    };
  });
}

function getByCode(code) {
  const db = getDb();
  ensureSchema(db);
  const r = db.prepare("SELECT * FROM certificates WHERE code = ?").get(String(code || "").trim());
  return r ? { ...r, class_title: cleanClassTitle(r.class_title) } : r;
}

/* ============ 🪪 教練發證資格閘門 ============ */

const SPORT_MATCH = {
  MOLKKY: ["molkky", "moelkkyla", "木柱"],
  CURLING: ["curling", "冰壺"],
  CORNHOLE: ["cornhole", "布袋球"],
  AIRSTORM: ["air-storm", "airstorm", "穿雲箭"],
  NORDIC: ["nordic", "健走"],
  ROUNDNET: ["roundnet", "圓網球"],
  ROULIQIU: ["rouliqiu", "柔力球"],
  FLEXIBAR: ["flexi-bar", "flexibar", "flexi bar"],
  STRETCH: ["stretch", "伸展", "瑜伽", "yoga"],
};

function parseQualified(v) {
  if (!v) return null;
  try {
    const arr = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(arr) ? arr.map((x) => String(x).toLowerCase().trim()).filter(Boolean) : null;
  } catch (e) {
    // 支援逗號分隔：molkky,floor-curling
    return String(v).split(",").map((x) => x.toLowerCase().trim()).filter(Boolean);
  }
}

/**
 * 教練是否有資格為此項目發證
 * @returns {{ok:boolean, reason?:string, qualified?:string[]|null}}
 */
function issuerEligibility(coachId, sportKey, className) {
  const db = getDb();
  ensureSchema(db);
  let cred = null;
  try {
    cred = db
      .prepare("SELECT * FROM coach_credentials WHERE user_id = ? ORDER BY COALESCE(reviewed_at, created_at) DESC LIMIT 1")
      .get(coachId);
  } catch (e) {
    return { ok: false, reason: "無法讀取教練資質紀錄" };
  }
  if (!cred) return { ok: false, reason: "教練未提交資質證明（牌照／保險），暫不可發證" };
  if (String(cred.status) !== "verified") return { ok: false, reason: "教練資質仍在審核中，暫不可發證" };

  const today = new Date().toISOString().slice(0, 10);
  if (cred.insurance_expiry_date && String(cred.insurance_expiry_date).slice(0, 10) < today) {
    return { ok: false, reason: "責任保險已過期，請更新保單後再發證" };
  }
  if (cred.license_expiry && String(cred.license_expiry).slice(0, 10) < today) {
    return { ok: false, reason: "教練牌照已過期，請更新後再發證" };
  }

  const qualified = parseQualified(cred.qualified_sports);
  if (!qualified || !qualified.length) {
    // 舊資料未設定可發證項目 → 容許（祖父條款），由管理員後續補設定
    return { ok: true, qualified: null, grandfathered: true };
  }

  const code = sportCode(sportKey, "", className);
  const needles = [String(sportKey || "").toLowerCase(), className ? String(className).toLowerCase() : ""]
    .concat(SPORT_MATCH[code] || [])
    .filter(Boolean);
  const hit = qualified.some((q) => needles.some((n) => n && (n.includes(q) || q.includes(n))));
  if (!hit) return { ok: false, reason: "教練未獲此項目官方發證授權", qualified };
  return { ok: true, qualified };
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
  ensureSchema, issueForBooking, listForUser, summaryForUser, getByCode, createDemo,
  sportCode, levelFor, issuerEligibility, parseQualified, termProgressForUser, cleanClassTitle,
  syncAttendanceStatement, revokeAttendanceStatement, backfillAttendanceStatements,
};
