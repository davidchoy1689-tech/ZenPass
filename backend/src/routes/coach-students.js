/**
 * routes/coach-students.js — 教練「我的學生」＋記帳本
 *
 *  GET    /api/coach/students                 名冊（自動電話相認）
 *  POST   /api/coach/students                 新增線下學生
 *  PATCH  /api/coach/students/:id             編輯（姓名／電話／備註／標籤）
 *  POST   /api/coach/students/:id/archive     封存（保留紀錄，唔 DELETE）
 *  POST   /api/coach/students/:id/invite      重新產生邀請連結
 *  GET    /api/coach/students/:id/ledger      記帳紀錄
 *  POST   /api/coach/students/:id/ledger      新增一筆（收入／退款／調整）
 *  POST   /api/coach/students/ledger/:entryId/void  作廢（保留原紀錄）
 *  GET    /api/coach/students/summary         總覽數字
 *  GET    /api/coach/wallet                   平台錢包（接單收入一目了然）
 *  GET    /api/coach/students/:id/packages    套票清單（預收 → 逐堂扣）
 *  POST   /api/coach/students/:id/packages    新增套票（同時記一筆預收收入）
 *  POST   /api/coach/students/packages/:pid/attendance          手動簽到扣一堂
 *  POST   /api/coach/students/packages/:pid/attendance/:aid/void 取消簽到（回退一堂）
 *  POST   /api/coach/students/packages/:pid/void                作廢套票（紀錄保留）
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken, requireCoach } = require("../middleware/auth");
const svc = require("../services/coach-students");

const router = express.Router();
router.use("/coach/students", authenticateToken, requireCoach);

const PHONE_RE = /^[4-9]\d{7}$/;

function ok(res, payload) {
  res.json(Object.assign({ success: true }, payload));
}

// ===== GET /api/coach/wallet — 平台接單錢包總覽 =====
router.get("/coach/wallet", authenticateToken, requireCoach, (req, res) => {
  try {
    const db = getDb();
    const uid = req.user.id;
    const u = db.prepare("SELECT wallet_balance, pending_payout, commission_rate FROM users WHERE id=?").get(uid) || {};

    const safety = (n) => Math.round(Number(n || 0) * 100) / 100;
    const now = new Date();
    const hk = new Date(now.getTime() + 8 * 3600e3);
    const month = hk.toISOString().slice(0, 7);

    const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    let earnedMonth = 0, earnedTotal = 0, pendingPayout = 0, paidTotal = 0, sessionsMonth = 0;
    if (hasTable("coach_earnings")) {
      const m = db
        .prepare(
          `SELECT COALESCE(SUM(net_amount),0) AS amt, COUNT(*) AS n FROM coach_earnings
            WHERE coach_id=? AND substr(date,1,7)=? AND status<>'cancelled'`,
        )
        .get(uid, month) || {};
      earnedMonth = safety(m.amt);
      sessionsMonth = Number(m.n || 0);
      const t = db
        .prepare("SELECT COALESCE(SUM(net_amount),0) AS amt FROM coach_earnings WHERE coach_id=? AND status<>'cancelled'")
        .get(uid) || {};
      earnedTotal = safety(t.amt);
      const p = db
        .prepare("SELECT COALESCE(SUM(net_amount),0) AS amt FROM coach_earnings WHERE coach_id=? AND status IN ('pending','approved')")
        .get(uid) || {};
      pendingPayout = safety(p.amt);
      const pd = db
        .prepare("SELECT COALESCE(SUM(net_amount),0) AS amt FROM coach_earnings WHERE coach_id=? AND status='paid'")
        .get(uid) || {};
      paidTotal = safety(pd.amt);
    }

    // 下次出糧：每月 7 號（遇週六日提早至星期五）
    const pc = require("../services/payout-calendar").nextPayoutForMonth(month);
    const nextPayoutLabel = pc.label;
    const nextPayoutDate = pc.date;

    let recent = [];
    if (hasTable("wallet_transactions")) {
      recent = db
        .prepare(
          `SELECT type, amount, description, status, created_at FROM wallet_transactions
            WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 5`,
        )
        .all(uid)
        .map((r) => ({
          type: r.type,
          amount: safety(r.amount),
          description: r.description || "",
          status: r.status || "completed",
          created_at: r.created_at,
        }));
    }

    res.set("Cache-Control", "no-store");
    ok(res, {
      wallet: {
        available: safety(u.wallet_balance),
        pending_payout: safety(u.pending_payout != null ? u.pending_payout : pendingPayout),
        pending_from_earnings: pendingPayout,
        paid_total: paidTotal,
        earned_month: earnedMonth,
        earned_total: earnedTotal,
        sessions_month: sessionsMonth,
        commission_rate: Number(u.commission_rate) > 0 ? Number(u.commission_rate) : 0.8,
        month,
        next_payout: nextPayoutDate,
        next_payout_label: nextPayoutLabel,
        next_payout_shifted: pc.shifted,
        payout_day: pc.payout_day,
        payout_rule: require("../services/payout-calendar").RULE_TEXT,
        recent,
      },
    });
  } catch (e) {
    console.error("[COACH-WALLET]", e.message);
    res.status(500).json({ success: false, error: "讀取錢包失敗" });
  }
});

router.get("/coach/students", (req, res) => {
  try {
    const db = getDb();
    svc.ensureSchema(db);
    svc.matchAndBind(db, req.user.id);
    const { students, stats } = svc.listStudents(db, req.user.id, { q: req.query.q });
    res.set("Cache-Control", "no-store");
    ok(res, { students, stats });
  } catch (e) {
    console.error("[COACH-STUDENTS] list:", e.message);
    res.status(500).json({ success: false, error: "讀取名冊失敗" });
  }
});

router.get("/coach/students/summary", (req, res) => {
  try {
    const db = getDb();
    svc.ensureSchema(db);
    svc.matchAndBind(db, req.user.id);
    const { stats } = svc.listStudents(db, req.user.id);
    ok(res, { stats });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取統計失敗" });
  }
});

router.post("/coach/students", (req, res) => {
  try {
    const db = getDb();
    svc.ensureSchema(db);
    const name = String((req.body || {}).name || "").trim();
    const phone = svc.normPhone((req.body || {}).phone);
    const notes = String((req.body || {}).notes || "").trim().slice(0, 200);
    const tags = String((req.body || {}).tags || "").trim().slice(0, 120);
    if (!name) return res.status(400).json({ success: false, error: "請填寫學生姓名", code: "NAME_REQUIRED" });
    if (!PHONE_RE.test(phone)) return res.status(400).json({ success: false, error: "請填寫 8 位香港電話（相認用）", code: "PHONE_INVALID" });

    const dup = db
      .prepare("SELECT id FROM student_onboarding_invites WHERE coach_id=? AND phone=? AND archived_at IS NULL")
      .get(req.user.id, phone);
    if (dup) return res.status(409).json({ success: false, error: "此電話已在你的名冊（勿重複新增）", code: "DUPLICATE" });

    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("hex");
    db.prepare(
      `INSERT INTO student_onboarding_invites (id, coach_id, student_name, phone, notes, tags, initial_pass_quota, token, status)
       VALUES (?,?,?,?,?,?,?,?, 'pending')`,
    ).run(id, req.user.id, name.slice(0, 60), phone, notes, tags, 1, token);
    try {
      const { audit } = require("../services/audit");
      audit({
        actionType: "coach.student_added",
        entityType: "student_onboarding_invite",
        entityId: id,
        userId: req.user.id,
        newValues: { name: name.slice(0, 60), phone },
        description: "教練新增線下學生",
      });
    } catch (e) {}
    // 若學生其實已登記平台 → 即刻相認
    svc.matchAndBind(db, req.user.id);
    ok(res, { id, token, invite_url: "/welcome.html?token=" + token });
  } catch (e) {
    console.error("[COACH-STUDENTS] create:", e.message);
    res.status(500).json({ success: false, error: "新增失敗" });
  }
});

router.patch("/coach/students/:id", (req, res) => {
  try {
    const db = getDb();
    svc.ensureSchema(db);
    const inv = db
      .prepare("SELECT * FROM student_onboarding_invites WHERE id=? AND coach_id=? AND archived_at IS NULL")
      .get(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ success: false, error: "學生不存在" });
    const b = req.body || {};
    const name = b.name != null ? String(b.name).trim().slice(0, 60) : inv.student_name;
    if (!name) return res.status(400).json({ success: false, error: "姓名不可空白" });
    const notes = b.notes != null ? String(b.notes).trim().slice(0, 200) : inv.notes;
    const tags = b.tags != null ? String(b.tags).trim().slice(0, 120) : inv.tags;
    let phone = inv.phone;
    if (b.phone != null) {
      const p = svc.normPhone(b.phone);
      if (!PHONE_RE.test(p)) return res.status(400).json({ success: false, error: "電話格式不正確", code: "PHONE_INVALID" });
      if (inv.status === "claimed" || inv.matched_user_id) {
        return res.status(409).json({ success: false, error: "學生已上平台，電話為相認鍵，不可更改", code: "PHONE_LOCKED" });
      }
      const dup = db
        .prepare("SELECT id FROM student_onboarding_invites WHERE coach_id=? AND phone=? AND id<>? AND archived_at IS NULL")
        .get(req.user.id, p, inv.id);
      if (dup) return res.status(409).json({ success: false, error: "此電話已在名冊", code: "DUPLICATE" });
      phone = p;
    }
    db.prepare("UPDATE student_onboarding_invites SET student_name=?, phone=?, notes=?, tags=? WHERE id=?").run(
      name,
      phone,
      notes || "",
      tags || "",
      inv.id,
    );
    svc.matchAndBind(db, req.user.id);
    ok(res, { id: inv.id });
  } catch (e) {
    console.error("[COACH-STUDENTS] update:", e.message);
    res.status(500).json({ success: false, error: "更新失敗" });
  }
});

router.post("/coach/students/:id/archive", (req, res) => {
  try {
    const db = getDb();
    svc.ensureSchema(db);
    const inv = db
      .prepare("SELECT id FROM student_onboarding_invites WHERE id=? AND coach_id=? AND archived_at IS NULL")
      .get(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ success: false, error: "學生不存在" });
    db.prepare("UPDATE student_onboarding_invites SET archived_at=datetime('now') WHERE id=?").run(inv.id);
    try {
      const { audit } = require("../services/audit");
      audit({
        actionType: "coach.student_archived",
        entityType: "student_onboarding_invite",
        entityId: inv.id,
        userId: req.user.id,
        newValues: {},
        description: "教練封存學生（紀錄保留）",
      });
    } catch (e) {}
    ok(res, { archived: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "封存失敗" });
  }
});

router.post("/coach/students/:id/invite", (req, res) => {
  try {
    const db = getDb();
    svc.ensureSchema(db);
    const inv = db
      .prepare("SELECT * FROM student_onboarding_invites WHERE id=? AND coach_id=? AND archived_at IS NULL")
      .get(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ success: false, error: "學生不存在" });
    if (inv.status === "claimed") return res.status(409).json({ success: false, error: "學生已上平台，毋須再邀請" });
    const token = crypto.randomBytes(32).toString("hex");
    db.prepare("UPDATE student_onboarding_invites SET token=?, status='pending' WHERE id=?").run(token, inv.id);
    const quota = Math.max(1, Number(inv.initial_pass_quota || 1));
    ok(res, { token, invite_url: "/welcome.html?token=" + token, quota });
  } catch (e) {
    res.status(500).json({ success: false, error: "產生邀請失敗" });
  }
});

router.get("/coach/students/:id/ledger", (req, res) => {
  try {
    const db = getDb();
    svc.ensureSchema(db);
    const inv = db
      .prepare("SELECT id FROM student_onboarding_invites WHERE id=? AND coach_id=?")
      .get(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ success: false, error: "學生不存在" });
    ok(res, { entries: svc.listLedger(db, req.user.id, inv.id), summary: svc.ledgerSummary(db, inv.id) });
  } catch (e) {
    res.status(500).json({ success: false, error: "讀取記帳失敗" });
  }
});

router.post("/coach/students/:id/ledger", (req, res) => {
  try {
    const db = getDb();
    const r = svc.addLedgerEntry(db, req.user.id, req.params.id, req.body || {});
    if (r.error === "STUDENT_NOT_FOUND") return res.status(404).json({ success: false, error: "學生不存在" });
    if (r.error === "TYPE_INVALID") return res.status(400).json({ success: false, error: "類型無效" });
    if (r.error === "AMOUNT_INVALID") return res.status(400).json({ success: false, error: "金額必須大於 0" });
    if (r.error) return res.status(400).json({ success: false, error: "記錄失敗" });
    ok(res, { entry: r.entry, summary: svc.ledgerSummary(db, req.params.id) });
  } catch (e) {
    console.error("[COACH-STUDENTS] ledger add:", e.message);
    res.status(500).json({ success: false, error: "記錄失敗" });
  }
});

router.post("/coach/students/ledger/:entryId/void", (req, res) => {
  try {
    const db = getDb();
    const reason = String((req.body || {}).reason || "").trim();
    if (reason.length < 2) return res.status(400).json({ success: false, error: "請填寫作廢原因" });
    const r = svc.voidLedgerEntry(db, req.user.id, req.params.entryId, reason);
    if (r.error === "ENTRY_NOT_FOUND") return res.status(404).json({ success: false, error: "紀錄不存在" });
    if (r.error === "ALREADY_VOID") return res.status(409).json({ success: false, error: "已作廢" });
    ok(res, { voided: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "作廢失敗" });
  }
});

/* ===================== 課程套票 ===================== */

