/** ZenPass — 會籍暫停／恢復（同步到期日）tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
process.env.NOTIFICATION_TYPES = "db";
const tmp = path.join(os.tmpdir(), "zenpass-mpause-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, membership_type TEXT DEFAULT 'gold',
    membership_expires_at TEXT, loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,membership_expires_at) VALUES ('u1','甲','a@x.com','2026-11-10T00:00:00.000Z')").run();
  pre.prepare("INSERT INTO users (id,name,email,membership_expires_at) VALUES ('u2','乙','b@x.com','2026-10-20T00:00:00.000Z')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { pauseMembership, resumeDueMemberships } = require("../src/services/membership-pause");

  db.prepare("INSERT INTO memberships (id,user_id,type,price_hkd,credits_granted,start_date,end_date,status) VALUES ('m1','u1','gold',2899,362,'2026-10-10','2026-11-10','active')").run();
  db.prepare("INSERT INTO memberships (id,user_id,type,price_hkd,credits_granted,start_date,end_date,status) VALUES ('m2','u2','gold',2899,362,'2026-10-10','2026-10-20','active')").run();

  console.log("🧪 會籍暫停／恢復 tests");

  const now = new Date("2026-10-18T04:00:00Z");
  const out = pauseMembership("u1", "m1", 7, "旅行", { now });
  await new Promise((r) => setTimeout(r, 60));

  ok(out.days === 7, "暫停 7 日");
  const m1 = db.prepare("SELECT end_date, paused_until, pause_count FROM memberships WHERE id='m1'").get();
  ok(String(m1.end_date).startsWith("2026-11-17"), "end_date 順延 7 日（11-10 → 11-17）");
  const u1 = db.prepare("SELECT membership_expires_at FROM users WHERE id='u1'").get();
  ok(String(u1.membership_expires_at).startsWith("2026-11-17"), "users.membership_expires_at 同步更新");
  ok(m1.pause_count === 1, "pause_count = 1");
  const n = db.prepare("SELECT * FROM notifications WHERE user_id='u1' AND type='membership.paused'").get();
  ok(!!n && /已暫停/.test(n.message) && /2026-11-17/.test(n.message), "暫停通知有順延後到期日");

  console.log("── 防呆 ──");
  const again = (() => { try { pauseMembership("u1", "m1", 7, "", { now }); return null; } catch (e) { return e; } })();
  ok(again && again.status === 400 && /暫停緊/.test(again.message), "重複暫停 → 400");
  const noM = (() => { try { pauseMembership("u1", "nope", 7, ""); return null; } catch (e) { return e; } })();
  ok(noM && noM.status === 404, "會籍不存在 → 404");
  // 手動用盡 3 次
  db.prepare("UPDATE memberships SET pause_count = 3, paused_until = NULL WHERE id='m2'").run();
  const maxed = (() => { try { pauseMembership("u2", "m2", 7, ""); return null; } catch (e) { return e; } })();
  ok(maxed && maxed.status === 400 && /3次/.test(maxed.message), "超過 3 次 → 400");

  console.log("── 自動恢復 ──");
  const resumeAt = new Date(out.paused_until);
  const before = resumeDueMemberships({ now: new Date(resumeAt.getTime() - 3600000) });
  ok(before === 0, "未到期 → 唔恢復");
  const after = resumeDueMemberships({ now: new Date(resumeAt.getTime() + 60000) });
  await new Promise((r) => setTimeout(r, 60));
  ok(after === 1, "到期 → 恢復 1 個");
  const m1b = db.prepare("SELECT paused_until, end_date FROM memberships WHERE id='m1'").get();
  ok(m1b.paused_until === null, "paused_until 清空");
  ok(String(m1b.end_date).startsWith("2026-11-17"), "恢復後 end_date 保持順延");
  const rn = db.prepare("SELECT * FROM notifications WHERE user_id='u1' AND type='membership.resume'").get();
  ok(!!rn && /恢復/.test(rn.message), "恢復通知有正確模板");
  ok(!!db.prepare("SELECT 1 FROM audit_log WHERE entity_id='m1' AND action_type='membership.resume'").get(), "寫入 audit_log");

  console.log("── 接線 ──");
  const routeSrc = fs.readFileSync(path.join(__dirname, "../src/routes/memberships.js"), "utf8");
  const idx = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  ok(/pauseMembership\(/.test(routeSrc), "pause 路由用 service");
  ok(/resumeDueMemberships/.test(idx), "scheduler 用 service");
  ok(/membership\.paused/.test(fs.readFileSync(path.join(__dirname, "../src/services/notification.js"), "utf8")), "通知模板存在");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
