/**
 * ZenPass 禪流 — 派 Job（管理員派工作畀所有教練）
 *
 *  Admin:
 *   GET  /api/admin/jobs                 ─ 列出所有 Job（含接單統計）
 *   POST /api/admin/jobs                 ─ 建立 Job + 通知所有教練
 *   GET  /api/admin/jobs/:id             ─ Job 詳情 + 回覆名單
 *   POST /api/admin/jobs/:id/status      ─ 開/關/取消
 *   POST /api/admin/jobs/:id/dispatch    ─ 重新派發（再通知所有教練）
 *
 *  Coach:
 *   GET  /api/coach/jobs                 ─ 我睇到嘅開放 Job + 我的回覆
 *   POST /api/coach/jobs/:id/respond     ─ 接單 / 唔接
 */

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { dbNotification } = require("../services/notification");

const router = express.Router();

function isCoach(db, userId) {
  const u = db
    .prepare("SELECT is_coach, coach_verified, role FROM users WHERE id = ?")
    .get(userId);
  return (
    u &&
    (u.is_coach ||
      u.coach_verified ||
      u.role === "coach" ||
      u.role === "admin" ||
      u.role === "super_admin")
  );
}

function pickFields(body) {
  return {
    title: String(body.title || "").trim(),
    description: body.description ? String(body.description).trim() : null,
    job_date: body.job_date ? String(body.job_date).trim() : null,
    venue: body.venue ? String(body.venue).trim() : null,
    pay_hkd:
      body.pay_hkd != null && body.pay_hkd !== ""
        ? Number(body.pay_hkd)
        : null,
    slots:
      body.slots != null && body.slots !== ""
        ? Math.max(1, parseInt(body.slots, 10) || 1)
        : 1,
    link: body.link ? String(body.link).trim() : null,
  };
}

function jobMessage(job) {
  const lines = ["🧰 新工作機會：" + job.title];
  if (job.job_date) lines.push("🗓 日期：" + job.job_date);
  if (job.venue) lines.push("📍 地點：" + job.venue);
  if (job.pay_hkd != null) lines.push("💰 報酬：HK$" + job.pay_hkd);
  if (job.slots && job.slots > 1) lines.push("👥 需要：" + job.slots + " 位教練");
  if (job.description) lines.push("\n" + job.description);
  return lines.join("\n");
}

function notifyAllCoaches(db, job) {
  const coaches = db
    .prepare(
      "SELECT id FROM users WHERE is_coach = 1 OR coach_verified = 1 OR role = 'coach'",
    )
    .all();
  let sent = 0;
  for (const c of coaches) {
    try {
      const ok = dbNotification(
        c.id,
        "coach.job",
        "🧰 新工作機會：" + job.title,
        jobMessage(job),
        { job_id: job.id },
      );
      if (ok) sent++;
    } catch (e) {
      /* ignore single failure */
    }
  }
  return { sent, total: coaches.length };
}

