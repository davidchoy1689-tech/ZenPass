/**
 * Phase 5.1 — B2B Corporate Perks API
 *
 * POST /api/b2b/employee/verify           工作電郵 → 寄 6 位 OTP
 * POST /api/b2b/employee/verify/confirm   OTP → 綁定員工 ＋ 發企業 Pass
 * GET  /api/b2b/employee/me               企業身份、配额、池餘額
 * POST /api/bookings/book-with-corporate-pass
 * GET  /api/b2b/dashboard                 企業 HR 看板
 * GET  /api/b2b/invoice?month=YYYY-MM     統一發票（HTML / PDF / CSV）
 * POST /api/admin/corporate/clients       建立企業客戶（admin）
 * GET  /api/admin/corporate/clients       企業列表（admin）
 * POST /api/admin/corporate/clients/:id/topup  企業預付款充值（admin）
 */
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { getDb } = require("../services/database");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const { requireIdempotency } = require("../middleware/idempotency");
const { audit } = require("../services/audit");
const { sendEmail } = require("../services/email");
const { sendNotification } = require("../services/notification");
const b2b = require("../services/b2b-corporate");

const router = express.Router();
const execFileAsync = promisify(execFile);

function fail(res, status, code, error, extra) {
  return res.status(status).json({ success: false, code, error, ...(extra || {}) });
}

function isAdminUser(db, userId) {
  const u = db.prepare("SELECT role FROM users WHERE id=?").get(userId);
  return u && ["admin", "super_admin"].includes(u.role);
}

function rateLimitOtp(db, workEmail) {
  const row = db.prepare("SELECT created_at FROM corporate_email_otps WHERE work_email=? ORDER BY created_at DESC LIMIT 1").get(workEmail);
  if (!row) return null;
  const t = new Date(String(row.created_at).replace(" ", "T") + "Z").getTime();
  const wait = 60 * 1000 - (Date.now() - t);
  return wait > 0 ? Math.ceil(wait / 1000) : null;
}

// ===== 1. 寄送工作電郵 OTP =====
router.post("/b2b/employee/verify", authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    b2b.ensureSchema(db);
    const workEmail = String(req.body?.work_email || req.body?.workEmail || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(workEmail)) return fail(res, 400, "WORK_EMAIL_INVALID", "請輸入有效嘅公司工作電郵");

    const client = b2b.findClientByEmail(db, workEmail);
    if (!client) return fail(res, 403, "DOMAIN_NOT_ELIGIBLE", "此電郵域名未屬於任何合作企業。請聯絡 HR 或 ZenPass 企業團隊。");

    const linked = db.prepare("SELECT user_id FROM corporate_employees WHERE work_email=?").get(workEmail);
    if (linked && linked.user_id !== req.user.id) return fail(res, 409, "EMAIL_ALREADY_LINKED", "此工作電郵已綁定其他帳戶，請聯絡企業管理員");

    const wait = rateLimitOtp(db, workEmail);
    if (wait) return fail(res, 429, "OTP_TOO_SOON", `請 ${wait} 秒後再試`, { retry_after: wait });

    const otp = b2b.createOtp(db, { workEmail, corporateId: client.id });
    const html = `
      <div style="font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;max-width:520px;margin:auto">
        <h2 style="color:#0f766e">ZenPass for Business</h2>
        <p>你正在驗證 <b>${client.company_name}</b> 企業員工福利。</p>
        <p style="font-size:34px;letter-spacing:8px;font-weight:700;background:#f1f5f9;padding:16px;text-align:center;border-radius:10px">${otp.code}</p>
        <p>驗證碼 10 分鐘內有效，只可使用一次。</p>
        <p style="color:#64748b;font-size:12px">如非你本人操作，請忽略此電郵。</p>
      </div>`;
    const mail = await sendEmail(workEmail, `ZenPass 企業福利驗證碼：${otp.code}`, html).catch(() => ({ sent: false }));
    if (!mail.sent) console.log(`[B2B OTP] ${b2b.maskEmail(workEmail)} code=${otp.code}`);

    audit({
      actionType: "corporate.employee_otp_sent",
      entityType: "corporate_client",
      entityId: client.id,
      userId: req.user.id,
      newValues: { work_email: b2b.maskEmail(workEmail), email_sent: !!mail.sent },
      description: "企業員工工作電郵驗證碼",
    });

    res.json({
      success: true,
      otp_id: otp.id,
      work_email_masked: b2b.maskEmail(workEmail),
      company_name: client.company_name,
      expires_in_seconds: 600,
      email_sent: !!mail.sent,
      dev_code: process.env.B2B_OTP_DEBUG === "1" ? otp.code : undefined,
      message: mail.sent ? "驗證碼已寄到你的公司電郵" : "驗證碼已生成（SMTP 未配置，請看伺服器日誌）",
    });
  } catch (e) {
    console.error("[B2B] verify:", e.message);
    fail(res, 500, "SERVER_ERROR", "驗證碼發送失敗");
  }
});

