/**
 * coach-students.js — 教練私域學生管理 + 自家記帳
 *
 * 概念
 *  - 教練可以自行新增／編輯「線下學生」（未必有平台帳號），並用電話號碼做相認鍵。
 *  - 學生一旦用同一電話登記平台，教練名冊即刻顯示「已上平台」，並自動綁定
 *    原教練（student_coach_affiliations）→ 之後佢報任何班，教練都有分佣。
 *  - 記帳本只記教練自己收嘅錢（學費／退款／調整）；平台交易唔會重複入帳。
 *
 * 資料表
 *  - student_onboarding_invites（沿用，工單十二）＋ 新增 matched_user_id / registered_at / archived_at
 *  - coach_student_ledger（新）
 *
 * 金錢紀律：ledger 只可以 void（status='void'），永不 DELETE；所有操作寫 audit_log。
 */
const crypto = require("crypto");

const TYPES = new Set(["income", "refund", "adjust"]);

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_onboarding_invites (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL, student_name TEXT NOT NULL, phone TEXT NOT NULL,
      notes TEXT, initial_pass_quota INTEGER DEFAULT 1, token TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'pending', claimed_by_user_id TEXT, created_at TEXT DEFAULT (datetime('now')),
      claimed_at TEXT
    );
  `);
  const cols = db.prepare("PRAGMA table_info(student_onboarding_invites)").all().map((c) => c.name);
  const add = [
    ["matched_user_id", "TEXT"],
    ["registered_at", "TEXT"],
    ["archived_at", "TEXT"],
    ["tags", "TEXT"],
  ];
  for (const [n, t] of add) {
    if (!cols.includes(n)) db.prepare(`ALTER TABLE student_onboarding_invites ADD COLUMN ${n} ${t}`).run();
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_invites_coach_phone ON student_onboarding_invites(coach_id, phone)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_invites_matched ON student_onboarding_invites(matched_user_id)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_student_ledger (
      id TEXT PRIMARY KEY,
      coach_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      student_user_id TEXT,
      entry_date TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'income' CHECK(type IN ('income','refund','adjust')),
      amount_cents INTEGER NOT NULL,
      sessions REAL DEFAULT 0,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      voided_at DATETIME,
      voided_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_student ON coach_student_ledger(student_id, entry_date);
    CREATE INDEX IF NOT EXISTS idx_ledger_coach ON coach_student_ledger(coach_id, entry_date);
  `);
}

function normPhone(v) {
  const d = String(v || "").replace(/\D/g, "");
  return d.replace(/^852/, "").replace(/^0/, "").slice(-8);
}

const money = (c) => Math.round(Number(c || 0)) / 100;
const cents = (v) => Math.round(Number(v || 0) * 100);

function auditSafe(payload) {
  try {
    const { audit } = require("./audit");
    audit(payload);
  } catch (e) {
    console.error("[COACH-STUDENTS] audit:", e.message);
  }
}

/**
 * 逐個 invite 用電話對平台用戶做相認（idempotent）。
 * 相認成功 → 寫 matched_user_id / registered_at，並綁定原教練（第一位教練永久保留）。
 */
function matchAndBind(db, coachId) {
  ensureSchema(db);
  let bindCoach;
  try { bindCoach = require("./coach-affiliate").bindStudent; } catch (e) { bindCoach = null; }

  const pending = db
    .prepare(
      `SELECT id, phone FROM student_onboarding_invites
        WHERE coach_id=? AND matched_user_id IS NULL AND archived_at IS NULL AND status <> 'claimed'`,
    )
    .all(coachId);

  let matched = 0;
  const users = db.prepare("SELECT id, name, phone, lead_source, created_at FROM users WHERE phone IS NOT NULL").all();
  const byPhone = new Map();
  for (const u of users) {
    const p = normPhone(u.phone);
    if (p.length !== 8) continue;
    const prev = byPhone.get(p);
    // 優先非訪客帳號；同類取最早建立
    if (!prev) byPhone.set(p, u);
    else if (prev.lead_source === "guest_checkout" && u.lead_source !== "guest_checkout") byPhone.set(p, u);
  }
  for (const inv of pending) {
    const phone = normPhone(inv.phone);
    if (phone.length !== 8) continue;
    const user = byPhone.get(phone);
    if (!user) continue;
    const r = db
      .prepare(
        "UPDATE student_onboarding_invites SET matched_user_id=?, registered_at=datetime('now') WHERE id=? AND matched_user_id IS NULL",
      )
      .run(user.id, inv.id);
    if (!r.changes) continue;
    matched++;
    if (bindCoach) {
      try { bindCoach(db, user.id, coachId); } catch (e) { console.error("[COACH-STUDENTS] bind:", e.message); }
    }
    auditSafe({
      actionType: "coach.student_matched",
      entityType: "user",
      entityId: user.id,
      userId: coachId,
      newValues: { invite_id: inv.id, phone, matched_by: "phone" },
      description: "電話相認：線下學生已登記平台",
    });
  }
  return { matched };
}

