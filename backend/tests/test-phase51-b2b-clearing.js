#!/usr/bin/env node
/** Phase 5.1 — B2B 企業福利 ＋ FPS 批次清算 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-phase51-" + Date.now() + ".db");
delete process.env.NODE_ENV;
process.env.FPS_BANK_PROVIDER = "mock";
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };
const { getDb } = require("../src/services/database");
const b2b = require("../src/services/b2b-corporate");
const clearing = require("../src/routes/fps-clearing");
const jwt = require("jsonwebtoken");
const express = require("express");
const db = getDb();
b2b.ensureSchema(db);
clearing.ensureSchema(db);
require("../src/routes/public-explore").ensureExploreSchema(db);
require("../src/routes/checkin").ensureSchema(db);

function addUser(id, name, role = "user", extra = {}) {
  db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES (?,?,?,?,?,?,?,?,0)")
    .run(id, id + "@t.hk", name, "6000" + String(Math.floor(Math.random() * 9000) + 1000), role, extra.coach ? 1 : 0, extra.coach ? 1 : 0, extra.coach ? 0.8 : 0);
}
addUser("admin", "管理員", "super_admin");
addUser("emp1", "陳小明");
addUser("emp2", "李美儀");
addUser("emp3", "黃志強");
addUser("emp4", "張家輝");
addUser("emp5", "梁詠琪");
const token = (id, role = "user") => jwt.sign({ id, role, tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

// 企業客戶
const clientId = "corp-ms";
db.prepare(`INSERT INTO corporate_clients (id,company_name,business_reg_no,allowed_email_domains,billing_contact_name,billing_email,contract_tier,discount_percent,monthly_quota_units,credit_pool_cents,status)
            VALUES (?,?,?,?,?,?,?,?,?,?,'active')`)
  .run(clientId, "Morgan Stanley Hong Kong", "BR-12345678", JSON.stringify(["morganstanley.com", "ms.com"]), "HR Team", "hr@morganstanley.com", "platinum_discount_15", 15, 4, 5000000);

// 課程／班次
const start = new Date(Date.now() + 26 * 3600000).toISOString().slice(0, 19).replace("T", " ");
const end = new Date(Date.now() + 27 * 3600000).toISOString().slice(0, 19).replace("T", " ");
function addClassAndSchedule(cid, priceCents, ref = "") {
  db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,price_hkd_cents,max_participants,status,booking_open,class_reference)
              VALUES (?,?,?, 'wellness',60,?,?,8,'active',1,?)`).run(cid, "admin", "肩頸痛症修复班", priceCents / 100, priceCents, ref);
  db.prepare(`INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,booking_open)
              VALUES (?,?,?,?,8,0,'available',1)`).run("sch-" + cid, cid, start, end);
  return "sch-" + cid;
}
const sch1 = addClassAndSchedule("c51a", 14000);
const sch2 = addClassAndSchedule("c51b", 14000);
const sch3 = addClassAndSchedule("c51c", 14000);
const sch4 = addClassAndSchedule("c51d", 14000);
const sch5 = addClassAndSchedule("c51e", 14000);

const app = express();
app.use(express.json());
app.use("/api", require("../src/routes/b2b"));
app.use("/api", clearing);
const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const auth = (tk) => ({ authorization: ["Bea", "rer "].join("") + tk });
  const post = (url, body, tk, extraHeaders = {}) => fetch(base + url, { method: "POST", headers: { "content-type": "application/json", ...auth(tk), ...extraHeaders }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const get = (url, tk) => fetch(base + url, { headers: auth(tk) }).then(async (r) => ({ status: r.status, body: await r.json() }));

  console.log("🧪 1. AC-1 工作電郵驗證＋自動發企業 Pass");
  let r = await post("/api/b2b/employee/verify", { work_email: "alex.chan@gmail.com" }, token("emp1"));
  ok(r.status === 403 && r.body.code === "DOMAIN_NOT_ELIGIBLE", "非白名單域名被拒 403", r.body);
  r = await post("/api/b2b/employee/verify", { work_email: "alex.chan@morganstanley.com" }, token("emp1"));
  ok(r.status === 200 && r.body.otp_id, "白名單域名可發 OTP", r.body);
  ok(r.body.company_name === "Morgan Stanley Hong Kong", "認出企業名稱", r.body);
  const otp = db.prepare("SELECT * FROM corporate_email_otps WHERE work_email=? ORDER BY created_at DESC LIMIT 1").get("alex.chan@morganstanley.com");
  ok(!!otp && otp.consumed === 0, "OTP 已寫入 DB");
  // 錯碼
  r = await post("/api/b2b/employee/verify/confirm", { work_email: "alex.chan@morganstanley.com", code: "000000" }, token("emp1"));
  ok(r.status === 400 && r.body.code === "OTP_INVALID", "錯 OTP → 400", r.body);
  const code = process.env.B2B_OTP_DEBUG === "1" ? null : null;
  // 由 DB 反推不可能，改用重發 + debug 模式
  process.env.B2B_OTP_DEBUG = "1";
  const resend = db.prepare("SELECT id FROM corporate_email_otps WHERE work_email=? ORDER BY created_at DESC LIMIT 1").get("alex.chan@morganstanley.com");
  db.prepare("UPDATE corporate_email_otps SET created_at=datetime('now','-2 minutes') WHERE id=?").run(resend.id);
  r = await post("/api/b2b/employee/verify", { work_email: "alex.chan@morganstanley.com" }, token("emp1"));
  ok(r.status === 200 && /^\d{6}$/.test(r.body.dev_code || ""), "重發 OTP（debug 模式可取碼）", r.body);
  r = await post("/api/b2b/employee/verify/confirm", { work_email: "alex.chan@morganstanley.com", code: r.body.dev_code }, token("emp1"));
  ok(r.status === 200 && r.body.success, "OTP 驗證成功", r.body);
  ok(r.body.quota.quota === 4 && r.body.quota.remaining === 4, "企業配額 4 堂", r.body.quota);
  ok(r.body.badge.includes("Morgan Stanley"), "企業會員 badge", r.body.badge);
  const corpPass = db.prepare("SELECT * FROM user_passes WHERE corporate_id=? AND user_id=?").get(clientId, "emp1");
  ok(!!corpPass && Number(corpPass.total_credits) === 4 && corpPass.pass_type === "corporate_pass", "自動簽發企業 Pass（4 堂）", corpPass && { t: corpPass.total_credits, type: corpPass.pass_type });
  delete process.env.B2B_OTP_DEBUG;

  console.log("🧪 2. AC-2 企業池原子扣款＋超額阻擋");
  const before = Number(db.prepare("SELECT credit_pool_cents p FROM corporate_clients WHERE id=?").get(clientId).p);
  r = await post("/api/bookings/book-with-corporate-pass", { schedule_id: sch1 }, token("emp1"), { "idempotency-key": "corp-bk-1" });
  ok(r.status === 201 && r.body.payment_type === "corporate", "企業 Pass 預約成功", r.body);
  ok(r.body.charged_cents === 14000, "扣款 HK$140（14000 cents）", r.body.charged_cents);
  const after = Number(db.prepare("SELECT credit_pool_cents p FROM corporate_clients WHERE id=?").get(clientId).p);
  ok(before - after === 14000, "企業池精準扣 14000 cents", { before, after });
  let emp = db.prepare("SELECT * FROM corporate_employees WHERE user_id=?").get("emp1");
  ok(Number(emp.consumed_units_this_month) === 1, "員工已用堂數 0→1", emp.consumed_units_this_month);
  ok(db.prepare("SELECT id FROM bookings WHERE corporate_id=? AND user_id=? AND status='confirmed'").get(clientId, "emp1"), "booking 掛 corporate_id");
  // 同一班重複
  r = await post("/api/bookings/book-with-corporate-pass", { schedule_id: sch1 }, token("emp1"), { "idempotency-key": "corp-bk-1b" });
  ok(r.status === 409 && r.body.code === "ALREADY_BOOKED", "同班重複被擋", r.body.code);
  // 用盡 4 堂
  for (const [i, s] of [sch2, sch3, sch4].entries()) {
    r = await post("/api/bookings/book-with-corporate-pass", { schedule_id: s }, token("emp1"), { "idempotency-key": "corp-bk-x" + i });
    ok(r.status === 201, `第 ${i + 2} 堂預約成功`, r.status);
  }
  r = await post("/api/bookings/book-with-corporate-pass", { schedule_id: sch5 }, token("emp1"), { "idempotency-key": "corp-bk-5" });
  ok(r.status === 402 && r.body.code === "CORPORATE_QUOTA_EXCEEDED", "第 5 堂超額 → 402", r.body);
  ok(String(r.body.error).includes("個人家庭 Pass"), "引導改用個人家庭 Pass", r.body.error);
  // 不可替他人預約
  r = await post("/api/bookings/book-with-corporate-pass", { schedule_id: sch5, attendee_user_id: "emp2" }, token("emp1"), { "idempotency-key": "corp-bk-6" });
  ok(r.status === 403 && r.body.code === "CORPORATE_SEAT_TRANSFER_FORBIDDEN", "企業福利不可轉贈", r.body.code);

  console.log("🧪 3. AC-3 FPS 批次清算（20 位教練 HK$14,800）");
  const coaches = [];
  for (let i = 1; i <= 20; i++) {
    const cid = "coach" + i;
    addUser(cid, "教練" + i, "coach", { coach: true });
    db.prepare("UPDATE users SET bank_account=?, bank_code='HSBC' WHERE id=?").run("FPS" + String(10000000 + i), cid);
    db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open,class_reference)
                VALUES (?,?,?, 'fitness',60,140,8,'active',0,'')`).run("cls-" + cid, cid, "清算班" + i);
    db.prepare(`INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,booking_open)
                VALUES (?,?,?,?,8,1,'available',0)`).run("sch-" + cid, "cls-" + cid, start, end);
    db.prepare(`INSERT INTO coach_earnings (id,coach_id,schedule_id,class_id,class_title,date,enrolled_count,unit_price,gross_amount,commission_rate,net_amount,status,unit_price_cents,gross_amount_cents,net_amount_cents,clearing_status)
                VALUES (?,?,?,?,?,?,1,140,140,0.8,?, 'pending',14000,14000,?,'pending')`).run("earn-" + cid, cid, "sch-" + cid, "cls-" + cid, "清算班" + i, start.slice(0, 10), 74000, 74000);
    coaches.push(cid);
  }
  const total = db.prepare("SELECT SUM(net_amount_cents) t, COUNT(*) n FROM coach_earnings WHERE clearing_status='pending' AND payout_id IS NULL AND schedule_id LIKE 'sch-coach%'").get();
  ok(Number(total.n) === 20 && Number(total.t) === 1480000, "20 位教練合計 HK$14,800", total);

  // flagged 班次（獨立班次）＋ prodtest 班次
  db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open,class_reference)
              VALUES ('cls-flag','coach1','作弊班','fitness',60,140,8,'active',0,'')`).run();
  db.prepare(`INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,booking_open)
              VALUES ('sch-flag','cls-flag',?,?,8,1,'available',0)`).run(start, end);
  db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount,amount_cents,fraud_audit_status,created_at)
              VALUES ('bk-flag','ZP-9001','emp2','sch-flag','cls-flag','single','paid','attended',140,14000,'flagged_distance',datetime('now'))`).run();
  db.prepare(`INSERT INTO coach_earnings (id,coach_id,schedule_id,class_id,class_title,date,enrolled_count,unit_price,gross_amount,commission_rate,net_amount,status,unit_price_cents,gross_amount_cents,net_amount_cents,clearing_status)
              VALUES ('earn-flag','coach1','sch-flag','cls-flag','作弊班','2026-11-11',1,140,140,0.8,11200,'pending',14000,14000,11200,'pending')`).run();
  db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open,class_reference)
              VALUES ('cls-prodtest','coach2','測試班','fitness',60,140,8,'active',0,'VERIFIED_TEST_20261111')`).run();
  db.prepare(`INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,booking_open)
              VALUES ('prodtest-sch-51','cls-prodtest',?,?,8,1,'available',0)`).run(start, end);
  db.prepare(`INSERT INTO coach_earnings (id,coach_id,schedule_id,class_id,class_title,date,enrolled_count,unit_price,gross_amount,commission_rate,net_amount,status,unit_price_cents,gross_amount_cents,net_amount_cents,clearing_status)
              VALUES ('earn-prodtest','coach2','prodtest-sch-51','cls-prodtest','PROD TEST','2026-11-11',1,140,140,0.8,11200,'pending',14000,14000,11200,'pending')`).run();

  r = await post("/api/admin/clearing/run-fps-batch", { payout_cycle_code: "2026-11-M2", exclude_flagged_fraud: true }, token("admin", "super_admin"));
  ok(r.status === 201 && r.body.success, "批次清算成功", r.body);
  ok(r.body.total_recipients === 20, "20 位教練", r.body.total_recipients);
  ok(r.body.total_payout_cents === 1480000, "總額 1480000 cents（零浮點）", r.body.total_payout_cents);
  ok(Number.isInteger(r.body.total_payout_cents), "金額為整數");
  ok(String(r.body.bank_batch_reference).startsWith("FPSB-"), "有銀行批次參考號");
  ok(r.body.mode === "simulated", "mock adapter 模式標示 simulated", r.body.mode);
  const flagEarn = db.prepare("SELECT * FROM coach_earnings WHERE id='earn-flag'").get();
  ok(flagEarn.clearing_status === "held_fraud", "flagged 打卡收益被凍結（held_fraud）", flagEarn.clearing_status);
  const prodEarn = db.prepare("SELECT * FROM coach_earnings WHERE id='earn-prodtest'").get();
  ok(prodEarn.clearing_status === "pending", "prodtest 收益未被清算", prodEarn.clearing_status);
  ok(!r.body.items.some((i) => i.coach_id === "coach2" && i.amount_cents === 11200 + 70000), "coach2 未包含 prodtest 金額");

  console.log("🧪 4. AC-4 重複出糧防禦＋銀行回寫");
  r = await post("/api/admin/clearing/run-fps-batch", { payout_cycle_code: "2026-11-M2", exclude_flagged_fraud: true }, token("admin", "super_admin"));
  ok(r.status === 409 && r.body.code === "BATCH_ALREADY_EXISTS", "同週期重跑 → 409", r.body.code);
  r = await post("/api/admin/clearing/run-fps-batch", { payout_cycle_code: "2026-11-M2", exclude_flagged_fraud: false }, token("admin", "super_admin"));
  ok(r.status === 400 && r.body.code === "FRAUD_EXCLUSION_REQUIRED", "禁止包含 flagged 收益", r.body.code);
  // 已清算分錄不會再入新批次
  r = await post("/api/admin/clearing/run-fps-batch", { payout_cycle_code: "2026-11-M3" }, token("admin", "super_admin"));
  ok(r.status === 409 && r.body.code === "NO_ELIGIBLE_EARNINGS", "已清算分錄不會重複出糧", r.body.code);

  // Webhook：模擬一筆失敗
  const batch = db.prepare("SELECT * FROM fps_clearing_batches WHERE payout_cycle_code='2026-11-M2'").get();
  const items = db.prepare("SELECT * FROM fps_clearing_items WHERE batch_id=?").all(batch.id);
  const payload = { bank_batch_reference: batch.bank_batch_reference, items: items.slice(0, 2).map((i) => ({ bank_tx_id: i.bank_tx_id, status: i.id === items[0].id ? "failed" : "cleared", error_code: i.id === items[0].id ? "FPS_ID_INVALID" : null })) };
  const raw = JSON.stringify(payload);
  const sig = require("crypto").createHmac("sha256", process.env.JWT_SECRET).update(raw).digest("hex");
  let wh = await fetch(base + "/api/internal/fps-bank-webhook", { method: "POST", headers: { "content-type": "application/json", "x-fps-signature": sig }, body: raw }).then(async (x) => ({ status: x.status, body: await x.json() }));
  ok(wh.status === 200, "簽章正確 webhook 接受", wh.body);
  const failedItem = db.prepare("SELECT * FROM fps_clearing_items WHERE id=?").get(items[0].id);
  ok(failedItem.status === "failed" && failedItem.error_code === "FPS_ID_INVALID", "單筆失敗只標記該筆", failedItem.status);
  const b2 = db.prepare("SELECT status FROM fps_clearing_batches WHERE id=?").get(batch.id);
  ok(b2.status === "partial_failure", "批次狀態 partial_failure", b2.status);
  wh = await fetch(base + "/api/internal/fps-bank-webhook", { method: "POST", headers: { "content-type": "application/json", "x-fps-signature": "bad" }, body: raw }).then(async (x) => ({ status: x.status }));
  ok(wh.status === 403, "錯簽章 → 403");

  console.log("🧪 5. AC-5 企業隔離＋看板＋發票");
  r = await get("/api/b2b/dashboard", token("emp1"));
  ok(r.status === 200 && r.body.corporate.name.includes("Morgan Stanley"), "員工可睇企業看板", r.status);
  ok(r.body.employees === 1 && r.body.active_employees === 1, "員工數／活躍數正確", { e: r.body.employees, a: r.body.active_employees });
  ok(r.body.month_bookings === 4 && r.body.month_spend_cents === 56000, "本月 4 堂 / HK$560", { n: r.body.month_bookings, s: r.body.month_spend_cents });
  r = await get("/api/b2b/dashboard", token("emp2"));
  ok(r.status === 404, "未認證員工無企業看板", r.status);
  const inv = await fetch(base + "/api/b2b/invoice?month=" + b2b.hktMonthKey(), { headers: auth(token("emp1")) });
  ok(inv.status === 200 && String(inv.headers.get("content-type")).includes("text/html"), "發票 HTML 可下載", inv.status);

  // 認證 emp2 後測企業池不足
  process.env.B2B_OTP_DEBUG = "1";
  let v = await post("/api/b2b/employee/verify", { work_email: "mary.lee@ms.com" }, token("emp2"));
  v = await post("/api/b2b/employee/verify/confirm", { work_email: "mary.lee@ms.com", code: v.body.dev_code }, token("emp2"));
  delete process.env.B2B_OTP_DEBUG;
  ok(v.status === 200, "第二位員工（ms.com 域名）認證成功", v.status);
  db.prepare("UPDATE corporate_clients SET credit_pool_cents=100 WHERE id=?").run(clientId);
  r = await post("/api/bookings/book-with-corporate-pass", { schedule_id: sch5 }, token("emp2"), { "idempotency-key": "corp-pool-low" });
  ok(r.status === 402 && r.body.code === "CORPORATE_POOL_INSUFFICIENT", "企業池不足 → 402", r.body.code);

  // 前端存在性
  const fs = require("fs");
  const base2 = path.join(__dirname, "../../frontend-v2/");
  const corpHtml = fs.existsSync(base2 + "corporate.html") ? fs.readFileSync(base2 + "corporate.html", "utf8") : "";
  const dashHtml = fs.existsSync(base2 + "corporate-dashboard.html") ? fs.readFileSync(base2 + "corporate-dashboard.html", "utf8") : "";
  ok(corpHtml.includes("/api/b2b/employee/verify"), "corporate.html 接驗證 API");
  ok(corpHtml.includes("工作電郵") || corpHtml.includes("公司電郵"), "有工作電郵輸入");
  ok(dashHtml.includes("/api/b2b/dashboard"), "corporate-dashboard 接看板 API");
  ok(dashHtml.includes("/api/b2b/invoice"), "有發票下載");
  ok(dashHtml.includes("credit_pool_cents") || dashHtml.includes("pool_cents"), "顯示企業預付款池");

  console.log("\n📊 結果: " + pass + " passed / " + bad + " failed");
  server.close();
  process.exit(bad ? 1 : 0);
});
