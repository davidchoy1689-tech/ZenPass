#!/usr/bin/env node
/** 預約金額／Credits 不可由 client 篡改 tests */
const path = require("path");
const os = require("os");
const Database = require("better-sqlite3");

const TMP = path.join(os.tmpdir(), "zenpass-priceint-" + Date.now() + ".db");
process.env.DB_PATH = TMP;
process.env.JWT_SECRET = "test_s…mnop";

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const initDatabase = require("../src/config/init-db");
  await initDatabase();
  const updateDatabase = require("../src/config/update-db");
  updateDatabase();

  const db = new Database(TMP);
  db.pragma("foreign_keys = ON");
  const start = new Date(Date.now() + 3600000).toISOString().slice(0, 19).replace("T", " ");
  const end = new Date(Date.now() + 7200000).toISOString().slice(0, 19).replace("T", " ");
  db.prepare("INSERT INTO users (id,email,name,credits,role,email_verified) VALUES ('u1','u1@test.hk','甲',100,'user',1)").run();
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,credits_cost,status) VALUES ('c1','u1','班','瑜伽',60,10,150,12,'active')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',?,?,10,0,'available')").run(start, end);
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s2','c1',?,?,10,0,'available')").run(start, end);
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s3','c1',?,?,10,0,'available')").run(start, end);
  db.close();

  const { createBooking } = require("../src/services/booking-service");
  console.log("🧪 預約金額完整性 tests");

  // 1. credits 付款：client 聲稱 0.1 credit、amount 10000
  const r1 = createBooking({
    body: { schedule_id: "s1", class_id: "c1", payment_type: "credits", amount: 10000, credits_cost: 0.1, penalty_consent: true },
    user: { id: "u1" },
  });
  ok(r1.status === 201, "credits 預約成功");
  const d1 = new Database(TMP);
  ok(d1.prepare("SELECT credits FROM users WHERE id='u1'").get().credits === 88, "實際扣 12 credits（唔係 0.1）");
  const b1 = d1.prepare("SELECT amount FROM bookings WHERE user_id='u1' AND schedule_id='s1'").get();
  ok(b1 && b1.amount === 120, "booking.amount = 120（12cr × $10，唔係 client 10000）");

  // 2. 單次付款：client 聲稱 amount 1，但課程價 150
  const r2 = createBooking({
    body: { schedule_id: "s2", class_id: "c1", payment_type: "single", amount: 1, penalty_consent: true },
    user: { id: "u1" },
  });
  ok(r2.status === 201 && r2.body.requires_payment, "單次預約成功（待付款）");
  const b2 = d1.prepare("SELECT amount FROM bookings WHERE user_id='u1' AND schedule_id='s2'").get();
  ok(b2 && b2.amount === 150, "單次付款金額 = 課程原價 150（唔係 client 1）");

  // 3. 伺服器內部 override（batch promo）仍可用
  const r3 = createBooking(
    { body: { schedule_id: "s3", class_id: "c1", payment_type: "credits", amount: 95, penalty_consent: true }, user: { id: "u1" } },
    { creditsOverride: 9.5 },
  );
  ok(r3.status === 201, "伺服器 override 可扣 9.5 credits");
  const b3 = d1.prepare("SELECT amount FROM bookings WHERE user_id='u1' AND schedule_id='s3'").get();
  ok(b3 && b3.amount === 95, "override booking.amount = 95");
  ok(d1.prepare("SELECT credits FROM users WHERE id='u1'").get().credits === 78.5, "餘額 100-12-9.5 = 78.5");
  d1.close();

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
