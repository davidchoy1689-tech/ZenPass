/**
 * 拼團（Pooling）引擎
 * 狀態機：none → pooling → succeeded | failed
 * 由 scheduler 每 15 分鐘呼叫 processPooling()。
 * 注意：Pre-auth capture 需要支付網關；本模組只負責狀態機、名額、通知，
 *       preauth_status 由支付層更新（authorized → captured / released）。
 */
const { v4: uuidv4 } = require("uuid");

function ensurePoolingCols(db) {
  const cols = db.prepare("PRAGMA table_info(class_schedules)").all().map((c) => c.name);
  [
    ["min_threshold", "INTEGER DEFAULT 4"],
    ["pooling_deadline", "TEXT"],
    ["pooling_status", "TEXT DEFAULT 'none'"],
    ["preauth_status", "TEXT DEFAULT 'none'"],
  ].forEach(([n, t]) => { if (!cols.includes(n)) db.prepare(`ALTER TABLE class_schedules ADD COLUMN ${n} ${t}`).run(); });
}

const parseUtc = (s) => {
  const str = String(s || "");
  return /[zZ]$|[+-]\d\d:?\d\d$/.test(str) ? new Date(str) : new Date(str.replace(" ", "T") + "Z");
};
const money = (n) => Math.round(Number(n || 0) * 100) / 100;

function audit(db, action, entityId, values, description) {
  db.prepare(
    `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
     VALUES (?,?,?,?,?,?,?,datetime('now'))`,
  ).run(uuidv4(), action, "class_schedule", entityId, null, JSON.stringify(values || {}), description || "");
}

function activeBookings(db, scheduleId) {
  return db
    .prepare(
      `SELECT b.id, b.booking_reference, b.user_id, b.amount, u.name, u.phone
         FROM bookings b JOIN users u ON u.id=b.user_id
        WHERE b.schedule_id=? AND b.status IN ('confirmed','pending_payment')`,
    )
    .all(scheduleId);
}

/**
 * @returns {{succeeded:Array, failed:Array, skipped:number}}
 */
async function processPooling(db, { now = new Date(), notify = async () => {}, logger = console } = {}) {
  ensurePoolingCols(db);
  const schedules = db
    .prepare("SELECT * FROM class_schedules WHERE pooling_status='pooling' ORDER BY start_time")
    .all();
  const out = { succeeded: [], failed: [], skipped: 0 };

  for (const s of schedules) {
    const people = activeBookings(db, s.id);
    const threshold = Number(s.min_threshold || 4);
    const deadline = s.pooling_deadline ? parseUtc(s.pooling_deadline) : null;

    const run = db.transaction(() => {
      if (people.length >= threshold) {
        db.prepare("UPDATE class_schedules SET pooling_status='succeeded' WHERE id=?").run(s.id);
        db.prepare("UPDATE bookings SET status='confirmed' WHERE schedule_id=? AND status='pending_payment'").run(s.id);
        audit(db, "pooling.succeeded", s.id, {
          min_threshold: threshold, enrolled: people.length, booking_ids: people.map((p) => p.id),
        }, `拼團成團：${people.length}/${threshold} 人`);
        return { type: "succeeded", schedule_id: s.id, people, threshold };
      }
      if (deadline && now > deadline) {
        db.prepare("UPDATE class_schedules SET pooling_status='failed', enrolled_count=0 WHERE id=?").run(s.id);
        db.prepare(
          "UPDATE bookings SET status='cancelled', cancel_reason='pooling_failed' WHERE schedule_id=? AND status IN ('confirmed','pending_payment')",
        ).run(s.id);
        audit(db, "pooling.failed", s.id, {
          min_threshold: threshold, enrolled: people.length, booking_ids: people.map((p) => p.id),
        }, `拼團流班：${people.length}/${threshold} 人，已過截止`);
        return { type: "failed", schedule_id: s.id, people, threshold };
      }
      return null;
    });

    const result = run();
    if (!result) { out.skipped++; continue; }
    out[result.type].push(result);
    try {
      await notify({
        type: result.type,
        schedule_id: s.id,
        title: s.title || "",
        start_time: s.start_time,
        threshold,
        people: result.people,
      });
    } catch (e) {
      logger.error(`[POOLING] notify failed for ${s.id}:`, e.message);
    }
    logger.log(`[POOLING] ${s.id} → ${result.type} (${result.people.length}/${threshold})`);
  }
  return out;
}

function startPooling(db, scheduleId, { minThreshold = 4, deadline = null } = {}) {
  ensurePoolingCols(db);
  db.prepare(
    "UPDATE class_schedules SET pooling_status='pooling', min_threshold=?, pooling_deadline=? WHERE id=?",
  ).run(Number(minThreshold), deadline, scheduleId);
  audit(db, "pooling.started", scheduleId, { min_threshold: Number(minThreshold), deadline },
    `開始拼團（門檻 ${minThreshold} 人）`);
}

module.exports = { processPooling, startPooling, ensurePoolingCols, activeBookings };
