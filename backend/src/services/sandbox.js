/**
 * 工單八 — 演練沙盒重設（只限 is_sandbox 場地／seed-sandbox 班次）
 * 雙重保護：
 *  1. session 必須屬於 is_sandbox=1 場地，或 id 以 seed-sandbox- 開頭
 *  2. booking 只會 update 狀態／清除簽到，唔會 DELETE 金錢紀錄
 */
function resetSandboxSession(db, sessionId) {
  const row = db
    .prepare(
      `SELECT s.id, s.class_id, s.enrolled_count, c.partner_venue_id, c.coach_id,
              pv.is_sandbox
         FROM class_schedules s
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN partner_venues pv ON pv.id = c.partner_venue_id
        WHERE s.id = ?`,
    )
    .get(sessionId);
  if (!row) return { ok: false, code: 404, error: "找不到班次" };
  const isSandbox = Number(row.is_sandbox || 0) === 1 || String(sessionId).startsWith("seed-sandbox-");
  if (!isSandbox) return { ok: false, code: 403, error: "只可重設沙盒演練班次" };

  const tx = db.transaction(() => {
    const bookings = db.prepare("SELECT id FROM bookings WHERE schedule_id=?").all(sessionId);
    const ids = bookings.map((b) => b.id);
    db.prepare(
      `UPDATE bookings SET status='confirmed', checked_in_at=NULL, cancel_reason=NULL
        WHERE schedule_id=? AND status IN ('confirmed','attended','no_show','cancelled')`,
    ).run(sessionId);
    // 演練期間現場補錄嘅學員：保留紀錄但取消，唔會殘留喺名冊
    let walkins = 0;
    try {
      walkins = db.prepare("UPDATE bookings SET status='cancelled', cancel_reason='沙盒重設' WHERE schedule_id=? AND is_walkin=1 AND status<>'cancelled'").run(sessionId).changes;
    } catch (e) {}
    let attendances = 0;
    try {
      attendances = db.prepare("DELETE FROM attendances WHERE session_id=?").run(sessionId).changes;
    } catch (e) {}
    let handbooks = 0, replies = 0;
    try {
      if (ids.length) {
        const ph = ids.map(() => "?").join(",");
        replies = db.prepare(`DELETE FROM handbook_replies WHERE handbook_id IN (SELECT id FROM coach_handbooks WHERE booking_id IN (${ph}))`).run(...ids).changes;
        handbooks = db.prepare(`DELETE FROM coach_handbooks WHERE booking_id IN (${ph})`).run(...ids).changes;
      }
    } catch (e) {}
    try {
      db.prepare(
        "UPDATE coach_substitution_requests SET status='pending', reviewed_at=NULL, reviewed_by=NULL, review_note=NULL WHERE session_id=? AND id LIKE 'seed-sandbox-%'",
      ).run(sessionId);
    } catch (e) {}
    const active = db.prepare("SELECT COUNT(*) c FROM bookings WHERE schedule_id=? AND status IN ('confirmed','attended')").get(sessionId).c;
    db.prepare("UPDATE class_schedules SET coach_override_id=NULL, enrolled_count=? WHERE id=?").run(active, sessionId);
    // 演練學員回到初始堂數
    try {
      db.prepare("UPDATE users SET credits=3 WHERE id='seed-sandbox-stu-a'").run();
      db.prepare("UPDATE users SET credits=1 WHERE id='seed-sandbox-stu-b'").run();
    } catch (e) {}
    return { bookings: ids.length, attendances, handbooks, replies, walkins };
  });

  const result = tx();
  return { ok: true, ...result };
}

module.exports = { resetSandboxSession };