router.get("/coach/students/:id/packages", (req, res) => {
  try {
    const db = getDb();
    svc.ensureSchema(db);
    const inv = db
      .prepare("SELECT id FROM student_onboarding_invites WHERE id=? AND coach_id=?")
      .get(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ success: false, error: "學生不存在" });
    const packages = svc.listPackages(db, req.user.id, inv.id);
    ok(res, { packages, totals: svc.packageTotals(packages) });
  } catch (e) {
    console.error("[COACH-PKG] list:", e.message);
    res.status(500).json({ success: false, error: "讀取套票失敗" });
  }
});

router.post("/coach/students/:id/packages", (req, res) => {
  try {
    const db = getDb();
    const r = svc.addPackage(db, req.user.id, req.params.id, req.body || {});
    const map = {
      STUDENT_NOT_FOUND: [404, "學生不存在"],
      TITLE_REQUIRED: [400, "請填寫課程名稱"],
      SESSIONS_INVALID: [400, "堂數必須 1–200"],
      AMOUNT_INVALID: [400, "金額必須大於 0"],
      AMOUNT_TOO_LARGE: [400, "金額過大"],
    };
    if (r.error) {
      const [code, msg] = map[r.error] || [400, "新增套票失敗"];
      return res.status(code).json({ success: false, error: msg, code: r.error });
    }
    ok(res, { package: r.package });
  } catch (e) {
    console.error("[COACH-PKG] create:", e.message);
    res.status(500).json({ success: false, error: "新增套票失敗" });
  }
});

