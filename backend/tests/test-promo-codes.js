#!/usr/bin/env node
/**
 * test-promo-codes.js — 優惠碼單元測試
 * 驗證：三種折扣類型計算、有效期、次數上限、限用課程、每人限用、兌換記錄。
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

const TMP = path.join(os.tmpdir(), "zenpass-promo-" + Date.now() + ".db");
process.env.DB_PATH = TMP;

const Database = require("better-sqlite3");
const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");

let passed = 0, failed = 0;
const assert = (c, m) => { if (c) { console.log("  ✅ " + m); passed++; } else { console.log("  ❌ " + m); failed++; } };

console.log("🧪 優惠碼測試");
initDatabase();
updateDatabase();

const { computeFinalPrice, validatePromo, redeemPromo } = require("../src/services/promo");
const db = new Database(TMP);
db.pragma("foreign_keys = ON");

// 純計算
assert(computeFinalPrice(140, { type: "fixed_price", value: 95 }).final_price === 95, "fixed_price: 140 → 95");
assert(computeFinalPrice(140, { type: "fixed_discount", value: 45 }).final_price === 95, "fixed_discount: 140-45 → 95");
assert(computeFinalPrice(140, { type: "percent", value: 50 }).final_price === 70, "percent: 140 @50% → 70");
assert(computeFinalPrice(80, { type: "fixed_price", value: 95 }).final_price === 80, "fixed_price 唔可以貴過原價（80 → 80）");
assert(computeFinalPrice(50, { type: "fixed_discount", value: 999 }).final_price === 0, "固定減額唔可以負（→ 0）");

// 建 code + class
const CID = "cls-x";
db.prepare("INSERT INTO users (id,email,name,role,email_verified) VALUES ('u1','u1@t.hk','U1','user',1)").run();
db.prepare("INSERT INTO users (id,email,name,role,email_verified) VALUES ('u2','u2@t.hk','U2','user',1)").run();
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status) VALUES (?, 'u1','X','新興運動',60,15,140,14,'active')").run(CID);

const insCode = (o) => {
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO promo_codes (id,code,type,value,class_id,max_uses,used_count,per_user_limit,valid_from,valid_to,active)
              VALUES (?,?,?,?,?,?,0,?,?,?,?)`).run(id, o.code, o.type, o.value, o.class_id || null, o.max_uses ?? null, o.per_user_limit ?? 1, o.valid_from || null, o.valid_to || null, o.active === false ? 0 : 1);
  return id;
};
insCode({ code: "STRETCH95", type: "fixed_price", value: 95, class_id: CID });
insCode({ code: "OFF45", type: "fixed_discount", value: 45 });
insCode({ code: "HALF", type: "percent", value: 50 });
insCode({ code: "OLD", type: "fixed_price", value: 10, valid_to: "2020-01-01" });
insCode({ code: "GONE", type: "fixed_price", value: 10, max_uses: 0 });
insCode({ code: "OTHER", type: "fixed_price", value: 10, class_id: "cls-other" });

let r;
r = validatePromo(db, { code: "stretch95", basePrice: 140, classId: CID, userId: "u1" });
assert(r.ok && r.final_price === 95, "大小寫不敏感 + 折後 95");

r = validatePromo(db, { code: "NOPE", basePrice: 140, classId: CID, userId: "u1" });
assert(!r.ok, "無效 code → 拒絕");

r = validatePromo(db, { code: "OLD", basePrice: 140, userId: "u1" });
assert(!r.ok, "已過期 → 拒絕");

r = validatePromo(db, { code: "GONE", basePrice: 140, userId: "u1" });
assert(!r.ok, "用盡次數 → 拒絕");

r = validatePromo(db, { code: "OTHER", basePrice: 140, classId: CID, userId: "u1" });
assert(!r.ok, "限用其他課程 → 拒絕");

r = validatePromo(db, { code: "OFF45", basePrice: 140, userId: "u1" });
assert(r.ok && r.final_price === 95, "fixed_discount 驗證 95");

// 兌換 + per_user_limit
const pid = db.prepare("SELECT id FROM promo_codes WHERE code='HALF'").get().id;
redeemPromo(db, pid, "u1", "bk1", 70);
assert(db.prepare("SELECT used_count c FROM promo_codes WHERE id=?").get(pid).c === 1, "兌換 used_count +1");
assert(db.prepare("SELECT COUNT(*) c FROM promo_redemptions WHERE code_id=?").get(pid).c === 1, "寫入 redemption 記錄");
r = validatePromo(db, { code: "HALF", basePrice: 140, userId: "u1" });
assert(!r.ok, "同一用戶第 2 次（per_user_limit=1）→ 拒絕");
r = validatePromo(db, { code: "HALF", basePrice: 140, userId: "u2" });
assert(r.ok, "另一用戶仍可用");

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
db.close();
try { fs.unlinkSync(TMP); } catch (e) {}
process.exit(failed ? 1 : 0);
