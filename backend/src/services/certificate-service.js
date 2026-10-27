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
      revoked_reason TEXT,
      verify_hash TEXT,
      student_ref_hash TEXT,
      coach_license_masked TEXT,
      technical_score INTEGER,
      tactical_score INTEGER,
      teamwork_score INTEGER,
      sportsmanship_score INTEGER,
      coach_comment TEXT,
      assessment_tags TEXT,
      overall_grade TEXT
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
    // 防偽存證雜湊（SHA-256）：一經簽發即封存，改任何欄位都會對唔上
    if (!cols.includes("verify_hash")) {
      db.exec("ALTER TABLE certificates ADD COLUMN verify_hash TEXT");
    }
    // 學員識別雜湊（姓名 + 家長電話後 4 位；不收集 HKID）
    if (!cols.includes("student_ref_hash")) db.exec("ALTER TABLE certificates ADD COLUMN student_ref_hash TEXT");
    // 教練牌照（脫敏顯示）
    if (!cols.includes("coach_license_masked")) db.exec("ALTER TABLE certificates ADD COLUMN coach_license_masked TEXT");
    // 🎖️ 專項技能評定（Level 3）
    const addCols = [
      ["technical_score", "INTEGER"],
      ["tactical_score", "INTEGER"],
      ["teamwork_score", "INTEGER"],
      ["sportsmanship_score", "INTEGER"],
      ["coach_comment", "TEXT"],
      ["assessment_tags", "TEXT"],
      ["overall_grade", "TEXT"],
    ];
    addCols.forEach(([c, t]) => {
      if (!cols.includes(c)) db.exec(`ALTER TABLE certificates ADD COLUMN ${c} ${t}`);
    });
  } catch (e) {}
  _schemaReady.add(db);
  try {
    sealPending(db);
  } catch (e) {}
  // 期制班「出席證書」補發（只做一次；已結業或已存在者自動略過）
  try {
    backfillAttendanceStatements(db);
  } catch (e) {}
}

/* ============ 🔐 防偽存證雜湊 ============ */

// 🔒 鹽值永久凍結（2026-10-27 決定）
// 改動鹽值會令所有已簽發證書的雜湊失效、QR 內嵌前綴全部對唔上，
// 所以刻意唔用環境變數覆寫，避免有人改 env 就靜靜破壞舊證書。
// 日後如必須更換，請遞增 CERT_SALT_VERSION 並在驗證頁按版本跳過前綴比對。
const CERT_SALT = "zenpass-cert-v1-2026";
const CERT_SALT_VERSION = "1";

/** 證書存證雜湊：cert_no | 學員姓名 | 教練 | 簽發時間 */
function certHash(c) {
  const payload = [
    String(c.code || ""),
    String(c.student_name || ""),
    String(c.coach_id || ""),
    String(c.issued_at || ""),
  ].join("|");
  return crypto.createHash("sha256").update(payload + "|" + CERT_SALT).digest("hex");
}

/** 牌照脫敏：HK-*** ＋ 尾 4 位（例：HK-***8821） */
function maskLicense(no) {
  const raw = String(no || "").replace(/[^A-Za-z0-9]/g, "");
  if (!raw) return "";
  return "HK-***" + raw.slice(-4).toUpperCase();
}

function coachLicenseMasked(db, coachId) {
  if (!coachId) return "";
  try {
    const c = db
      .prepare(
        `SELECT license_no FROM coach_credentials
          WHERE user_id = ? AND COALESCE(license_no,'') <> ''
          ORDER BY COALESCE(reviewed_at, created_at) DESC LIMIT 1`,
      )
      .get(coachId);
    return maskLicense(c && c.license_no);
  } catch (e) {
    return "";
  }
}

/**
 * 學員識別雜湊（防冒領，但唔收集 HKID）
 * 姓名 + 家長電話後 4 位 + 平台鹽 → SHA-256 前 32 位
 */
