/**
 * ZenPass — 雙向評分（匿名）
 *
 * 方向：
 *   student → venue（場地及設施）
 *   coach   → venue（場地及設施）
 *   venue   → coach（教練表現）
 *
 * 原則：
 *   1. 全部匿名：對外只顯示角色（「學員」「教練」「場地」），永不顯示姓名
 *   2. rater_id 只留內部（admin 追濫用）
 *   3. 每人每個 context 只可評一次（DB UNIQUE）
 *   4. ≤3 星必須填原因
 *   5. 個別留言 7 日後才顯示（避免對號入座），分數即時計入
 *   6. 貝氏平滑：避免樣本少時極端分數
 */

const { getDb } = require("./database");
const { writeBlock } = require("./blockchain-audit");

const PRIOR = 4.0;
const WEIGHT = 5;

const ROLE_LABEL = { student: "學員", coach: "教練", venue: "場地" };

function smooth(count, sum, prior = PRIOR, weight = WEIGHT) {
  const n = Number(count) || 0;
  const s = Number(sum) || 0;
  return {
    count: n,
    raw_avg: n ? Math.round((s / n) * 10) / 10 : 0,
    score: Math.round(((s + prior * weight) / (n + weight)) * 10) / 10,
  };
}

/** 提交評分（含權限驗證） */
function submitReview({ raterId, raterRole, targetType, targetId, contextType, contextId, rating, tags, reasons, comment }) {
  const db = getDb();
  const r = parseInt(rating, 10);
  if (!r || r < 1 || r > 5) throw Object.assign(new Error("評分必須為 1-5"), { status: 400 });
  if (r <= 3 && (!Array.isArray(reasons) || !reasons.length)) {
    throw Object.assign(new Error("3 星或以下必須選擇原因"), { status: 400 });
  }

  // ---- 權限驗證 ----
  if (raterRole === "student" && targetType === "venue") {
    const bk = db
      .prepare(
        `SELECT b.id, b.status, c.partner_venue_id
         FROM bookings b JOIN classes c ON b.class_id = c.id
         WHERE b.id = ? AND b.user_id = ?`,
      )
      .get(contextId, raterId);
    if (!bk) throw Object.assign(new Error("預約不存在"), { status: 404 });
    if (!["attended", "confirmed"].includes(bk.status)) {
      throw Object.assign(new Error("只限已上課的預約評分"), { status: 400 });
    }
    if (!bk.partner_venue_id || bk.partner_venue_id !== targetId) {
      throw Object.assign(new Error("此課程不屬於該場地"), { status: 400 });
    }
  } else if (raterRole === "coach" && targetType === "venue") {
    const rt = db
      .prepare("SELECT id, status, venue_id FROM venue_rentals WHERE id = ? AND coach_id = ?")
      .get(contextId, raterId);
    if (!rt) throw Object.assign(new Error("租場記錄不存在"), { status: 404 });
    if (!["confirmed", "completed"].includes(rt.status)) {
      throw Object.assign(new Error("只限已確認的租場評分"), { status: 400 });
    }
    if (rt.venue_id !== targetId) throw Object.assign(new Error("租場與場地不符"), { status: 400 });
  } else if (raterRole === "student" && targetType === "coach") {
    const bk = db
      .prepare(
        `SELECT b.id, b.status, c.coach_id
         FROM bookings b JOIN classes c ON b.class_id = c.id
         WHERE b.id = ? AND b.user_id = ?`,
      )
      .get(contextId, raterId);
    if (!bk) throw Object.assign(new Error("預約不存在"), { status: 404 });
    if (bk.status !== "attended") throw Object.assign(new Error("只限已出席課堂評分"), { status: 400 });
    if (bk.coach_id !== targetId) throw Object.assign(new Error("教練與課程不符"), { status: 400 });
  } else if (raterRole === "venue" && targetType === "coach") {
    const rt = db
      .prepare(
        `SELECT r.id, r.status, r.coach_id, v.user_id AS owner
         FROM venue_rentals r JOIN partner_venues v ON r.venue_id = v.id
         WHERE r.id = ?`,
      )
      .get(contextId);
    if (!rt) throw Object.assign(new Error("租場記錄不存在"), { status: 404 });
    if (rt.owner !== raterId) throw Object.assign(new Error("你無權限評價此租場"), { status: 403 });
    if (!["confirmed", "completed"].includes(rt.status)) {
      throw Object.assign(new Error("只限已確認的租場評分"), { status: 400 });
    }
    if (rt.coach_id !== targetId) throw Object.assign(new Error("租場與教練不符"), { status: 400 });
  } else {
    throw Object.assign(new Error("不支援的評分方向"), { status: 400 });
  }

  const dupe = db
    .prepare(
      "SELECT id FROM mutual_reviews WHERE target_type = ? AND target_id = ? AND rater_id = ? AND context_id = ?",
    )
    .get(targetType, targetId, raterId, contextId);
  if (dupe) throw Object.assign(new Error("你已經評過呢一項"), { status: 409 });

  const id = require("uuid").v4();
  db.prepare(
    `INSERT INTO mutual_reviews
      (id, target_type, target_id, rater_role, rater_id, context_type, context_id, rating, tags, reasons, comment)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, targetType, targetId, raterRole, raterId, contextType, contextId, r,
    Array.isArray(tags) ? tags.join(",") : String(tags || ""),
    Array.isArray(reasons) ? reasons.join(",") : String(reasons || ""),
    String(comment || "").slice(0, 500),
  );

  try {
    writeBlock({
      entityType: "mutual_review",
      entityId: id,
      data: { target_type: targetType, target_id: targetId, rater_role: raterRole, rating: r },
    });
  } catch (e) {
    /* 區塊鏈不可用不影響評分 */
  }

  return { id, rating: r };
}

/** 匿名彙總（對外顯示用，永不帶姓名） */
function summary(targetType, targetId) {
  const db = getDb();
  const agg = db
    .prepare("SELECT COUNT(*) c, COALESCE(SUM(rating),0) s FROM mutual_reviews WHERE target_type = ? AND target_id = ?")
    .get(targetType, targetId);
  const base = smooth(agg.c, agg.s);

  const byRole = db
    .prepare(
      `SELECT rater_role AS role, COUNT(*) c, ROUND(AVG(rating),1) avg
       FROM mutual_reviews WHERE target_type = ? AND target_id = ? GROUP BY rater_role`,
    )
    .all(targetType, targetId)
    .map((x) => ({ role: x.role, label: ROLE_LABEL[x.role] || x.role, count: x.c, avg: x.avg }));

  const dist = db
    .prepare(
      "SELECT rating, COUNT(*) c FROM mutual_reviews WHERE target_type = ? AND target_id = ? GROUP BY rating ORDER BY rating DESC",
    )
    .all(targetType, targetId);

  // 只顯示 7 日後嘅留言，全部匿名
  const comments = db
    .prepare(
      `SELECT rater_role, rating, comment, tags, created_at FROM mutual_reviews
       WHERE target_type = ? AND target_id = ? AND comment <> ''
         AND (visible_at IS NULL OR visible_at <= datetime('now'))
       ORDER BY created_at DESC LIMIT 10`,
    )
    .all(targetType, targetId)
    .map((x) => ({
      by: ROLE_LABEL[x.rater_role] || "用家",
      rating: x.rating,
      comment: x.comment,
      tags: x.tags ? String(x.tags).split(",").filter(Boolean) : [],
      date: String(x.created_at || "").slice(0, 10),
    }));

  return { ...base, by_role: byRole, distribution: dist, comments };
}

/** 場地綜合分：履約 50% + 教練評 25% + 學生評 25%（缺項自動重新分配權重） */
function venueComposite(venueId, fulfillmentScore) {
  const db = getDb();
  const coach = db
    .prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(rating),0) s FROM mutual_reviews WHERE target_type='venue' AND target_id=? AND rater_role='coach'",
    )
    .get(venueId);
  const student = db
    .prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(rating),0) s FROM mutual_reviews WHERE target_type='venue' AND target_id=? AND rater_role='student'",
    )
    .get(venueId);

  const parts = [{ w: 0.5, v: Number(fulfillmentScore) || 0 }];
  if (coach.c > 0) parts.push({ w: 0.25, v: smooth(coach.c, coach.s).score });
  if (student.c > 0) parts.push({ w: 0.25, v: smooth(student.c, student.s).score });

  const totalW = parts.reduce((a, b) => a + b.w, 0);
  const score = parts.reduce((a, b) => a + b.w * b.v, 0) / totalW;
  return {
    score: Math.round(score * 10) / 10,
    parts: {
      fulfillment: Number(fulfillmentScore) || 0,
      coach_rating: coach.c ? smooth(coach.c, coach.s).score : null,
      student_rating: student.c ? smooth(student.c, student.s).score : null,
    },
  };
}

/** 教練綜合分：學生評 80% + 場地評 20%（單一來源：mutual_reviews） */
function coachAggregate(coachId) {
  const db = getDb();
  const student = db
    .prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(rating),0) s FROM mutual_reviews WHERE target_type='coach' AND target_id=? AND rater_role='student'",
    )
    .get(coachId);
  const venue = db
    .prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(rating),0) s FROM mutual_reviews WHERE target_type='coach' AND target_id=? AND rater_role='venue'",
    )
    .get(coachId);
  return {
    student: student.c ? smooth(student.c, student.s) : { count: 0, raw_avg: 0, score: 0 },
    venue: venue.c ? smooth(venue.c, venue.s) : { count: 0, raw_avg: 0, score: 0 },
    student_count: student.c,
    venue_count: venue.c,
  };
}

function coachComposite(coachId, studentScoreOverride) {
  const agg = coachAggregate(coachId);
  const sScore = studentScoreOverride != null ? Number(studentScoreOverride) : agg.student.score || smooth(0, 0).score;
  const parts = [{ w: 0.8, v: sScore }];
  if (agg.venue_count > 0) parts.push({ w: 0.2, v: agg.venue.score });
  const totalW = parts.reduce((a, b) => a + b.w, 0);
  return {
    score: Math.round((parts.reduce((a, b) => a + b.w * b.v, 0) / totalW) * 10) / 10,
    student_rating: agg.student.count ? agg.student.score : null,
    student_count: agg.student_count,
    venue_rating: agg.venue_count ? agg.venue.score : null,
    venue_count: agg.venue_count,
    raw_student_avg: agg.student.raw_avg,
  };
}

module.exports = { submitReview, summary, venueComposite, coachComposite, coachAggregate, smooth, ROLE_LABEL };
