/**
 * ZenPass — Booking / Session 生命週期狀態機（2026-11-17）
 *
 * 背景：報名流程本身已具備原子佔位、冪等、鎖位；缺的是「課堂結束後自動收尾」，
 * 以及一套明確、可測試的狀態轉換規則（唔係散落喺各個 route 隨手 UPDATE）。
 *
 * 狀態設計（刻意唔改動既有 CHECK constraint／金錢查詢）：
 *
 *   預約 bookings.status（DB CHECK 只准：pending_payment / confirmed / attended / cancelled / no_show）
 *     pending_payment → confirmed | cancelled
 *     confirmed       → attended | no_show | cancelled
 *     attended        → （終態；簽到即等於「已完成出席」）
 *     no_show         → （終態）
 *     cancelled       → （終態；還原須經 hold-control，寫審計）
 *   額外時間戳：bookings.completed_at（課堂結束後封存時間）
 *
 *   班次 class_schedules.session_state（scheduled / in_progress / completed / cancelled）
 *     scheduled   → in_progress | completed | cancelled
 *     in_progress → completed | cancelled
 *     completed / cancelled → 終態
 *   額外時間戳：class_schedules.completed_at
 *
 * 自動收尾 finalizePastSessions()：
 *   1) 已過 end_time + grace（預設 30 分鐘）而未 completed／cancelled 的班次 → session_state='completed'
 *   2) 該班次 attended 預約 → completed_at（保留 status='attended'，唔影響收入查詢）
 *   3) 該班次已過期 pending_payment 且未有人聲稱已付款 → cancelled + 釋放名額
 *      （confirmed 唔動：no-show 判定／罰款維持由 /api/penalty/process-no-shows 負責，避免雙重罰款）
 *
 * 鐵律：本模組唔會新增／刪除任何金錢紀錄，只改狀態與時間戳，全部寫 audit_log。
 */
const crypto = require("crypto");

const SESSION_STATES = ["scheduled", "in_progress", "completed", "cancelled"];