// ===== 2. 確認 OTP =====
router.post("/b2b/employee/verify/confirm", authenticateToken, (req, res) => {
  const db = getDb();
  let inTx = false;
  try {
    b2b.ensureSchema(db);
    const workEmail = String(req.body?.work_email || req.body?.workEmail || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!/^\d{6}$/.test(code)) return fail(res, 400, "OTP_INVALID", "請輸入 6 位驗證碼");

    const client = b2b.findClientByEmail(db, workEmail);
    if (!client) return fail(res, 403, "DOMAIN_NOT_ELIGIBLE", "此電郵域名未屬於任何合作企業");

    const otp = db
      .prepare("SELECT * FROM corporate_email_otps WHERE work_email=? AND consumed=0 ORDER BY created_at DESC LIMIT 1")
      .get(workEmail);
    if (!otp) return fail(res, 400, "OTP_NOT_FOUND", "請先取得驗證碼");
    if (new Date(otp.expires_at).getTime() < Date.now()) return fail(res, 400, "OTP_EXPIRED", "驗證碼已過期，請重新發送");
    if (Number(otp.attempts) >= b2b.OTP_MAX_ATTEMPTS) return fail(res, 429, "OTP_LOCKED", "嘗試次數過多，請重新發送驗證碼");

    if (otp.code_hash !== b2b.hashOtp(code)) {
      db.prepare("UPDATE corporate_email_otps SET attempts=attempts+1 WHERE id=?").run(otp.id);
      return fail(res, 400, "OTP_INVALID", "驗證碼不正確");
    }

    db.exec("BEGIN IMMEDIATE");
    inTx = true;
    db.prepare("UPDATE corporate_email_otps SET consumed=1 WHERE id=?").run(otp.id);

    const linked = b2b.linkEmployee(db, { client, userId: req.user.id, workEmail });
    if (linked.error) {
      db.exec("ROLLBACK");
      inTx = false;
      return fail(res, 409, linked.error, "此工作電郵已綁定其他帳戶");
    }
    db.exec("COMMIT");
    inTx = false;

    const emp = db.prepare("SELECT * FROM corporate_employees WHERE id=?").get(linked.employee.id);
    const quota = b2b.quotaState(db, emp, client);

    audit({
      actionType: "corporate.employee_verified",
      entityType: "corporate_employee",
      entityId: emp.id,
      userId: req.user.id,
      newValues: { corporate_id: client.id, work_email: b2b.maskEmail(workEmail), quota },
      description: `企業員工認證：${client.company_name}`,
    });

    res.json({
      success: true,
      employee_id: emp.id,
      corporate: { id: client.id, name: client.company_name, tier: client.contract_tier },
      pass_id: linked.pass_id,
      quota,
      badge: `🏢 ${client.company_name} 企業會員`,
      message: `已開通 ${client.company_name} 企業福利`,
    });
  } catch (e) {
    if (inTx) { try { db.exec("ROLLBACK"); } catch (x) {} }
    console.error("[B2B] confirm:", e.message);
    fail(res, 500, "SERVER_ERROR", "驗證失敗，請再試");
  }
});

