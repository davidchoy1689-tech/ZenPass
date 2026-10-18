/**
 * ZenPass — 管理員手動調整會員等級 tests
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_s…mnop";
const tmp = path.join(os.tmpdir(), "zenpass-loyadmin-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, membership_type TEXT DEFAULT 'none',
    loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0, monthly_bookings INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,credits) VALUES (?,?,?,?)").run("u1", "甲", "a@x.com", 100);
  pre.prepare("INSERT INTO users (id,name,email,credits) VALUES (?,?,?,?)").run("u2", "乙", "b@x.com", 100);
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { setUserTierManually, resetUserTierToAuto, updateAllTiers, getTopUpDiscount } = require("../src/services/loyalty");

  console.log("🧪 管理員調整會員等級 tests");

  console.log("── 手動設定 ──");
  const out = setUserTierManually("u1", "gold", { adminId: "admin1", reason: "VIP 客戶" });
  ok(out.tier === "gold" && out.manual === true, "設定金牌成功");
  const u1 = db.prepare("SELECT loyalty_tier, loyalty_tier_manual FROM users WHERE id='u1'").get();
  ok(u1.loyalty_tier === "gold" && u1.loyalty_tier_manual === 1, "DB 已寫入 gold + manual=1");
  ok(getTopUpDiscount("u1") === 10, "折扣即時生效（10%）");

  const auditRow = db.prepare("SELECT * FROM audit_log WHERE entity_id='u1' AND action_type='loyalty.tier_manual'").get();
  ok(!!auditRow, "寫入 audit_log（可追溯）");

  console.log("── 驗證 / 防呆 ──");
  const bad = (() => { try { setUserTierManually("u1", "platinum", {}); return null; } catch (e) { return e; } })();
  ok(bad && bad.status === 400, "無效等級 → 400");
  const missing = (() => { try { setUserTierManually("nobody", "gold", {}); return null; } catch (e) { return e; } })();
  ok(missing && missing.status === 404, "用戶不存在 → 404");

  console.log("── 每月自動計算會跳過手動用戶 ──");
  // u2 有 6 筆近期 booking → 應升銀牌
  db.prepare("INSERT INTO classes (id, coach_id, title, category, duration, price_hkd, status) VALUES ('c1','u2','測試班','瑜伽',60,150,'active')").run();
  db.prepare("INSERT INTO class_schedules (id, class_id, start_time, end_time) VALUES ('s1','c1',datetime('now'),datetime('now','+1 hour'))").run();
  for (let i = 0; i < 6; i++) {
    db.prepare("INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, status, created_at) VALUES (?,?,?,?,?,?,datetime('now'))")
      .run("b" + i, "ZP-A" + i, "u2", "s1", "c1", "attended");
  }
  updateAllTiers();
  const after = db.prepare("SELECT loyalty_tier FROM users WHERE id IN ('u1','u2') ORDER BY id").all().map(r => r.loyalty_tier);
  ok(after[0] === "gold", "手動用戶（u1）保持金牌，冇被自動降級");
  ok(after[1] === "silver", "自動用戶（u2）6 堂 → 銀牌");

  console.log("── 回復自動 ──");
  const reset = resetUserTierToAuto("u1", "admin1");
  ok(reset.manual === false, "manual 已清除");
  ok(reset.tier === "bronze", "u1 冇 booking → 回復銅牌");
  ok(db.prepare("SELECT loyalty_tier_manual FROM users WHERE id='u1'").get().loyalty_tier_manual === 0, "DB manual=0");

  console.log("── API / 前端接線 ──");
  const root = path.join(__dirname, "..");
  const adminSrc = fs.readFileSync(path.join(root, "src/routes/admin.js"), "utf8");
  const web = path.join(root, "..", "frontend-v2");
  const adminHtml = fs.readFileSync(path.join(web, "admin.html"), "utf8");
  const apiJs = fs.readFileSync(path.join(web, "assets", "api.js"), "utf8");
  const initSrc = fs.readFileSync(path.join(root, "src/config/init-db.js"), "utf8");
  ok(/router\.patch\("\/users\/:id\/loyalty-tier"/.test(adminSrc), "PATCH admin 路由存在");
  ok(/router\.delete\("\/users\/:id\/loyalty-tier"/.test(adminSrc), "DELETE admin 路由存在（回復自動）");
  ok(/requireAdmin/.test(adminSrc), "路由有 admin 權限保護");
  ok(/loySel/.test(adminHtml) && /loySave/.test(adminHtml) && /loyReset/.test(adminHtml), "用戶詳情有等級選擇／儲存／回復");
  ok(/api\.patch\("\/admin\/users\//.test(adminHtml) && /api\.del\("\/admin\/users\//.test(adminHtml), "前端呼叫正確 method");
  ok(/patch: \(p, b\) => req\("PATCH"/.test(apiJs), "api.js 支援 PATCH");
  ok(/ALTER TABLE users ADD COLUMN loyalty_tier_manual/.test(initSrc), "init-db 自動加 loyalty_tier_manual");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
