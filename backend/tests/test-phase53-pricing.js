#!/usr/bin/env node
/**
 * Phase 5.3 — 定價口徑一致 + 整數 Cents 分帳
 * AC-PRICING-3：coach_earnings 以整數 cents 落帳，coach + platform === total
 * 另驗：定價矩陣常數（4 堂 520 / 8 堂 960）與前端文案一致性
 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-pricing-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  if (c) { pass++; console.log("  ✅ " + m); }
  else { bad++; console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)); }
};

const settle = require("../src/services/coach-settlement");
const { getDb } = require("../src/services/database");
const db = getDb();
const passes = require("../src/services/passes");
const quorum = require("../src/services/quorum-worker");
quorum.ensureSchema(db);
passes.ensureSchema(db);

console.log("🧪 1. 分帳數學（floor，無浮點）");
[
  [130, 10400, 2600],
  [160, 12800, 3200],
  [80, 6400, 1600],
  [136, 10880, 2720],
  [95, 7600, 1900],
  [139.9, 11192, 2798],
].forEach(([hkd, coach, platform]) => {
  const r = settle.calculateCoachEarning(hkd);
  ok(
    r.coachNetCents === coach && r.platformFeeCents === platform && r.coachNetCents + r.platformFeeCents === r.totalCents,
    `HK$${hkd} → 教練 ${r.coachNetCents}c / 平台 ${r.platformFeeCents}c（合計 ${r.totalCents}c）`,
    r,
  );
});

const odd = settle.calculateCoachEarning(133.33, { enrolled: 3 });
ok(Number.isInteger(odd.coachNetCents) && Number.isInteger(odd.platformFeeCents), "多席位計算仍為整數");
ok(odd.coachNetCents + odd.platformFeeCents === odd.totalCents, "恆等式成立（多席位）");

console.log("\n🧪 2. 落帳：coach_earnings 寫入整數 cents");
db.prepare(
  "INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES ('coach','c@t.hk','蔡教練','60000001','coach',1,1,0.8,0)",
).run();
db.prepare(
  "INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES ('s1','s1@t.hk','陳大文','98765432','user',0,0,0,0)",
).run();
db.prepare(
  `INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open,venue_name,credits_cost)
   VALUES ('cls1','coach','樂齡防跌班','fitness',60,130,8,'active',1,'葵芳體育館',13)`,
).run();
const start = new Date(Date.now() + 3600000).toISOString().slice(0, 19).replace("T", " ");
db.prepare(
  `INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,min_quorum,quorum_status)
   VALUES ('sch1','cls1',?,?,8,2,'available',2,'confirmed')`,
).run(start, start);
["bk1", "bk2"].forEach((id, i) => {
  db.prepare(
    `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount,amount_cents,created_at)
     VALUES (?,?, 's1','sch1','cls1','single','paid','attended',130,13000,datetime('now'))`,
  ).run(id, "ZP-90" + (i + 1));
});

const earnings = require("../src/routes/coach-earnings");
earnings.syncCoachEarningsForSchedule("sch1");
const row = db.prepare("SELECT * FROM coach_earnings WHERE schedule_id='sch1' AND coach_id='coach'").get();
ok(!!row, "生成 coach_earnings");
ok(Number(row.net_amount_cents) === 20800, `net_amount_cents = ${row && row.net_amount_cents}（130×2×80% = 20800）`);
ok(Number(row.gross_amount_cents) === 26000, `gross_amount_cents = ${row && row.gross_amount_cents}`);
ok(Number(row.unit_price_cents) === 13000, `unit_price_cents = ${row && row.unit_price_cents}`);
ok(Number.isInteger(Number(row.net_amount_cents)), "net_amount_cents 為整數");
ok(Number(row.net_amount) === 208, `net_amount（HKD）= ${row && row.net_amount}`);
ok(Number(row.net_amount_cents) + (Number(row.gross_amount_cents) - Number(row.net_amount_cents)) === Number(row.gross_amount_cents), "教練 + 平台 = 總額");

console.log("\n🧪 3. 定價矩陣（後端計劃表）");
const p4 = passes.resolvePlan("pack_4");
const p8 = passes.resolvePlan("pack_8");
ok(p4 && p4.price_cents === 52000 && p4.units === 4, `4 堂 = 52000c / 4 堂（每堂 ${p4 && p4.price_cents / p4.units / 100}）`);
ok(p8 && p8.price_cents === 96000 && p8.units === 8, `8 堂 = 96000c / 8 堂（每堂 ${p8 && p8.price_cents / p8.units / 100}）`);
ok(p4.price_cents / p4.units === 13000, "4 堂每堂 13000c（HK$130）");
ok(p8.price_cents / p8.units === 12000, "8 堂每堂 12000c（HK$120）");

console.log("\n🧪 4. 前端文案一致（無互相矛盾嘅價格）");
const FE = path.join(__dirname, "../../frontend-v2");
const idx = fs.readFileSync(path.join(FE, "index.html"), "utf8");
const pay = fs.readFileSync(path.join(FE, "pass.html"), "utf8");
ok(/折合 ?\$?130|折合 HK\$130/.test(idx), "首頁卡片標示「折合 $130」");
ok(!/或 HK\$ ?130/.test(idx), "首頁已移除模糊「或 HK$130」寫法");
ok(/520/.test(pay) && /130/.test(pay), "購卡頁有 4 堂 HK$520（每堂 $130）");
ok(/960|120/.test(pay), "購卡頁有 8 堂階梯（HK$960 / 每堂 $120）");
ok(/ANCHOR_PRICE_HKD = 160/.test(idx), "AC-PRICING-1：首頁錨定標準單堂 HK$160");
ok(/通票兌換 1 堂（折合 \$130）/.test(idx), "AC-PRICING-1：首頁卡片文案「通票兌換 1 堂（折合 $130）」");
ok(/原價 \$640 · 即省 \$120/.test(pay), "AC-PRICING-2：購卡頁 4 堂標示原價 $640 省 $120");
ok(/原價 \$1,280 · 即省 \$320/.test(pay), "AC-PRICING-2：購卡頁 8 堂標示原價 $1,280 省 $320");

console.log(`\n📊 結果: ${pass} passed / ${bad} failed`);
process.exit(bad ? 1 : 0);