// ===== 3. 我的企業身份 =====
router.get("/b2b/employee/me", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    b2b.ensureSchema(db);
    const emp = db.prepare("SELECT * FROM corporate_employees WHERE user_id=? AND status='verified' ORDER BY created_at DESC LIMIT 1").get(req.user.id);
    if (!emp) return res.json({ success: true, corporate: null });
    const client = db.prepare("SELECT * FROM corporate_clients WHERE id=?").get(emp.corporate_id);
    if (!client || client.status !== "active") return res.json({ success: true, corporate: null, suspended: true });
    const quota = b2b.quotaState(db, emp, client);
    res.json({
      success: true,
      corporate: {
        id: client.id,
        name: client.company_name,
        tier: client.contract_tier,
        pool_cents: Number(client.credit_pool_cents || 0),
        badge: `🏢 ${client.company_name} 企業會員`,
      },
      employee: { id: emp.id, work_email_masked: b2b.maskEmail(emp.work_email) },
      quota,
    });
  } catch (e) {
    console.error("[B2B] me:", e.message);
    fail(res, 500, "SERVER_ERROR", "讀取企業身份失敗");
  }
});

// ===== 4. 企業 Pass 預約 =====
router.post("/bookings/book-with-corporate-pass", authenticateToken, requireIdempotency, (req, res) => {
  const db = getDb();
  let inTx = false;
  try {
    b2b.ensureSchema(db);
    const scheduleId = String(req.body?.schedule_id || req.body?.scheduleId || "");
    const attendeeId = String(req.body?.attendee_user_id || req.body?.attendeeUserId || req.user.id);
    if (!scheduleId) return fail(res, 400, "SCHEDULE_REQUIRED", "缺少班次");

    const emp = db.prepare("SELECT * FROM corporate_employees WHERE user_id=? AND status='verified' ORDER BY created_at DESC LIMIT 1").get(req.user.id);
    if (!emp) return fail(res, 403, "CORPORATE_MEMBER_REQUIRED", "你未完成企業員工認證");
    if (attendeeId !== req.user.id) return fail(res, 403, "CORPORATE_SEAT_TRANSFER_FORBIDDEN", "企業福利只限本人使用，不可轉贈");

    const client = db.prepare("SELECT * FROM corporate_clients WHERE id=? AND status='active'").get(emp.corporate_id);
    if (!client) return fail(res, 403, "CORPORATE_SUSPENDED", "企業帳戶已暫停");

    const sched = db.prepare(
      `SELECT s.*, c.title, c.price_hkd, c.price_hkd_cents, COALESCE(s.max_participants,c.max_participants,20) capacity,
              COALESCE(s.enrolled_count,0) enrolled, COALESCE(s.booking_open, c.booking_open, 1) open_flag
         FROM class_schedules s JOIN classes c ON c.id=s.class_id WHERE s.id=?`,
    ).get(scheduleId);
    if (!sched) return fail(res, 404, "SCHEDULE_NOT_FOUND", "班次不存在");
    if (["cancelled", "completed"].includes(String(sched.status || ""))) return fail(res, 409, "SCHEDULE_CLOSED", "此班次已取消或完結");
    if (Number(sched.open_flag) !== 1) return fail(res, 409, "BOOKING_CLOSED", "此班次暫未開放預約");
    const startIso = /Z$|[+-]\d\d:?\d\d$/.test(String(sched.start_time)) ? sched.start_time : String(sched.start_time).replace(" ", "T") + "Z";
    if (new Date(startIso).getTime() - Date.now() < 2 * 3600000) return fail(res, 409, "CUTOFF", "開課前 2 小時已截止即時預約");
    if (Number(sched.enrolled) >= Number(sched.capacity)) return fail(res, 409, "CLASS_FULL", "該班次已額滿");
    if (db.prepare("SELECT id FROM bookings WHERE schedule_id=? AND user_id=? AND status<>'cancelled' LIMIT 1").get(scheduleId, req.user.id)) {
      return fail(res, 409, "ALREADY_BOOKED", "你已預約此班次");
    }

    const quota = b2b.quotaState(db, emp, client);
    if (quota.remaining <= 0) {
      return fail(res, 402, "CORPORATE_QUOTA_EXCEEDED", `本月 ${quota.quota} 堂企業配額已用完，可改用個人家庭 Pass 預約`, { quota });
    }
    const price = b2b.resolveSchedulePrice({ ...sched, schedule_price_cents: sched.price_hkd_cents });
    if (price.price_cents <= 0) return fail(res, 409, "PRICE_UNAVAILABLE", "此班次未設定價格");
    if (Number(client.credit_pool_cents || 0) < price.price_cents) {
      return fail(res, 402, "CORPORATE_POOL_INSUFFICIENT", "企業預付款池餘額不足，請聯絡 HR 充值");
    }

    db.exec("BEGIN IMMEDIATE");
    inTx = true;
    const seat = db.prepare("UPDATE class_schedules SET enrolled_count=COALESCE(enrolled_count,0)+1 WHERE id=? AND COALESCE(enrolled_count,0) < ?").run(scheduleId, Number(sched.capacity));
    if (seat.changes !== 1) { db.exec("ROLLBACK"); inTx = false; return fail(res, 409, "CLASS_FULL", "該班次已額滿"); }

    const pool = db.prepare("UPDATE corporate_clients SET credit_pool_cents=credit_pool_cents-?, updated_at=datetime('now') WHERE id=? AND credit_pool_cents >= ?").run(price.price_cents, client.id, price.price_cents);
    if (pool.changes !== 1) { db.exec("ROLLBACK"); inTx = false; return fail(res, 402, "CORPORATE_POOL_INSUFFICIENT", "企業預付款池餘額不足"); }

    db.prepare("UPDATE corporate_employees SET consumed_units_this_month=consumed_units_this_month+1 WHERE id=?").run(emp.id);
    const max = db.prepare("SELECT MAX(CAST(SUBSTR(booking_reference,4) AS INTEGER)) m FROM bookings WHERE booking_reference GLOB 'ZP-[0-9]*'").get().m || 0;
    const bookingRef = "ZP-" + String(max + 1).padStart(4, "0");
    const bookingId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, payment_type, payment_status, status, amount, amount_cents, group_size, corporate_id, corporate_employee_id, created_at)
       VALUES (?,?,?,?,?, 'corporate', 'paid', 'confirmed', ?, ?, 1, ?, ?, datetime('now'))`,
    ).run(bookingId, bookingRef, req.user.id, scheduleId, sched.class_id, price.price_cents / 100, price.price_cents, client.id, emp.id);

    const fresh = db.prepare("SELECT * FROM corporate_employees WHERE id=?").get(emp.id);
    const passId = b2b.syncPass(db, fresh, client);
    db.exec("COMMIT");
    inTx = false;

    audit({
      actionType: "booking.corporate_pass_booked",
      entityType: "booking",
      entityId: bookingId,
      userId: req.user.id,
      newValues: {
        corporate_id: client.id,
        employee_id: emp.id,
        schedule_id: scheduleId,
        price_cents: price.price_cents,
        is_flash: price.is_flash,
        pool_after_cents: Number(client.credit_pool_cents || 0) - price.price_cents,
      },
      description: `企業福利預約 ${sched.title || scheduleId}`,
    });
    try { sendNotification("booking.confirmed", { recipient: req.user.id, data: { booking_id: bookingId, class_name: sched.title || "課堂", date: String(sched.start_time).slice(0, 16) } }); } catch (e) {}

    res.status(201).json({
      success: true,
      booking_id: bookingId,
      booking_reference: bookingRef,
      status: "confirmed",
      payment_type: "corporate",
      corporate: { id: client.id, name: client.company_name, badge: `🏢 ${client.company_name} 企業會員` },
      charged_cents: price.price_cents,
      is_flash: price.is_flash,
      quota: { ...quota, used: quota.used + 1, remaining: quota.remaining - 1 },
      pass_id: passId,
    });
  } catch (e) {
    if (inTx) { try { db.exec("ROLLBACK"); } catch (x) {} }
    console.error("[B2B] book:", e.message);
    fail(res, 500, "SERVER_ERROR", "企業福利預約失敗");
  }
});

// ===== 5. 企業 HR 看板 =====
router.get("/b2b/dashboard", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    b2b.ensureSchema(db);
    let clientId = String(req.query.corporate_id || "");
    if (!clientId) {
      const emp = db.prepare("SELECT corporate_id FROM corporate_employees WHERE user_id=? AND status='verified' LIMIT 1").get(req.user.id);
      clientId = emp?.corporate_id || "";
    }
    const client = clientId ? db.prepare("SELECT * FROM corporate_clients WHERE id=?").get(clientId) : null;
    if (!client) return fail(res, 404, "CORPORATE_NOT_FOUND", "找不到企業帳戶");
    const emp = db.prepare("SELECT role FROM corporate_employees WHERE corporate_id=? AND user_id=?").get(clientId, req.user.id);
    if (!emp && !isAdminUser(db, req.user.id)) return fail(res, 403, "FORBIDDEN", "只限企業管理員");

    const month = b2b.hktMonthKey();
    const employees = db.prepare("SELECT COUNT(*) c FROM corporate_employees WHERE corporate_id=? AND status='verified'").get(clientId).c;
    const active = db.prepare(
      `SELECT COUNT(DISTINCT b.user_id) c FROM bookings b JOIN corporate_employees e ON e.user_id=b.user_id
        WHERE e.corporate_id=? AND b.corporate_id=? AND b.status IN ('confirmed','attended') AND strftime('%Y-%m', b.created_at)=?`,
    ).get(clientId, clientId, month).c;
    const spend = db.prepare(
      `SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM bookings WHERE corporate_id=? AND status IN ('confirmed','attended') AND strftime('%Y-%m', created_at)=?`,
    ).get(clientId, month);
    const top = db.prepare(
      `SELECT c.category, COUNT(*) n FROM bookings b JOIN classes c ON c.id=b.class_id
        WHERE b.corporate_id=? AND strftime('%Y-%m', b.created_at)=? GROUP BY c.category ORDER BY n DESC LIMIT 5`,
    ).all(clientId, month);

    res.json({
      success: true,
      month,
      corporate: { id: client.id, name: client.company_name, tier: client.contract_tier, status: client.status },
      pool_cents: Number(client.credit_pool_cents || 0),
      employees,
      active_employees: active,
      active_rate: employees ? Math.round((active / employees) * 1000) / 10 : 0,
      month_spend_cents: Number(spend.s || 0),
      month_bookings: Number(spend.n || 0),
      top_categories: top,
    });
  } catch (e) {
    console.error("[B2B] dashboard:", e.message);
    fail(res, 500, "SERVER_ERROR", "讀取企業看板失敗");
  }
});

// ===== 6. 統一發票 =====
router.get("/b2b/invoice", authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    const month = String(req.query.month || b2b.hktMonthKey());
    if (!/^\d{4}-\d{2}$/.test(month)) return fail(res, 400, "MONTH_INVALID", "月份格式 YYYY-MM");
    let clientId = String(req.query.corporate_id || "");
    if (!clientId) {
      const emp = db.prepare("SELECT corporate_id FROM corporate_employees WHERE user_id=? AND status='verified' LIMIT 1").get(req.user.id);
      clientId = emp?.corporate_id || "";
    }
    const client = clientId ? db.prepare("SELECT * FROM corporate_clients WHERE id=?").get(clientId) : null;
    if (!client) return fail(res, 404, "CORPORATE_NOT_FOUND", "找不到企業帳戶");
    const emp = db.prepare("SELECT id FROM corporate_employees WHERE corporate_id=? AND user_id=?").get(clientId, req.user.id);
    if (!emp && !isAdminUser(db, req.user.id)) return fail(res, 403, "FORBIDDEN", "只限企業管理員");

    const rows = db.prepare(
      `SELECT b.booking_reference, b.created_at, b.amount_cents, c.title, u.name
         FROM bookings b LEFT JOIN classes c ON c.id=b.class_id LEFT JOIN users u ON u.id=b.user_id
        WHERE b.corporate_id=? AND b.status IN ('confirmed','attended') AND strftime('%Y-%m', b.created_at)=?
        ORDER BY b.created_at ASC`,
    ).all(clientId, month);
    const total = rows.reduce((s, r) => s + Number(r.amount_cents || 0), 0);
    const invoiceNo = `ZP-CORP-${month.replace("-", "")}-${clientId.slice(0, 6).toUpperCase()}`;
    const fmt = String(req.query.format || "html").toLowerCase();

    if (fmt === "csv") {
      const cell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const out = ["\uFEFF" + ["發票編號", "日期", "員工", "課程", "金額(HKD)", "訂單編號"].map(cell).join(",")]
        .concat(rows.map((r) => [invoiceNo, String(r.created_at).slice(0, 10), r.name || "", r.title || "", (Number(r.amount_cents) / 100).toFixed(2), r.booking_reference].map(cell).join(",")))
        .concat([["合計", "", "", "", (total / 100).toFixed(2), ""].map(cell).join(",")])
        .join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="invoice-${month}.csv"`);
      return res.send(out);
    }

    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const html = `<!doctype html><html lang="zh-HK"><head><meta charset="utf-8"><title>${esc(invoiceNo)}</title>
      <style>body{font-family:'Noto Sans TC',system-ui,sans-serif;padding:36px;color:#0f172a}h1{color:#0f766e;font-size:22px}
      table{width:100%;border-collapse:collapse;margin-top:18px;font-size:13px}th,td{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left}
      th{background:#f8fafc}.total{font-weight:700;font-size:16px;text-align:right;margin-top:18px}.muted{color:#64748b;font-size:12px}</style></head><body>
      <h1>ZenPass 禪流 · 企業健康福利發票</h1>
      <div class="muted">發票編號：${esc(invoiceNo)} · 月份：${esc(month)} · 狀態：已付款（預付款池扣減）</div>
      <p><b>客戶：</b>${esc(client.company_name)}<br><b>商業登記：</b>${esc(client.business_reg_no || "-")}<br><b>帳單聯絡：</b>${esc(client.billing_contact_name || "-")} ${esc(client.billing_email || "")}</p>
      <table><thead><tr><th>日期</th><th>員工</th><th>課程</th><th>訂單編號</th><th>金額 (HKD)</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(String(r.created_at).slice(0, 10))}</td><td>${esc(r.name || "")}</td><td>${esc(r.title || "")}</td><td>${esc(r.booking_reference)}</td><td>${(Number(r.amount_cents) / 100).toFixed(2)}</td></tr>`).join("")}
      </tbody></table><div class="total">合計：HK$ ${(total / 100).toFixed(2)}（${rows.length} 堂）</div>
      <p class="muted">此發票由 ZenPass 系統自動生成，對應企業預付款池扣減，不另收費。</p></body></html>`;

    if (fmt === "pdf") {
      const tmp = path.join(os.tmpdir(), `zp-invoice-${Date.now()}.html`);
      const pdf = tmp.replace(/\.html$/, ".pdf");
      fs.writeFileSync(tmp, html, "utf8");
      const bins = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
      const bin = bins.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
      if (!bin) { try { fs.unlinkSync(tmp); } catch (e) {} return fail(res, 501, "PDF_UNAVAILABLE", "伺服器未安裝 PDF 引擎，請用 HTML 或 CSV"); }
      try {
        await execFileAsync(bin, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, `file://${tmp}`], { timeout: 25000, maxBuffer: 4 * 1024 * 1024 });
        const buf = fs.readFileSync(pdf);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="invoice-${month}.pdf"`);
        return res.send(buf);
      } finally {
        try { fs.unlinkSync(tmp); } catch (e) {}
        try { fs.unlinkSync(pdf); } catch (e) {}
      }
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) {
    console.error("[B2B] invoice:", e.message);
    fail(res, 500, "SERVER_ERROR", "生成發票失敗");
  }
});

// ===== 7. Admin：企業客戶 =====
router.get("/admin/corporate/clients", authenticateToken, requirePermission("finance.view"), (req, res) => {
  const db = getDb();
  b2b.ensureSchema(db);
  const rows = db.prepare("SELECT * FROM corporate_clients ORDER BY created_at DESC LIMIT 200").all();
  res.json({ success: true, clients: rows.map((c) => ({ ...c, allowed_email_domains: b2b.parseDomains(c) })) });
});

router.post("/admin/corporate/clients", authenticateToken, requirePermission("finance.pricing.write"), (req, res) => {
  try {
    const db = getDb();
    b2b.ensureSchema(db);
    const b = req.body || {};
    const name = String(b.company_name || "").trim();
    const domains = Array.isArray(b.allowed_email_domains) ? b.allowed_email_domains : String(b.allowed_email_domains || "").split(",");
    const clean = [...new Set(domains.map((d) => String(d).trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];
    if (name.length < 2) return fail(res, 400, "COMPANY_NAME_REQUIRED", "請填公司名稱");
    if (!clean.length) return fail(res, 400, "DOMAINS_REQUIRED", "請填至少一個工作電郵域名");
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO corporate_clients (id, company_name, business_reg_no, allowed_email_domains, billing_contact_name, billing_email, contract_tier, discount_percent, monthly_quota_units, credit_pool_cents, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, name, String(b.business_reg_no || ""), JSON.stringify(clean), String(b.billing_contact_name || ""), String(b.billing_email || ""),
      String(b.contract_tier || "gold_discount_10"), Number(b.discount_percent ?? 10), Number(b.monthly_quota_units ?? 4), Math.round(Number(b.credit_pool_cents ?? 0)), String(b.status || "active"));
    audit({ actionType: "corporate.client_created", entityType: "corporate_client", entityId: id, userId: req.user.id, newValues: { name, domains: clean }, description: "建立企業客戶" });
    res.status(201).json({ success: true, id, company_name: name, allowed_email_domains: clean });
  } catch (e) {
    console.error("[B2B] create client:", e.message);
    fail(res, 500, "SERVER_ERROR", "建立企業客戶失敗");
  }
});

router.post("/admin/corporate/clients/:id/topup", authenticateToken, requirePermission("finance.payout.process"), (req, res) => {
  try {
    const db = getDb();
    b2b.ensureSchema(db);
    const cents = Math.round(Number(req.body?.amount_cents || 0));
    if (!Number.isInteger(cents) || cents <= 0) return fail(res, 400, "AMOUNT_INVALID", "充值金額必須為正整數 cents");
    const client = db.prepare("SELECT * FROM corporate_clients WHERE id=?").get(req.params.id);
    if (!client) return fail(res, 404, "CORPORATE_NOT_FOUND", "企業不存在");
    db.prepare("UPDATE corporate_clients SET credit_pool_cents=credit_pool_cents+?, updated_at=datetime('now') WHERE id=?").run(cents, client.id);
    audit({ actionType: "corporate.pool_topup", entityType: "corporate_client", entityId: client.id, userId: req.user.id, newValues: { amount_cents: cents, before: client.credit_pool_cents }, description: "企業預付款充值" });
    res.json({ success: true, pool_cents: Number(client.credit_pool_cents || 0) + cents });
  } catch (e) {
    fail(res, 500, "SERVER_ERROR", "充值失敗");
  }
});

module.exports = router;
