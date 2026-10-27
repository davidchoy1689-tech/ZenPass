/**
 * ZenPass — 人手審查取消課堂（兩段式防呆）tests
 * node backend/tests/test-manual-cancel.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test-secret-manual-cancel-0123456789abcdef";
const tmp = path.join(os.tmpdir(), "zenpass-mcancel-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log("  ✅ " + m); pass++; } else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT, status TEXT DEFAULT 'active');
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  for (const [id, role] of [["admin","admin"],["coach","coach"],["u1","user"],["u2","user"],["u3","user"]]) {
    pre.prepare("INSERT INTO users (id,name,email,phone,role) VALUES (?,?,?,?,?)").run(id, id, id + "@x.hk", "9123456" + id.length, role);
  }
  pre.close();

  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  const start = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 19).replace("T", " ");
  const end = new Date(Date.now() + 3 * 864e5 + 7200e3).toISOString().slice(0, 19).replace("T", " ");
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,venue_name) VALUES ('c1','coach','芬蘭木柱體驗班','新興運動',120,150,'active','牛頭角體育館')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',?,?,10,3,'available')").run(start, end);
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s2','c1',?,?,10,1,'cancelled')").run(start, end);
  const ins = db.prepare(
    `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  ins.run("b1", "ZP-MC1", "u1", "s1", "c1", "confirmed", "paid", 150);
  ins.run("b2", "ZP-MC2", "u2", "s1", "c1", "confirmed", "paid", 150);
  ins.run("b3", "ZP-MC3", "u3", "s1", "c1", "confirmed", "pending", 150);
  ins.run("b4", "ZP-MC4", "u1", "s1", "c1", "cancelled", "paid", 150);

  const ops = require("../src/routes/admin-ops");
  const layer = ops.stack.find((l) => l.route && l.route.path === "/schedules/:id/manual-cancel" && l.route.methods.post);
  const fn = layer.route.stack[layer.route.stack.length - 1].handle;
  const call = (params, body, user) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    return Promise.resolve(fn({ params, body: body || {}, user }, res)).then(() => res);
  };

  console.log("\n🧪 人手取消課堂（兩段式防呆）\n");

  console.log("📋 1. 前置驗證");
  const a1 = await call({ id: "s1" }, { reason: "", notify_type: "weather", confirmed: true }, { id: "admin", role: "admin" });
  ok(a1.statusCode === 400 && a1.body.code === "REASON_REQUIRED", "冇原因 → 400");
  const a2 = await call({ id: "s1" }, { reason: "黑雨停課", notify_type: "weather" }, { id: "admin", role: "admin" });
  ok(a2.statusCode === 400 && a2.body.code === "CONFIRM_REQUIRED", "未勾確認 → 400（防手滑）");
  const a3 = await call({ id: "s2" }, { reason: "黑雨停課", notify_type: "weather", confirmed: true }, { id: "admin", role: "admin" });
  ok(a3.statusCode === 409, "已取消課堂 → 409");
  const a4 = await call({ id: "nope" }, { reason: "黑雨停課", confirmed: true }, { id: "admin", role: "admin" });
  ok(a4.statusCode === 404, "不存在時段 → 404");

  console.log("📋 2. 執行取消");
  const r = await call({ id: "s1" }, { reason: "黑色暴雨，場地關閉", notify_type: "weather", confirmed: true }, { id: "admin", role: "admin" });
  ok(r.statusCode === 200, "取消成功（HTTP 200）");
  const sch = db.prepare("SELECT * FROM class_schedules WHERE id='s1'").get();
  ok(sch.status === "cancelled", "schedule 已轉 cancelled");
  ok(String(sch.cancel_reason || "").includes("黑色暴雨"), "已記錄取消原因");
  ok(!!sch.cancelled_at && sch.cancelled_by === "admin", "已記錄時間與操作人");

  const b1 = db.prepare("SELECT * FROM bookings WHERE id='b1'").get();
  const b3 = db.prepare("SELECT * FROM bookings WHERE id='b3'").get();
  const b4 = db.prepare("SELECT * FROM bookings WHERE id='b4'").get();
  ok(b1.status === "cancelled", "已付款 booking 轉 cancelled");
  ok(b1.payment_status === "paid", "保留原付款紀錄（payment_status 仍 paid）");
  ok(String(b1.cancel_reason || "").includes("黑色暴雨"), "booking 帶取消原因");
  ok(b3.status === "cancelled" && b3.payment_status === "pending", "未付款 booking 亦取消但保留 pending");
  ok(b4.status === "cancelled", "原本已取消的不受影響");

  console.log("📋 3. 回傳內容（通知用）");
  ok(r.body.paid_count === 2, "已付款人數 = 2（got " + r.body.paid_count + "）");
  ok(Number(r.body.paid_amount) === 300, "涉款 = HK$300（got " + r.body.paid_amount + "）");
  ok(r.body.affected === 3, "受影響 booking = 3（不含原本已取消）");
  ok((r.body.students || []).length === 3, "回傳學員名單");
  ok(/ZenPass 課堂取消通知/.test(r.body.whatsapp_text || ""), "WhatsApp 文案已預填");
  ok(/我的預約/.test(r.body.whatsapp_text || ""), "文案含退款登記引導");
  ok(/150/.test(r.body.whatsapp_text || "") || /300/.test(r.body.whatsapp_text || ""), "文案含金額");

  console.log("📋 4. 退款入口（學員端資料）");
  const myRow = db.prepare("SELECT * FROM bookings WHERE id='b1'").get();
  ok(myRow.status === "cancelled" && myRow.payment_status === "paid", "學員端會顯示退款卡（cancelled + paid）");

  console.log("📋 5. 審計與權限");
  const audit = db.prepare("SELECT * FROM audit_log WHERE action_type='schedule.manual_cancel'").get();
  ok(!!audit && /人手取消/.test(audit.description || ""), "已寫入 audit_log");
  const opsSrc = fs.readFileSync(path.join(__dirname, "../src/routes/admin-ops.js"), "utf8");
  ok(/manual-cancel"[\s\S]{0,200}requireAdmin/.test(opsSrc) && /requireOpsRole/.test(opsSrc), "API 有 admin + ops 權限閘門");
  ok(/schedule\.manual_cancel/.test(opsSrc), "審計 action 固定");
  const uiSrc = fs.readFileSync(path.join(__dirname, "../../frontend-v2/admin-ops.html"), "utf8");
  ok(/openCancelWizard/.test(uiSrc) && /manual-cancel/.test(uiSrc), "後台有取消精靈");
  ok(/cwConfirm/.test(uiSrc), "有防手滑確認勾選");

  console.log("\n📊 結果: " + pass + " ✅ 通過, " + fail + " ❌ 失敗\n");
  try { fs.unlinkSync(tmp); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