const SESSION_TRANSITIONS = {
  scheduled: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const BOOKING_TRANSITIONS = {
  pending_payment: ["confirmed", "cancelled"],
  confirmed: ["attended", "no_show", "cancelled"],
  attended: [],
  no_show: [],
  cancelled: [],
};

function canTransitionSession(from, to) {
  const f = from || "scheduled";
  return (SESSION_TRANSITIONS[f] || []).includes(to);
}

function canTransitionBooking(from, to) {
  return (BOOKING_TRANSITIONS[from] || []).includes(to);
}

function ensureCols(db) {
  try {
    const add = (table, col, type) => {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      if (!cols.includes(col)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
    };
    add("class_schedules", "session_state", "TEXT DEFAULT 'scheduled'");
    add("class_schedules", "started_at", "TEXT");
    add("class_schedules", "completed_at", "TEXT");
    add("bookings", "completed_at", "TEXT");
    // 過期鎖位釋放要用到（同 hold-control 一致）
    add("bookings", "hold_until", "TEXT");
    add("bookings", "payment_claimed", "INTEGER DEFAULT 0");
    add("bookings", "payment_claimed_at", "TEXT");
  } catch (e) {
    console.error("[LIFECYCLE] ensureCols:", e.message);
  }
}

function settingNumber(db, key, fallback, min, max) {
  try {
    const row = db.prepare("SELECT value FROM platform_settings WHERE key = ?").get(key);
    const n = Number(row && row.value);
    if (Number.isFinite(n) && n >= min && n <= max) return Math.floor(n);
  } catch (e) {}
  return fallback;
}

/** 收尾寬限分鐘（platform_settings.session_finalize_grace_minutes，預設 30，範圍 0–240） */
function finalizeGraceMinutes(db) {
  return settingNumber(db, "session_finalize_grace_minutes", 30, 0, 240);
}

function writeAudit(db, { type, entityId, actorId, before, after, description }) {
  try {
    db.prepare(
      `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, old_values, new_values, description, created_at)
       VALUES (?,?,?,?,?,?,?,?,datetime('now'))`,
    ).run(
      crypto.randomUUID(),
      type,
      "class_schedule",
      entityId,
      actorId || null,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after || {}),
      description || type,
    );
  } catch (e) {
    console.error("[LIFECYCLE] audit failed:", e.message);
  }
}

/** 單一班次狀態轉換（人手／教練用；違反狀態機即 409） */
function transitionSession(db, { scheduleId, to, actorId, reason }) {
  ensureCols(db);
  if (!SESSION_STATES.includes(to)) {
    const e = new Error("未知狀態：" + to);
    e.status = 400;
    e.code = "INVALID_STATE";
    throw e;
  }
  return db.transaction(() => {
    const s = db.prepare("SELECT id, session_state, status FROM class_schedules WHERE id = ?").get(scheduleId);
    if (!s) {
      const e = new Error("班次不存在");
      e.status = 404;
      e.code = "SCHEDULE_NOT_FOUND";
      throw e;
    }
    const from = s.session_state || "scheduled";
    if (from === to) return { ok: true, unchanged: true, from, to };
    if (!canTransitionSession(from, to)) {
      const e = new Error(`狀態唔可以由 ${from} 轉去 ${to}`);
      e.status = 409;
      e.code = "INVALID_TRANSITION";
      throw e;
    }
    const nowIso = new Date().toISOString();
    if (to === "completed") {
      db.prepare(
        "UPDATE class_schedules SET session_state='completed', completed_at=COALESCE(completed_at, ?) WHERE id=?",
      ).run(nowIso, scheduleId);
      db.prepare(
        "UPDATE bookings SET completed_at=COALESCE(completed_at, ?) WHERE schedule_id=? AND status='attended'",
      ).run(nowIso, scheduleId);
    } else if (to === "in_progress") {
      db.prepare(
        "UPDATE class_schedules SET session_state='in_progress', started_at=COALESCE(started_at, datetime('now')) WHERE id=?",
      ).run(scheduleId);
    } else if (to === "cancelled") {
      db.prepare("UPDATE class_schedules SET session_state='cancelled' WHERE id=?").run(scheduleId);
    } else {
      db.prepare("UPDATE class_schedules SET session_state=? WHERE id=?").run(to, scheduleId);
    }
    writeAudit(db, {
      type: "schedule.session_state",
      entityId: scheduleId,
      actorId,
      before: { session_state: from },
      after: { session_state: to, reason: reason || null },
      description: `班次狀態 ${from} → ${to}${reason ? "（" + reason + "）" : ""}`,
    });
    return { ok: true, from, to, schedule_id: scheduleId };
  })();
}

/**
 * 自動收尾：把已完結班次封存、預約封存、過期未付款位釋放。
 * 可重複執行（idempotent）；每次只回傳統計。
 */
function finalizePastSessions(db, opts = {}) {
  ensureCols(db);
  const grace = opts.graceMinutes != null ? Number(opts.graceMinutes) : finalizeGraceMinutes(db);
  const nowIso = new Date().toISOString();
  const stmt = db.prepare(
    `SELECT s.rowid AS rid, s.id, s.class_id, s.end_time, COALESCE(s.session_state,'scheduled') AS session_state, s.status
       FROM class_schedules s
      WHERE COALESCE(s.session_state,'scheduled') IN ('scheduled','in_progress')
        AND s.status <> 'cancelled'
        AND datetime(s.end_time) <= datetime(?, ?)
      ORDER BY s.end_time
      LIMIT 500`,
  );
  const rows = stmt.all(nowIso, `-${grace} minutes`);

  const stats = { scanned: rows.length, completed: 0, bookings_completed: 0, holds_released: 0, errors: 0 };
  if (!rows.length) return stats;

  // 用 rowid 定位：舊資料有 id 為 NULL 嘅歷史班次（UPDATE ... WHERE id=? 對 NULL 永遠唔會 match）
  const updSchedule = db.prepare(
    "UPDATE class_schedules SET session_state='completed', completed_at=COALESCE(completed_at, ?) WHERE rowid=?",
  );
  const updAttended = db.prepare(
    "UPDATE bookings SET completed_at=COALESCE(completed_at, ?) WHERE schedule_id=? AND status='attended'",
  );
  const selExpiredHolds = db.prepare(
    `SELECT id FROM bookings
      WHERE schedule_id=? AND status='pending_payment'
        AND COALESCE(payment_claimed,0)=0
        AND (hold_until IS NULL OR hold_until < datetime('now'))`,
  );
  const cancelHold = db.prepare(
    "UPDATE bookings SET status='cancelled', payment_status='cancelled' WHERE id=? AND status='pending_payment'",
  );
  const decrSeats = db.prepare(
    "UPDATE class_schedules SET enrolled_count = MAX(0, enrolled_count - ?) WHERE id=?",
  );

  const run = db.transaction(() => {
    for (const r of rows) {
      try {
        const changed = updSchedule.run(nowIso, r.rid);
        if (!changed || changed.changes === 0) {
          stats.errors++;
          console.warn("[LIFECYCLE] 班次未能封存（rowid 不符）：", r.rid, r.id);
          continue;
        }
        const b = r.id ? updAttended.run(r.end_time || nowIso, r.id) : { changes: 0 };
        stats.bookings_completed += b.changes || 0;
        const expired = r.id ? selExpiredHolds.all(r.id) : [];
        let released = 0;
        for (const h of expired) {
          if (cancelHold.run(h.id).changes > 0) released++;
        }
        if (released) {
          decrSeats.run(released, r.id);
          stats.holds_released += released;
        }
        stats.completed++;
      } catch (e) {
        stats.errors++;
        console.error("[LIFECYCLE] finalize schedule failed:", r.id, e.message);
      }
    }
    writeAudit(db, {
      type: "schedule.auto_finalize",
      entityId: "batch:" + new Date().toISOString().slice(0, 10),
      actorId: null,
      before: null,
      after: { grace_minutes: grace, ...stats },
      description: `自動收尾：${stats.completed} 班完結、${stats.bookings_completed} 出席封存、${stats.holds_released} 過期鎖位釋放`,
    });
  });
  run();
  return stats;
}

module.exports = {
  SESSION_STATES,
  SESSION_TRANSITIONS,
  BOOKING_TRANSITIONS,
  canTransitionSession,
  canTransitionBooking,
  transitionSession,
  finalizePastSessions,
  finalizeGraceMinutes,
  ensureCols,
};