// ===== Admin: 建立 Job =====
router.post("/admin/jobs", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const f = pickFields(req.body);
    if (!f.title) return res.status(400).json({ error: "請輸入 Job 標題" });

    const id = uuidv4();
    db.prepare(
      `INSERT INTO coach_jobs (id, title, description, job_date, venue, pay_hkd, slots, link, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    ).run(
      id,
      f.title,
      f.description,
      f.job_date,
      f.venue,
      f.pay_hkd,
      f.slots,
      f.link,
      req.user.id,
    );

    const job = db.prepare("SELECT * FROM coach_jobs WHERE id = ?").get(id);
    const notify = notifyAllCoaches(db, job);
    res.json({ job, notified: notify.sent, total_coaches: notify.total });
  } catch (err) {
    console.error("建立 Job 錯誤:", err);
    res.status(500).json({ error: "建立 Job 失敗" });
  }
});

// ===== Admin: 列出 Jobs =====
router.get("/admin/jobs", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const coachTotal = db
      .prepare(
        "SELECT COUNT(*) AS c FROM users WHERE is_coach = 1 OR coach_verified = 1 OR role = 'coach'",
      )
      .get().c;
    const jobs = db
      .prepare(
        `SELECT j.*,
          (SELECT COUNT(*) FROM coach_job_responses r WHERE r.job_id = j.id AND r.response = 'accepted') AS accepted_count,
          (SELECT COUNT(*) FROM coach_job_responses r WHERE r.job_id = j.id AND r.response = 'declined') AS declined_count
         FROM coach_jobs j
         ORDER BY j.created_at DESC`,
      )
      .all();
    res.json({ jobs, coach_total: coachTotal });
  } catch (err) {
    console.error("列出 Jobs 錯誤:", err);
    res.status(500).json({ error: "無法取得 Job 列表" });
  }
});

// ===== Admin: Job 詳情 + 回覆名單 =====
router.get("/admin/jobs/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const job = db
      .prepare("SELECT * FROM coach_jobs WHERE id = ?")
      .get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job 不存在" });
    const responses = db
      .prepare(
        `SELECT r.id, r.response, r.note, r.created_at, r.updated_at,
                u.id AS coach_id, u.name, u.email, u.phone
         FROM coach_job_responses r
         JOIN users u ON u.id = r.coach_id
         WHERE r.job_id = ?
         ORDER BY r.response, r.updated_at DESC`,
      )
      .all(req.params.id);
    res.json({ job, responses });
  } catch (err) {
    console.error("Job 詳情錯誤:", err);
    res.status(500).json({ error: "無法取得 Job 詳情" });
  }
});

// ===== Admin: 更改狀態 =====
router.post(
  "/admin/jobs/:id/status",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    try {
      const db = getDb();
      const status = String(req.body.status || "");
      if (!["open", "closed", "cancelled"].includes(status)) {
        return res.status(400).json({ error: "無效狀態" });
      }
      const r = db
        .prepare(
          "UPDATE coach_jobs SET status = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .run(status, req.params.id);
      if (r.changes === 0)
        return res.status(404).json({ error: "Job 不存在" });
      res.json({ ok: true, status });
    } catch (err) {
      console.error("更新 Job 狀態錯誤:", err);
      res.status(500).json({ error: "更新失敗" });
    }
  },
);

// ===== Admin: 重新派發 =====
router.post(
  "/admin/jobs/:id/dispatch",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    try {
      const db = getDb();
      const job = db
        .prepare("SELECT * FROM coach_jobs WHERE id = ?")
        .get(req.params.id);
      if (!job) return res.status(404).json({ error: "Job 不存在" });
      if (job.status !== "open")
        return res.status(400).json({ error: "只有開放中嘅 Job 可以派發" });
      const notify = notifyAllCoaches(db, job);
      res.json({ ok: true, notified: notify.sent, total_coaches: notify.total });
    } catch (err) {
      console.error("派發 Job 錯誤:", err);
      res.status(500).json({ error: "派發失敗" });
    }
  },
);

// ===== Coach: 我睇到嘅開放 Job =====
router.get("/coach/jobs", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    if (!isCoach(db, req.user.id))
      return res.status(403).json({ error: "需要教練權限" });
    const jobs = db
      .prepare(
        `SELECT j.*, r.response AS my_response, r.note AS my_note,
                r.updated_at AS my_responded_at,
                (SELECT COUNT(*) FROM coach_job_responses a WHERE a.job_id = j.id AND a.response = 'accepted') AS accepted_count
         FROM coach_jobs j
         LEFT JOIN coach_job_responses r ON r.job_id = j.id AND r.coach_id = ?
         WHERE j.status = 'open'
         ORDER BY j.created_at DESC`,
      )
      .all(req.user.id);
    res.json({ jobs });
  } catch (err) {
    console.error("教練 Job 列表錯誤:", err);
    res.status(500).json({ error: "無法取得工作列表" });
  }
});

// ===== Coach: 接單 / 唔接 =====
router.post("/coach/jobs/:id/respond", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    if (!isCoach(db, req.user.id))
      return res.status(403).json({ error: "需要教練權限" });
    const response = String(req.body.response || "");
    if (!["accepted", "declined"].includes(response)) {
      return res.status(400).json({ error: "無效回覆" });
    }
    const job = db
      .prepare("SELECT * FROM coach_jobs WHERE id = ?")
      .get(req.params.id);
    if (!job) return res.status(404).json({ error: "工作不存在" });
    if (job.status !== "open")
      return res.status(400).json({ error: "此工作已結束" });

    const note = req.body.note ? String(req.body.note).trim() : null;
    const existing = db
      .prepare(
        "SELECT id FROM coach_job_responses WHERE job_id = ? AND coach_id = ?",
      )
      .get(job.id, req.user.id);
    if (existing) {
      db.prepare(
        "UPDATE coach_job_responses SET response = ?, note = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(response, note, existing.id);
    } else {
      db.prepare(
        "INSERT INTO coach_job_responses (id, job_id, coach_id, response, note) VALUES (?, ?, ?, ?, ?)",
      ).run(uuidv4(), job.id, req.user.id, response, note);
    }
    res.json({ ok: true, response });
  } catch (err) {
    console.error("教練回覆 Job 錯誤:", err);
    res.status(500).json({ error: "回覆失敗" });
  }
});

module.exports = router;