function studentRefHash(db, userId, studentName) {
  try {
    const ucols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
    const u = ucols.includes("phone")
      ? db.prepare("SELECT phone FROM users WHERE id = ?").get(userId) || {}
      : {};
    const tail = String(u.phone || "").replace(/\D/g, "").slice(-4);
    const basis = tail ? `p:${tail}` : `u:${userId}`;
    return crypto
      .createHash("sha256")
      .update(`${String(studentName || "").trim()}|${basis}|${CERT_SALT}`)
      .digest("hex")
      .slice(0, 32);
  } catch (e) {
    return "";
  }
}

/** 為單張證書封存雜湊（已封存則不動，保證可重複驗證） */
function sealCertificate(db, id) {
  const row = db.prepare("SELECT * FROM certificates WHERE id = ?").get(id);
  if (!row) return null;
  // 補齊識別雜湊／脫敏牌照（唔影響雜湊內容）
  if (!row.student_ref_hash || !row.coach_license_masked) {
    try {
      db.prepare(
        "UPDATE certificates SET student_ref_hash = COALESCE(NULLIF(student_ref_hash,''), ?), coach_license_masked = COALESCE(NULLIF(coach_license_masked,''), ?) WHERE id = ?",
      ).run(
        row.student_ref_hash || studentRefHash(db, row.user_id, row.student_name),
        row.coach_license_masked || coachLicenseMasked(db, row.coach_id),
        id,
      );
    } catch (e) {}
  }
  if (row.verify_hash) return row.verify_hash;
  const h = certHash(row);
  db.prepare("UPDATE certificates SET verify_hash = ? WHERE id = ? AND COALESCE(verify_hash,'') = ''").run(h, id);
  return h;
}

/** 補封存：舊證書未有雜湊者一次過補上 */
function sealPending(db) {
  const rows = db
    .prepare("SELECT id FROM certificates WHERE COALESCE(verify_hash,'') = '' LIMIT 5000")
    .all();
  for (const r of rows) {
    try { sealCertificate(db, r.id); } catch (e) {}
  }
  return rows.length;
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

  try { sealCertificate(db, cert.id); } catch (e) {}

  // 🎓 期制課程：出席率達門檻 → 自動發結業證書（每學員每班一張）
  try {
    maybeIssueGraduation(db, row);
  } catch (e) {
    console.error("⚠️ 結業證書發證失敗:", e.message);
  }

  // 📋 期制課程未達門檻 → 出席證書（實際出席時數；達標後自動作廢）
  try {
    syncAttendanceStatement(db, row.class_id, row.user_id);
  } catch (e) {
    console.error("⚠️ 出席證書發證失敗:", e.message);
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

  const gradId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO certificates
      (id, code, booking_id, user_id, class_id, schedule_id, student_name, class_title,
       sport, level, level_label, hours, coach_id, coach_name, coach_starred, issued_at, cert_type)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), 'graduation')`,
  ).run(
    gradId, code, key, row.user_id, row.class_id, row.schedule_id,
    studentName, cleanClassTitle(cls.title || ""), sportKey, 2,
    `Level 2 · 中階進階者（全期 ${total} 堂結業）`, hours,
    cls.coach_id, coach.name || "", starred,
  );
  try { sealCertificate(db, gradId); } catch (e) {}

  try {
    db.prepare("UPDATE bookings SET term_completed = 1 WHERE user_id = ? AND class_id = ?").run(
      row.user_id, row.class_id,
    );
  } catch (e) {}

  // 已達出席率 → 出席證書由結業證取代
  try {
    revokeAttendanceStatement(db, row.class_id, row.user_id, "已達出席率門檻，改發結業證書");
  } catch (e) {}

  return db.prepare("SELECT * FROM certificates WHERE booking_id = ?").get(key);
}

/**
 * 📋 期制班「出席證書 / Certificate of Attendance」
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

  // 已結業（或已達門檻）→ 唔需要出席證書
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
              revoked = 0, revoked_reason = NULL, verify_hash = NULL
        WHERE id = ?`,
    ).run(
      studentName, cleanClassTitle(cls.title || ""), sportKey, label, hours,
      cls.coach_id, coach.name || "", starred, existing.id,
    );
    try { sealCertificate(db, existing.id); } catch (e) {}
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
  try { sealCertificate(db, id); } catch (e) {}
  return db.prepare("SELECT * FROM certificates WHERE id = ?").get(id);
}

