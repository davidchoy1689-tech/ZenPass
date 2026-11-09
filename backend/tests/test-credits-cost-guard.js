#!/usr/bin/env node
/**
 * test-credits-cost-guard.js — Credits 免費預約防線
 * 背景：2026-11-08 booking 9fc05033（$160 課程 credits_cost=0）用 Credits 0 元預約，
 *       導致已付款 booking 冇 ledger。呢個測試鎖死：
 *       1) normalizeCreditsCost() 規則（1 credit = HK$10）
 *       2) credits_cost=0 嘅舊課程仍然按 price_hkd/10 扣 credits，唔會變免費
 *       3) 成功扣 credits 後一定有 4 邊拆賬 ledger
 */
const path = require("path");
const os = require("os");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-credits-guard-" + Date.now() + ".db");

const Database = require("better-sqlite3");
const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");

let passed = 0, failed = 0;
const ok = (c, m, x) => { c ? (passed++, console.log("  ✅", m)) : (failed++, console.log("  ❌", m, x == null ? "" : x)); };

console.log("🧪 Credits 免費預約防線");
initDatabase();
updateDatabase();

const { normalizeCreditsCost } = require("../src/utils/credits-cost");

console.log("\n📋 1. normalizeCreditsCost 規則");
ok(normalizeCreditsCost(16, 160) === 16, "正常值不變");
ok(normalizeCreditsCost(0, 160) === 16, "0 + $160 → 16 credits");
ok(normalizeCreditsCost(null, 140) === 14, "null + $140 → 14 credits");
ok(normalizeCreditsCost(undefined, 180) === 18, "undefined + $180 → 18 credits");
ok(normalizeCreditsCost(0, 0) === 0, "免費課程維持 0");
ok(normalizeCreditsCost(-5, 95) === 10, "負數 → 按價錢補（$95 → 10）");

const TMP = process.env.DB_PATH;
const db = new Database(TMP);
db.pragma("foreign_keys = ON");
const future = new Date(Date.now() + 7 * 86400000);
const iso = future.toISOString().slice(0, 19).replace("T", " ");
const later = new Date(Date.now() + 7 * 86400000 + 5400000).toISOString().slice(0, 19).replace("T", " ");

db.prepare("INSERT INTO users (id,email,name,phone,credits,role,email_verified) VALUES ('u1','a@t.hk','陳小明','98765432',20,'user',1)").run();
db.prepare("INSERT INTO users (id,email,name,phone,credits,role,email_verified) VALUES ('coach','c@t.hk','教練','90001111',0,'coach',1)").run();
// 模擬 2026-11-08 出事課程：$160 但 credits_cost = 0
db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status) VALUES ('c1','coach','芬蘭木柱體驗班','新興運動',90,10,160,0,'active')").run();
db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',?,?,10,0,'available')").run(iso, later);
db.close();

const { createBooking } = require("../src/services/booking-service");

function fresh(fn) { const d = new Database(TMP); try { return fn(d); } finally { d.close(); } }
const credits = () => fresh(d => d.prepare("SELECT credits FROM users WHERE id='u1'").get().credits);
const amount = () => fresh(d => d.prepare("SELECT amount,payment_status FROM bookings ORDER BY created_at DESC LIMIT 1").get());
const ledger = () => fresh(d => d.prepare("SELECT debit,credit,account_code FROM ledger").all());

console.log("\n📋 2. credits_cost=0 舊課程不可免費預約");
const r = createBooking({
  body: { schedule_id: "s1", class_id: "c1", payment_type: "credits", penalty_consent: true },
  user: { id: "u1" }, headers: {}, ip: "127.0.0.1",
});
ok(r.status === 201, "預約成功 201", r.status + " " + JSON.stringify(r.body).slice(0, 160));
ok(credits() === 4, "扣足 16 credits（20 → 4），唔係 0", credits());
const b = amount();
ok(Number(b.amount) === 160, "booking amount = HK$160", b.amount);
ok(b.payment_status === "paid", "付款狀態 paid");

console.log("\n📋 3. 拆賬 ledger 必須存在");
const rows = ledger();
ok(rows.length >= 2, "有 ledger 分錄（最少資產＋收入）", rows.length);
ok(rows.some((x) => x.account_code === "1200"), "有 1200 點數收入（借方）");
ok(rows.some((x) => ["3000", "2001", "2002"].includes(x.account_code)), "有收入／應付貸方分錄");
const debit = rows.reduce((s, x) => s + (x.debit || 0), 0);
const credit = rows.reduce((s, x) => s + (x.credit || 0), 0);
ok(Math.abs(debit - 160) < 0.01, "借方合計 HK$160", debit);
ok(Math.abs(credit - 160) < 0.01, "貸方合計 HK$160", credit);

console.log(`\n${failed === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