router.post("/coach/students/packages/:pid/attendance", (req, res) => {
  try {
    const db = getDb();
    const r = svc.markPackageAttendance(db, req.user.id, req.params.pid, req.body || {});
    const map = {
      PACKAGE_NOT_FOUND: [404, "套票不存在"],
      PACKAGE_VOID: [409, "套票已作廢"],
      PACKAGE_FULL: [409, "呢個套票已經上齊堂"],
      ALREADY_MARKED: [409, "呢日已經簽到過"],
    };
    if (r.error) {
      const [code, msg] = map[r.error] || [400, "簽到失敗"];
      return res.status(code).json({ success: false, error: msg, code: r.error });
    }
    ok(res, { package: r.package });
  } catch (e) {
    console.error("[COACH-PKG] attendance:", e.message);
    res.status(500).json({ success: false, error: "簽到失敗" });
  }
});

router.post("/coach/students/packages/:pid/attendance/:aid/void", (req, res) => {
  try {
    const db = getDb();
    const reason = String((req.body || {}).reason || "").trim();
    if (reason.length < 2) return res.status(400).json({ success: false, error: "請填寫取消原因" });
    const r = svc.voidPackageAttendance(db, req.user.id, req.params.pid, req.params.aid, reason);
    const map = {
      PACKAGE_NOT_FOUND: [404, "套票不存在"],
      ATTENDANCE_NOT_FOUND: [404, "簽到紀錄不存在"],
      ALREADY_VOID: [409, "已取消"],
    };
    if (r.error) {
      const [code, msg] = map[r.error] || [400, "取消失敗"];
      return res.status(code).json({ success: false, error: msg, code: r.error });
    }
    ok(res, { voided: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "取消失敗" });
  }
});

router.post("/coach/students/packages/:pid/void", (req, res) => {
  try {
    const db = getDb();
    const reason = String((req.body || {}).reason || "").trim();
    if (reason.length < 2) return res.status(400).json({ success: false, error: "請填寫作廢原因" });
    const r = svc.voidPackage(db, req.user.id, req.params.pid, reason);
    if (r.error === "PACKAGE_NOT_FOUND") return res.status(404).json({ success: false, error: "套票不存在" });
    if (r.error === "ALREADY_VOID") return res.status(409).json({ success: false, error: "已作廢" });
    ok(res, { voided: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "作廢失敗" });
  }
});

module.exports = router;
