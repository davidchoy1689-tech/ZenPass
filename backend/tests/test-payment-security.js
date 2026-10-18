/** ZenPass — 付款安全（禁止自行確認）tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
process.env.NOTIFICATION_TYPES = "db";
const tmp = path.join(os.tmpdir(), "zenpass-paysec-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email) VALUES ('u1','阿甲','u1@x.com')").run();
  pre.prepare("INSERT INTO users (id,name,email,role) VALUES ('admin1','Admin','a@x.com','admin')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { completePayment } = require("../src/services/booking-service");

  console.log("🧪 付款安全 tests");

  const res = completePayment({
    params: { id: "b1" },
    user: { id: "u1" },
    body: { payment_method: "fps", payment_reference: "FAKE123", amount: 150 },
  });
  ok(res.status === 403, "自行提交 FPS 編號 → 403");
  ok(res.body.code === "MANUAL_PAYMENT_REVIEW_REQUIRED", "回傳正確錯誤碼");
  ok(/管理員核實/.test(res.body.error), "提示需要管理員核實");
  ok(db.prepare("SELECT 1 FROM bookings WHERE id='b1'").get() === undefined, "冇建立／確認任何 booking");

  const { sendNotification } = require("../src/services/notification");
  await sendNotification("payment.new_fps_payme", {
    recipient: "admin1",
    data: { user_name: "阿甲", amount: 150, method: "FPS", reference: "FAKE123", class_title: "瑜伽", submitted_at: "2026-10-19 00:30" },
  });
  const n = db.prepare("SELECT * FROM notifications WHERE user_id='admin1' AND type='payment.new_fps_payme'").get();
  ok(!!n && /150/.test(n.message) && /FAKE123/.test(n.message), "admin 站內收到付款待確認（金額 + 參考）");

  console.log("── 接線 ──");
  const paySrc = fs.readFileSync(path.join(__dirname, "../src/routes/payments.js"), "utf8");
  const bookingSrc = fs.readFileSync(path.join(__dirname, "../src/services/booking-service.js"), "utf8");
  ok((paySrc.match(/notifyAdminsOfManualPayment\(/g) || []).length >= 3, "FPS + PayMe 都有站內通知（含 helper 定義）");
  ok(/MANUAL_PAYMENT_REVIEW_REQUIRED/.test(bookingSrc), "service 已封鎖自動確認");
  ok(/fps_reference IS NULL AND payme_reference IS NULL/.test(bookingSrc), "15 分鐘 hold 唔會取消已提交 FPS/PayMe 嘅 booking");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
