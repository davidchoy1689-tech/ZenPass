/**
 * student-privacy.js — 教練視角嘅學員私隱遮罩
 *
 * 規則（2026-11-15 David 指示）：
 *  - 私域學員（自己嘅學生，已綁定 origin coach / 認領）→ 睇全名、全電話
 *  - 公域學員（平台帶嚟、唔屬於呢位教練）→ 只顯示姓氏 + 電話後 4 位
 *
 * 用途：教練名冊／點名／課堂學生名單。唔影響平台職員後台。
 */

const TWO_CHAR_SURNAMES = [
  "歐陽", "司徒", "司馬", "上官", "諸葛", "東方", "獨孤", "南宮", "西門",
  "夏侯", "皇甫", "尉遲", "公孫", "慕容", "令狐", "軒轅", "端木", "澹台",
];

function surnameOf(name) {
  const n = String(name || "").trim();
  if (!n) return "學員";
  const two = n.slice(0, 2);
  if (TWO_CHAR_SURNAMES.includes(two)) return two;
  return n.slice(0, 1);
}

/** 陳大文 → 陳＊＊ */
function maskName(name) {
  const n = String(name || "").trim();
  if (!n) return "學員";
  const s = surnameOf(n);
  return s + "＊＊";
}

/** 91234567 → ＊＊＊＊ 4567（只保留後 4 位） */
function maskPhone(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length < 4) return "";
  return "＊＊＊＊ " + d.slice(-4);
}

function hasTable(db, t) {
  try {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  } catch (e) {
    return false;
  }
}

/**
 * 呢個學員係咪教練自己嘅私域學生？
 *  1. student_coach_affiliations.origin_coach_id = coachId（永久綁定）
 *  2. 或者教練名冊有紀錄且已電話相認（matched_user_id）
 */
function isOwnStudent(db, coachId, userId) {
  if (!coachId || !userId) return false;
  try {
    if (hasTable(db, "student_coach_affiliations")) {
      const a = db
        .prepare("SELECT origin_coach_id FROM student_coach_affiliations WHERE student_user_id=? AND status='active'")
        .get(userId);
      if (a && a.origin_coach_id === coachId) return true;
    }
    if (hasTable(db, "student_onboarding_invites")) {
      const inv = db
        .prepare(
          "SELECT id FROM student_onboarding_invites WHERE coach_id=? AND matched_user_id=? AND archived_at IS NULL LIMIT 1",
        )
        .get(coachId, userId);
      if (inv) return true;
    }
  } catch (e) {
    console.error("[PRIVACY] isOwnStudent:", e.message);
  }
  return false;
}

/** 遮罩一個「學生」物件（教練端 API 用） */
function maskStudent(db, coachId, stu) {
  const own = isOwnStudent(db, coachId, stu.user_id || stu.id);
  if (own) return Object.assign({}, stu, { is_private: true, privacy: "own" });
  const out = Object.assign({}, stu, { is_private: false, privacy: "masked" });
  if (out.name != null) out.name = maskName(out.name);
  if (out.attendee_name != null) out.attendee_name = maskName(out.attendee_name);
  if (out.student_name != null) out.student_name = maskName(out.student_name);
  if (out.phone != null) out.phone = maskPhone(out.phone);
  if (out.email != null) out.email = "";
  if (out.emergency_name != null) out.emergency_name = maskName(out.emergency_name);
  if (out.emergency_phone != null) out.emergency_phone = maskPhone(out.emergency_phone);
  if (out.guardian_name != null) out.guardian_name = maskName(out.guardian_name);
  if (out.parent_name != null) out.parent_name = maskName(out.parent_name);
  if (out.parent_phone != null) out.parent_phone = maskPhone(out.parent_phone);
  out.masked = true;
  return out;
}

/** 批量（同一個 coach，避免重複查詢） */
function maskStudents(db, coachId, list) {
  return (list || []).map((s) => maskStudent(db, coachId, s));
}

module.exports = { surnameOf, maskName, maskPhone, isOwnStudent, maskStudent, maskStudents };
