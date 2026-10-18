/** ZenPass — 管理員調整積分 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
const tmp = path.join(os.tmpdir(), "zenpass-ptsadj-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', points INTEGER DEFAULT 0, points_tier TEXT, points_tier_label TEXT,
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,points) VALUES ('u1','甲','a@x.com',100)").run();
  pre.prepare("INSERT INTO users (id,name,email,points) VALUES ('u2','乙','b@x.com',5)").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { adjustPoints } = require("../src/services/points");

  console.log("🧪 管理員調整積分 tests");

  const a1 = adjustPoints("u1", 50, { adminId: "admin1", reason: "課堂延誤補償" });
  ok(a1.before === 100 && a1.balance === 150, "+50 → 100 變 150");
  ok(db.prepare("SELECT points FROM users WHERE id='u1'").get().points === 150, "DB 已更新");

  const tx = db.prepare("SELECT * FROM points_transactions WHERE user_id='u1' AND source='admin' ORDER BY created_at DESC").get();
  ok(tx && tx.type === "earn" && tx.points === 50 && /課堂延誤補償/.test(tx.description), "寫入積分交易（source=admin）");

  const auditRow = db.prepare("SELECT * FROM audit_log WHERE entity_id='u1' AND action_type='points.admin_adjust'").get();
  ok(!!auditRow, "寫入 audit_log");

  const a2 = adjustPoints("u1", -30, { adminId: "admin1", reason: "修正重複發放" });
  ok(a2.balance === 120, "扣 30 → 120");
  const spend = db.prepare("SELECT * FROM points_transactions WHERE user_id='u1' AND source='admin' AND type='spend'").get();
  ok(spend && spend.points === 30, "負數寫成 spend 交易");

  console.log("── 防呆 ──");
  const over = (() => { try { adjustPoints("u2", -10, { reason: "測試扣爆" }); return null; } catch (e) { return e; } })();
  ok(over && over.status === 400 && /不足/.test(over.message), "扣到負數 → 拒絕");
  const zero = (() => { try { adjustPoints("u1", 0, { reason: "零" }); return null; } catch (e) { return e; } })();
  ok(zero && zero.status === 400, "0 分 → 拒絕");
  const noReason = (() => { try { adjustPoints("u1", 10, { reason: "" }); return null; } catch (e) { return e; } })();
  ok(noReason && noReason.status === 400 && /原因/.test(noReason.message), "冇原因 → 拒絕");
  const noUser = (() => { try { adjustPoints("nobody", 10, { reason: "測試" }); return null; } catch (e) { return e; } })();
  ok(noUser && noUser.status === 404, "用戶不存在 → 404");
  const tooBig = (() => { try { adjustPoints("u1", 200000, { reason: "測試" }); return null; } catch (e) { return e; } })();
  ok(tooBig && tooBig.status === 400, "超過上限 → 拒絕");

  console.log("── 接線 ──");
  const root = path.join(__dirname, "..");
  const adminSrc = fs.readFileSync(path.join(root, "src/routes/admin.js"), "utf8");
  const web = path.join(root, "..", "frontend-v2");
  const adminHtml = fs.readFileSync(path.join(web, "admin.html"), "utf8");
  ok(/router\.post\("\/users\/:id\/points"/.test(adminSrc), "POST admin points 路由存在");
  ok(/requireAdmin/.test(adminSrc), "有 admin 權限");
  ok(/ptsDelta/.test(adminHtml) && /ptsReason/.test(adminHtml) && /admin\/users\/.*\/points/.test(adminHtml), "用戶詳情有積分調整 UI");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