/** 註冊時即時相認（由 auth.register 呼叫；失敗不影響註冊） */
function matchOnRegister(db, user) {
  try {
    ensureSchema(db);
    const phone = normPhone(user && user.phone);
    if (phone.length !== 8 || !user.id) return { matched: 0 };
    let bindCoach;
    try { bindCoach = require("./coach-affiliate").bindStudent; } catch (e) { bindCoach = null; }
    let n = 0;
    const candidates = db
      .prepare("SELECT id, coach_id, phone FROM student_onboarding_invites WHERE matched_user_id IS NULL")
      .all()
      .filter((r) => normPhone(r.phone) === phone);
    for (const row of candidates) {
      const up = db
        .prepare("UPDATE student_onboarding_invites SET matched_user_id=?, registered_at=datetime('now') WHERE id=? AND matched_user_id IS NULL")
        .run(user.id, row.id);
      if (!up.changes) continue;
      n++;
      if (bindCoach) {
        try { bindCoach(db, user.id, row.coach_id); } catch (e) {}
      }
      auditSafe({
        actionType: "coach.student_matched",
        entityType: "user",
        entityId: user.id,
        userId: row.coach_id,
        newValues: { invite_id: row.id, phone, matched_by: "phone" },
        description: "電話相認（註冊時）：線下學生已登記平台",
      });
    }
    return { matched: n };
  } catch (e) {
    console.error("[COACH-STUDENTS] matchOnRegister:", e.message);
    return { matched: 0, error: e.message };
  }
}

function ledgerSummary(db, studentId) {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type='income' THEN amount_cents ELSE 0 END),0) AS income,
         COALESCE(SUM(CASE WHEN type='refund' THEN amount_cents ELSE 0 END),0) AS refund,
         COALESCE(SUM(amount_cents),0) AS gross,
         COALESCE(SUM(sessions),0) AS sessions,
         COUNT(*) AS entries
       FROM coach_student_ledger WHERE student_id=? AND status='active'`,
    )
    .get(studentId) || {};
  const signed = db
    .prepare(
      `SELECT COALESCE(SUM(CASE type WHEN 'income' THEN amount_cents WHEN 'refund' THEN -amount_cents ELSE amount_cents END),0) AS net
         FROM coach_student_ledger WHERE student_id=? AND status='active'`,
    )
    .get(studentId);
  return {
    income: money(row.income),
    refund: money(row.refund),
    net: money(signed ? signed.net : 0),
    sessions: Number(row.sessions || 0),
    entries: Number(row.entries || 0),
  };
}

function platformStats(db, userId) {
  if (!userId) return { bookings: 0, attended: 0, spent: 0, last_visit: null };
  const r =
    db
      .prepare(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(CASE WHEN status='attended' OR attendance_status='present' THEN 1 ELSE 0 END),0) AS attended,
                COALESCE(SUM(CASE WHEN payment_status IN ('paid','refunded') THEN amount ELSE 0 END),0) AS spent
           FROM bookings WHERE user_id=? AND status <> 'cancelled'`,
      )
      .get(userId) || {};
  const last =
    db
      .prepare(
        `SELECT MAX(cs.start_time) AS t FROM bookings b JOIN class_schedules cs ON cs.id=b.schedule_id
          WHERE b.user_id=? AND (b.status='attended' OR b.attendance_status='present')`,
      )
      .get(userId) || {};
  return {
    bookings: Number(r.n || 0),
    attended: Number(r.attended || 0),
    spent: Math.round(Number(r.spent || 0) * 100) / 100,
    last_visit: last.t || null,
  };
}

function displayStatus(inv, now = Date.now()) {
  if (inv.archived_at) return "archived";
  if (String(inv.status) === "claimed") return "claimed";
  if (inv.matched_user_id) return "registered";
  const created = new Date(String(inv.created_at || "").replace(" ", "T") + "Z").getTime();
  if (Number.isFinite(created) && now - created > 30 * 864e5) return "expired";
  return "private";
}

