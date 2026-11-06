/**
 * 管理員紙本名冊（12/12 現場備用）
 * 只讀；輸出逐位學員：姓名、電話、舊患、緊急聯絡、簽到狀態
 * 用於停電／斷網／導師手機故障時嘅實體 backup
 */
function hasCol(db, table, name) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name);
  } catch (e) {
    return false;
  }
}

function buildRoster(db, scheduleId) {
  const sid = String(scheduleId || "");
  if (!sid) return null;
  const sched = db
    .prepare(
      `SELECT cs.id, cs.start_time, cs.end_time, cs.enrolled_count, cs.max_participants, cs.status,
              c.title, c.venue_name, c.venue_address, u.name AS coach_name
         FROM class_schedules cs
         JOIN classes c ON c.id = cs.class_id
         LEFT JOIN users u ON u.id = c.coach_id
        WHERE cs.id = ?`,
    )
    .get(sid);
  if (!sched) return null;

  const cols = (t, list, alias = "b") => list.map((n) => (hasCol(db, t, n) ? `${alias}.${n}` : "NULL"));
  const ucols = cols("users", ["emergency_name", "emergency_phone"], "u");
  const [childName, parentName, parentPhone, medical, checkedIn, attendee] = cols("bookings", [
    "child_name", "parent_name", "parent_phone", "medical_notes", "checked_in_at", "attendee_type",
  ]);

  const rows = db
    .prepare(
      `SELECT b.id, b.booking_reference, b.status, b.payment_status,
              COALESCE(NULLIF(${parentName},''), NULLIF(${childName},''), u.name) AS student_name,
              COALESCE(NULLIF(${parentPhone},''), u.phone) AS phone,
              ${medical} AS health_notes,
              ${attendee} AS attendee_type,
              ${checkedIn} AS checked_in_at,
              u.name AS account_name,
              ${ucols[0]} AS emergency_name,
              COALESCE(${ucols[1]}, ${hasCol(db, "bookings", "emergency_phone") ? "b.emergency_phone" : "NULL"}) AS emergency_phone
         FROM bookings b
         JOIN users u ON u.id = b.user_id
        WHERE b.schedule_id = ? AND b.status IN ('confirmed','attended','no_show')
        ORDER BY u.name ASC, b.created_at ASC`,
    )
    .all(sid);

  const students = rows.map((r) => ({
    booking_id: r.id,
    booking_reference: r.booking_reference || "",
    name: r.student_name || r.account_name || "學員",
    phone: r.phone || "",
    health_notes: String(r.health_notes || "").trim().slice(0, 80),
    emergency_name: r.emergency_name || "",
    emergency_phone: r.emergency_phone || "",
    status: r.status,
    payment_status: r.payment_status,
    checked_in: !!r.checked_in_at,
    is_child: String(r.attendee_type || "") === "parent",
    account_name: r.account_name || "",
  }));

  return {
    schedule: {
      id: sched.id,
      title: sched.title,
      start_time: sched.start_time,
      end_time: sched.end_time,
      venue_name: sched.venue_name,
      venue_address: sched.venue_address,
      coach_name: sched.coach_name || "",
      enrolled_count: sched.enrolled_count,
      max_participants: sched.max_participants,
      status: sched.status,
    },
    students,
    total_seats: students.length,
    checked_in_count: students.filter((s) => s.checked_in).length,
  };
}

module.exports = { buildRoster };
