/** ZenPass — 通知模板覆蓋 + recipient 接線 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
process.env.NOTIFICATION_TYPES = "db";
const tmp = path.join(os.tmpdir(), "zenpass-notiftpl-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (!["node_modules", "logs", "data", "tests"].includes(f)) walk(p, out);
    } else if (f.endsWith(".js")) out.push(p);
  }
  return out;
}

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
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const root = path.join(__dirname, "..", "src");
  const files = walk(root);
  const used = new Set();
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/sendNotification\("([^"]+)"/g)) used.add(m[1]);
  }
  const notifSrc = fs.readFileSync(path.join(root, "services/notification.js"), "utf8");
  const tpl = new Set([...notifSrc.matchAll(/case "([^"]+)":/g)].map((m) => m[1]));
  const missing = [...used].filter((t) => !tpl.has(t));

  console.log("🧪 通知模板覆蓋 tests");
  ok(used.size >= 30, `掃到 ${used.size} 種通知`);
  ok(missing.length === 0, missing.length ? `缺模板：${missing.join(", ")}` : "所有使用中嘅通知都有模板");

  const { sendNotification } = require("../src/services/notification");
  const db = require("../src/services/database").getDb();

  await sendNotification("waitlist.opened", { recipient: "u1", data: { class_title: "測試瑜伽" } });
  const n1 = db.prepare("SELECT * FROM notifications WHERE user_id='u1' ORDER BY created_at DESC").get();
  ok(!!n1 && n1.title.includes("候補有位") && /測試瑜伽/.test(n1.message), "候補通知有正確標題＋課程");

  await sendNotification("booking.reminder_1h", { recipient: "u1", data: { class_title: "晨跑", date: "2026-10-19", time: "07:00", venue: "中環" } });
  const n2 = db.prepare("SELECT * FROM notifications WHERE user_id='u1' AND title LIKE '%一小時%'").get();
  ok(!!n2 && /晨跑/.test(n2.message) && /07:00/.test(n2.message), "1 小時提醒內容正確");

  await sendNotification("marketing.winback", { recipient: "u1", data: { title: "返嚟啦", message: "送你 5 Credits" } });
  const n3 = db.prepare("SELECT * FROM notifications WHERE user_id='u1' AND title='返嚟啦'").get();
  ok(!!n3 && /5 Credits/.test(n3.message), "winback 用訊息內容");

  console.log("── recipient 接線（原本漏咗 → 永遠唔發）──");
  const waitSrc = fs.readFileSync(path.join(root, "routes/waitlist.js"), "utf8");
  const mktRoute = fs.readFileSync(path.join(root, "routes/marketing.js"), "utf8");
  const mktSvc = fs.readFileSync(path.join(root, "services/marketing.js"), "utf8");
  const paySrc = fs.readFileSync(path.join(root, "routes/payments.js"), "utf8");
  const crmSrc = fs.readFileSync(path.join(root, "routes/crm.js"), "utf8");
  const coachSrc = fs.readFileSync(path.join(root, "routes/coach.js"), "utf8");
  ok(!/sendNotification\("waitlist\.opened",\s*\{\s*user_id/.test(waitSrc), "waitlist 用 recipient 而唔係 user_id");
  ok(/recipient: next\.user_id/.test(waitSrc), "waitlist 有 recipient");
  ok(!/sendNotification\("marketing\.(welcome|winback)",\s*\{\s*user_id/.test(mktRoute) && !/sendNotification\("marketing\.winback",\s*\{\s*user_id/.test(mktSvc), "marketing 用 recipient");
  ok(/sendNotification\("payment\.approved", \{\s*recipient:/.test(paySrc), "Stripe webhook 付款通知有 recipient");
  ok(/role IN \('admin','super_admin','platform_manager'\)/.test(crmSrc), "健康申報通知 admin");
  ok(/role IN \('admin','super_admin','platform_manager'\)/.test(coachSrc), "教練推薦通知 admin");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