function listStudents(db, coachId, { q } = {}) {
  ensureSchema(db);
  const rows = db
    .prepare(
      `SELECT * FROM student_onboarding_invites
        WHERE coach_id=? AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1000`,
    )
    .all(coachId);
  let users = {};
  const ids = rows.map((r) => r.matched_user_id).filter(Boolean);
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    for (const u of db.prepare(`SELECT id, name, phone, email, created_at FROM users WHERE id IN (${ph})`).all(...ids)) {
      users[u.id] = u;
    }
  }
  const keyword = String(q || "").trim().toLowerCase();
  const list = rows.map((inv) => {
    const st = displayStatus(inv);
    const ledger = ledgerSummary(db, inv.id);
    const plat = platformStats(db, inv.matched_user_id);
    return {
      id: inv.id,
      name: inv.student_name,
      phone: inv.phone,
      notes: inv.notes || "",
      tags: inv.tags || "",
      status: st,
      quota: Number(inv.initial_pass_quota || 1),
      token: st === "private" || st === "expired" ? inv.token : null,
      created_at: inv.created_at,
      registered_at: inv.registered_at,
      matched_user_id: inv.matched_user_id,
      matched_name: inv.matched_user_id && users[inv.matched_user_id] ? users[inv.matched_user_id].name : null,
      ledger,
      platform: plat,
    };
  });
  const filtered = keyword
    ? list.filter((s) => (s.name + " " + s.phone + " " + s.notes).toLowerCase().includes(keyword))
    : list;
  const stats = {
    total: list.length,
    private_only: list.filter((s) => s.status === "private" || s.status === "expired").length,
    on_platform: list.filter((s) => s.status === "registered" || s.status === "claimed").length,
    ledger_income: Math.round(list.reduce((a, s) => a + s.ledger.income, 0) * 100) / 100,
    ledger_net: Math.round(list.reduce((a, s) => a + s.ledger.net, 0) * 100) / 100,
    platform_spent: Math.round(list.reduce((a, s) => a + s.platform.spent, 0) * 100) / 100,
  };
  return { students: filtered, stats };
}

function addLedgerEntry(db, coachId, studentId, { entry_date, type, amount, sessions, note }) {
  ensureSchema(db);
  const inv = db
    .prepare("SELECT * FROM student_onboarding_invites WHERE id=? AND coach_id=? AND archived_at IS NULL")
    .get(studentId, coachId);
  if (!inv) return { error: "STUDENT_NOT_FOUND" };
  const t = String(type || "income");
  if (!TYPES.has(t)) return { error: "TYPE_INVALID" };
  const centsVal = Math.abs(cents(amount));
  if (!Number.isFinite(centsVal) || centsVal <= 0) return { error: "AMOUNT_INVALID" };
  if (centsVal > 100000000) return { error: "AMOUNT_TOO_LARGE" };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(entry_date || ""))
    ? String(entry_date)
    : new Date().toISOString().slice(0, 10);
  const id = "csl_" + crypto.randomBytes(9).toString("hex");
  db.prepare(
    `INSERT INTO coach_student_ledger (id, coach_id, student_id, student_user_id, entry_date, type, amount_cents, sessions, note)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(id, coachId, studentId, inv.matched_user_id || null, date, t, centsVal, Number(sessions) || 0, String(note || "").slice(0, 200));
  auditSafe({
    actionType: "coach.ledger_added",
    entityType: "coach_student_ledger",
    entityId: id,
    userId: coachId,
    newValues: { student_id: studentId, type: t, amount_cents: centsVal, entry_date: date },
    description: `教練記帳：${inv.student_name} ${t} HK$${money(centsVal)}`,
  });
  return { entry: { id, entry_date: date, type: t, amount: money(centsVal), sessions: Number(sessions) || 0, note: String(note || "") } };
}

function listLedger(db, coachId, studentId, limit = 300) {
  ensureSchema(db);
  const rows = db
    .prepare(
      `SELECT id, entry_date, type, amount_cents, sessions, note, status, created_at, voided_at, voided_reason
         FROM coach_student_ledger WHERE coach_id=? AND student_id=?
        ORDER BY entry_date DESC, created_at DESC LIMIT ?`,
    )
    .all(coachId, studentId, Math.max(1, Math.min(500, Number(limit) || 300)));
  return rows.map((r) => ({
    id: r.id,
    entry_date: r.entry_date,
    type: r.type,
    amount: money(r.amount_cents),
    sessions: Number(r.sessions || 0),
    note: r.note || "",
    status: r.status,
    created_at: r.created_at,
    voided_at: r.voided_at,
    voided_reason: r.voided_reason,
  }));
}

function voidLedgerEntry(db, coachId, entryId, reason) {
  ensureSchema(db);
  const row = db.prepare("SELECT * FROM coach_student_ledger WHERE id=? AND coach_id=?").get(entryId, coachId);
  if (!row) return { error: "ENTRY_NOT_FOUND" };
  if (row.status === "void") return { error: "ALREADY_VOID" };
  db.prepare("UPDATE coach_student_ledger SET status='void', voided_at=datetime('now'), voided_reason=? WHERE id=? AND status='active'").run(
    String(reason || "").slice(0, 200),
    entryId,
  );
  auditSafe({
    actionType: "coach.ledger_voided",
    entityType: "coach_student_ledger",
    entityId: entryId,
    userId: coachId,
    newValues: { reason: String(reason || "").slice(0, 200) },
    description: "教練記帳作廢（保留原紀錄）",
  });
  return { ok: true };
}

module.exports = {
  ensureSchema,
  normPhone,
  matchAndBind,
  matchOnRegister,
  listStudents,
  addLedgerEntry,
  listLedger,
  voidLedgerEntry,
  ledgerSummary,
  displayStatus,
};