/** 達標／取消時作廢出席證書（保留紀錄，唔刪） */
function revokeAttendanceStatement(db, classId, userId, reason) {
  const key = "attend:" + classId + ":" + userId;
  const row = db.prepare("SELECT * FROM certificates WHERE booking_id = ?").get(key);
  if (!row || Number(row.revoked) === 1) return null;
  db.prepare("UPDATE certificates SET revoked = 1, revoked_reason = ? WHERE id = ?").run(
    reason || "已改發結業證書", row.id,
  );
  return row.id;
}

/** 一次性補發：為已有出席紀錄但未達門檻的期制班學員建立出席證書 */
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
  try { sealCertificate(db, id); } catch (e) {}
  return db.prepare("SELECT * FROM certificates WHERE id = ?").get(id);
}

/* ============ 🎖️ Level 3 專項技能評定 ============ */

const ASSESS_DIMS = [
  { key: "technical_score", zh: "技術精準度", en: "TECHNICAL PRECISION" },
  { key: "tactical_score", zh: "戰術與專注力", en: "TACTICAL FOCUS" },
  { key: "teamwork_score", zh: "團隊溝通", en: "TEAMWORK & COMMUNICATION" },
  { key: "sportsmanship_score", zh: "運動員精神", en: "SPORTSMANSHIP" },
];

const ASSESS_TAGS = [
  "學習敏銳度高", "具備領導潛質", "恆毅力強", "專注力出色",
  "團隊合作佳", "技術動作標準", "比賽抗壓能力強", "樂於幫助隊友",
];

function assessmentMinHours(db) {
  try {
    const r = db.prepare("SELECT value FROM platform_settings WHERE key = 'assessment.min_hours'").get();
    const n = Number(r && r.value);
    if (Number.isFinite(n) && n > 0) return n;
  } catch (e) {}
  return 30;
}

/** 由四項評分計算總評等級 */
function gradeFromScores(scores) {
  const vals = ASSESS_DIMS.map((d) => Number(scores && scores[d.key]) || 0);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (avg >= 4.5) return { grade: "Distinction", zh: "卓越", avg };
  if (avg >= 3.5) return { grade: "Merit", zh: "優異", avg };
  return { grade: "Pass", zh: "達標", avg };
}

/** 該教練名下、可接受評定的學員（按學員 × 項目聚合出席時數） */
function assessmentCandidatesForCoach(coachId) {
  const db = getDb();
  ensureSchema(db);
  const bcols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  const childExpr = bcols.includes("child_name") ? "NULLIF(b.child_name,'')" : "NULL";
  const minHours = assessmentMinHours(db);
  const rows = db
    .prepare(
      `SELECT b.user_id AS user_id,
              COALESCE(${childExpr}, u.name) AS student_name,
              COALESCE(c.sport_slug, c.category, '') AS sport,
              SUM(COALESCE(c.duration, 60)) AS mins,
              COUNT(*) AS sessions,
              MAX(c.title) AS sample_title,
              MAX(u.phone) AS phone
         FROM bookings b
         JOIN classes c ON c.id = b.class_id
         JOIN users u ON u.id = b.user_id
        WHERE c.coach_id = ? AND b.status = 'attended'
        GROUP BY b.user_id, COALESCE(${childExpr}, u.name), COALESCE(c.sport_slug, c.category, '')
        ORDER BY mins DESC`,
    )
    .all(coachId);

  return rows.map((r) => {
    const hours = Math.round((Number(r.mins) / 60) * 10) / 10;
    const graduated = !!db
      .prepare(
        `SELECT 1 AS x FROM certificates
          WHERE user_id = ? AND sport = ? AND cert_type = 'graduation' AND COALESCE(revoked,0) = 0 LIMIT 1`,
      )
      .get(r.user_id, r.sport);
    const existing = db
      .prepare(
        `SELECT code, overall_grade, issued_at FROM certificates
          WHERE user_id = ? AND sport = ? AND cert_type = 'skill_assessment'
            AND student_name = ? AND COALESCE(revoked,0) = 0 LIMIT 1`,
      )
      .get(r.user_id, r.sport, r.student_name);
    return {
      user_id: r.user_id,
      student_name: r.student_name,
      sport: r.sport,
      hours,
      sessions: Number(r.sessions) || 0,
      sample_title: cleanClassTitle(r.sample_title || ""),
      phone: r.phone || "",
      graduated,
      min_hours: minHours,
      eligible: hours >= minHours || graduated,
      assessed: existing || null,
    };
  });
}

/**
 * 簽發 Level 3 專項技能評定證書
 * @param {{coachId:string, userId:string, studentName:string, sport:string,
 *          scores:object, comment?:string, tags?:string[], isAdmin?:boolean}} o
 */
function issueSkillAssessment(o) {
  const opts = o || {};
  const db = getDb();
  ensureSchema(db);

  const userId = String(opts.userId || "");
  const studentName = String(opts.studentName || "").trim();
  const sport = String(opts.sport || "").trim();
  if (!userId || !studentName || !sport) {
    return { ok: false, status: 400, error: "缺少學員或項目資料" };
  }
  const scores = {};
  for (const d of ASSESS_DIMS) {
    const v = Math.round(Number(opts.scores && opts.scores[d.key]));
    if (!(v >= 1 && v <= 5)) return { ok: false, status: 400, error: `「${d.zh}」需要 1–5 分` };
    scores[d.key] = v;
  }

  // 該教練必須曾為此學員於該項目簽到（防任意評核）
  const bcols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  const childExpr = bcols.includes("child_name") ? "NULLIF(b.child_name,'')" : "NULL";
  const taught = db
    .prepare(
      `SELECT SUM(COALESCE(c.duration,60)) AS mins, COUNT(*) AS n, MAX(c.title) AS title
         FROM bookings b JOIN classes c ON c.id = b.class_id JOIN users u ON u.id = b.user_id
        WHERE c.coach_id = ? AND b.user_id = ? AND b.status = 'attended'
          AND COALESCE(c.sport_slug, c.category, '') = ?
          AND COALESCE(${childExpr}, u.name) = ?`,
    )
    .get(opts.coachId, userId, sport, studentName);
  if (!taught || !Number(taught.n)) {
    return { ok: false, status: 403, error: "你未曾為此學員於此項目簽到，不能評核" };
  }

  const hours = Math.round((Number(taught.mins) / 60) * 10) / 10;
  const graduated = !!db
    .prepare(
      `SELECT 1 AS x FROM certificates
        WHERE user_id = ? AND sport = ? AND cert_type = 'graduation' AND COALESCE(revoked,0) = 0 LIMIT 1`,
    )
    .get(userId, sport);
  const minHours = assessmentMinHours(db);
  if (hours < minHours && !graduated) {
    return {
      ok: false,
      status: 400,
      error: `出席時數不足：已 ${hours} 小時，需滿 ${minHours} 小時或完成期制課程`,
      code: "HOURS_NOT_ENOUGH",
      hours,
      min_hours: minHours,
    };
  }

  if (!opts.isAdmin) {
    const el = issuerEligibility(opts.coachId, sport, taught.title || "");
    if (!el.ok) return { ok: false, status: 403, error: el.reason, code: "ISSUER_NOT_QUALIFIED" };
  }

  // 已評核過（同項目同學員）→ 直接回傳，唔重複發
  const dup = db
    .prepare(
      `SELECT * FROM certificates
        WHERE user_id = ? AND sport = ? AND cert_type = 'skill_assessment'
          AND student_name = ? AND COALESCE(revoked,0) = 0 LIMIT 1`,
    )
    .get(userId, sport, studentName);
  if (dup) return { ok: true, certificate: dup, duplicate: true };

  const g = gradeFromScores(scores);
  const coach = db.prepare("SELECT name FROM users WHERE id = ?").get(opts.coachId) || {};
  const tags = Array.isArray(opts.tags)
    ? opts.tags.map((t) => String(t).slice(0, 20)).filter(Boolean).slice(0, 6)
    : [];
  const comment = String(opts.comment || "").slice(0, 400);
  const code =
    "ZP-" + new Date().getFullYear() + "-" + sportCode(sport, "", taught.title) +
    "-L3" + crypto.randomBytes(2).toString("hex").toUpperCase();
  const id = crypto.randomUUID();
  const key = "skill:" + sport + ":" + userId + ":" + crypto.createHash("md5").update(studentName).digest("hex").slice(0, 8);

  let starred = 0;
  try {
    const cc = db
      .prepare(
        `SELECT CASE WHEN status='verified' AND COALESCE(is_starred,0)=1
                AND (license_expiry IS NULL OR license_expiry='' OR license_expiry >= date('now'))
                THEN 1 ELSE 0 END AS s
         FROM coach_credentials WHERE user_id = ? ORDER BY s DESC LIMIT 1`,
      )
      .get(opts.coachId);
    starred = cc ? Number(cc.s) || 0 : 0;
  } catch (e) {}

  db.prepare(
    `INSERT INTO certificates
      (id, code, booking_id, user_id, class_id, schedule_id, student_name, class_title,
       sport, level, level_label, hours, coach_id, coach_name, coach_starred, issued_at, cert_type,
       technical_score, tactical_score, teamwork_score, sportsmanship_score,
       coach_comment, assessment_tags, overall_grade)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), 'skill_assessment',
             ?,?,?,?,?,?,?)`,
  ).run(
    id, code, key, userId, null, null, studentName, cleanClassTitle(taught.title || ""),
    sport, 3, `Level 3 · 專項技術精熟（${g.grade} · ${g.zh}）`, hours,
    opts.coachId, coach.name || "", starred,
    scores.technical_score, scores.tactical_score, scores.teamwork_score, scores.sportsmanship_score,
    comment, JSON.stringify(tags), g.grade,
  );
  try { sealCertificate(db, id); } catch (e) {}
  try {
    db.prepare(
      `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
       VALUES (?,?,?,?,?,?,?, datetime('now'))`,
    ).run(
      crypto.randomUUID(), "certificate.skill_assessment", "certificate", id, opts.coachId,
      JSON.stringify({ student: studentName, sport, grade: g.grade, avg: Math.round(g.avg * 100) / 100, hours }),
      `簽發 Level 3 專項評定（${g.grade}）— ${studentName} / ${sport}`,
    );
  } catch (e) {}

  return { ok: true, certificate: db.prepare("SELECT * FROM certificates WHERE id = ?").get(id) };
}

module.exports = {
  ensureSchema, issueForBooking, listForUser, summaryForUser, getByCode, createDemo,
  sportCode, levelFor, issuerEligibility, parseQualified, termProgressForUser, cleanClassTitle,
  syncAttendanceStatement, revokeAttendanceStatement, backfillAttendanceStatements,
  certHash, sealCertificate, sealPending, CERT_SALT_VERSION,
  maskLicense, coachLicenseMasked, studentRefHash,
  ASSESS_DIMS, ASSESS_TAGS, assessmentMinHours, gradeFromScores,
  assessmentCandidatesForCoach, issueSkillAssessment,
};
