/**
 * ZenPass — 積分賺取 hook tests
 * 驗證：完成課堂 +50 / 課後評價 +20 / 推薦朋友 +100 真正發放（唔止文案），
 * 而且同一事件重複送入只會發一次（idempotent）。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_secret_1234567890_abcdefghijklmnop";
const tmp = path.join(os.tmpdir(), "zenpass-pearn-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', points INTEGER DEFAULT 0, points_tier TEXT, points_tier_label TEXT,
    credits INTEGER DEFAULT 0, referral_credits_earned INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    last_checkin TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,points) VALUES (?,?,?,?)").run("u1", "學生甲", "a@x.com", 0);
  pre.prepare("INSERT INTO users (id,name,email,points) VALUES (?,?,?,?)").run("u2", "教練乙", "b@x.com", 480);
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  try { db.exec("ALTER TABLE bookings ADD COLUMN checked_in_at TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE bookings ADD COLUMN checkin_method TEXT"); } catch (e) {}
  const { awardPointsOnce, EARN_RULES, calcTier } = require("../src/services/points");

  console.log("🧪 積分賺取 hook tests");

  console.log("── 規則常數 ──");
  ok(EARN_RULES.booking === 50, "完成一堂 = +50");
  ok(EARN_RULES.review === 20, "課後評價 = +20");
  ok(EARN_RULES.referral === 100, "推薦朋友 = +100");

  console.log("── 一次性發放 ──");
  const a1 = awardPointsOnce("u1", { points: 50, source: "booking", referenceId: "bk1", description: "✅ 完成課堂" });
  ok(a1.awarded === 50 && a1.balance === 50, "首次發放 +50（餘額 50）");
  const row = db.prepare("SELECT * FROM points_transactions WHERE user_id='u1' AND source='booking'").get();
  ok(row && row.type === "earn" && row.reference_id === "bk1" && row.balance_after === 50, "交易紀錄正確（earn / ref / balance_after）");

  const a2 = awardPointsOnce("u1", { points: 50, source: "booking", referenceId: "bk1" });
  ok(a2.skipped && a2.reason === "already_awarded", "同一 booking 重送 → 跳過");
  ok(db.prepare("SELECT points FROM users WHERE id='u1'").get().points === 50, "餘額冇重複增加");

  const a3 = awardPointsOnce("u1", { points: 50, source: "booking", referenceId: "bk2" });
  ok(a3.awarded === 50 && a3.balance === 100, "另一個 booking → 再 +50（餘額 100）");

  console.log("── 等級自動升級 ──");
  const up = awardPointsOnce("u2", { points: 50, source: "booking", referenceId: "bk9" });
  ok(up.balance === 530 && up.tier.id === "silver", "480 + 50 = 530 → 升級銀牌");
  ok(calcTier(1999).current.id === "silver" && calcTier(2000).current.id === "gold", "等級門檻（2000 → 金牌）");

  console.log("── 其他來源 ──");
  const rev = awardPointsOnce("u1", { points: 20, source: "review", referenceId: "rev1" });
  ok(rev.awarded === 20 && rev.balance === 120, "評價 +20");
  const ref = awardPointsOnce("u2", { points: 100, source: "referral", referenceId: "rd1" });
  ok(ref.awarded === 100 && ref.balance === 630, "推薦 +100");

  ok(awardPointsOnce("u1", { points: 10, source: "review", referenceId: "x" }) && true, "合法 source 可寫入");
  const badSource = (() => { try { awardPointsOnce("u1", { points: 5, source: "expire", referenceId: "e1" }); return null; } catch (e) { return e; } })();
  ok(badSource !== null, "非法 source 會被 schema CHECK 擋（expire 唔准）");

  console.log("── 防呆 ──");
  ok(awardPointsOnce("u1", { points: 0, source: "booking", referenceId: "z1" }).skipped, "0 分 → 跳過");
  ok(awardPointsOnce("nobody", { points: 5, source: "booking", referenceId: "z2" }).skipped, "用戶不存在 → 跳過");
  ok(awardPointsOnce("u1", { points: 5, source: "booking" }).skipped, "冇 reference → 跳過（防重複）");

  console.log("── QR 簽到整合（真實 service）──");
  db.prepare("INSERT INTO classes (id, coach_id, title, category, duration, price_hkd, venue_name, status) VALUES ('c1','u2','測試瑜伽','瑜伽',60,150,'中環','active')").run();
  const nowIso = new Date().toISOString();
  const endIso = new Date(Date.now() + 3600000).toISOString();
  db.prepare("INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, enrolled_count) VALUES ('s1','c1',?,?,10,1)").run(nowIso, endIso);
  db.prepare("INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, status, amount) VALUES ('b1','ZP-TEST01','u1','s1','c1','confirmed',150)").run();

  const bookingService = require("../src/services/booking-service");
  const before = db.prepare("SELECT points FROM users WHERE id='u1'").get().points;
  const res = bookingService.processQRCheckin({
    body: { qr_data: "zenpass-checkin:ZP-TEST01:s1" },
    user: { id: "u1" },
    ip: "127.0.0.1",
    headers: {},
  });
  ok(res.status === 200 && res.body.status === "attended", "QR 簽到成功");
  ok(res.body.points_awarded === 50, "簽到回應帶 +50 積分");
  const after = db.prepare("SELECT points FROM users WHERE id='u1'").get().points;
  ok(after === before + 50, `簽到後積分 ${before} → ${after}`);
  ok(db.prepare("SELECT COUNT(*) c FROM points_transactions WHERE source='booking' AND reference_id='b1'").get().c === 1, "只寫一筆完成課堂積分");

  const res2 = bookingService.processQRCheckin({
    body: { qr_data: "zenpass-checkin:ZP-TEST01:s1" },
    user: { id: "u1" },
    ip: "127.0.0.1",
    headers: {},
  });
  ok(res2.body.already_checked_in === true && db.prepare("SELECT points FROM users WHERE id='u1'").get().points === after, "重複簽到 → 唔會再加分");

  console.log("── 自助簽到 /bookings/:id/attend 整合 ──");
  db.prepare("INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, status, amount) VALUES ('b2','ZP-TEST02','u1','s1','c1','confirmed',150)").run();
  const before2 = db.prepare("SELECT points FROM users WHERE id='u1'").get().points;
  const att = bookingService.attendBooking({
    params: { id: "b2" },
    user: { id: "u1" },
    body: {},
    ip: "127.0.0.1",
    headers: {},
  });
  ok(att.status === 200 && att.body.points_awarded === 50, "自助簽到回應 +50 積分");
  ok(db.prepare("SELECT points FROM users WHERE id='u1'").get().points === before2 + 50, "自助簽到後積分 +50");

  const att2 = bookingService.attendBooking({
    params: { id: "b2" },
    user: { id: "u1" },
    body: {},
    ip: "127.0.0.1",
    headers: {},
  });
  ok(att2.status === 400, "重複簽到被拒");
  ok(db.prepare("SELECT points FROM users WHERE id='u1'").get().points === before2 + 50, "重複簽到冇再加分");

  console.log("── Geofence（伺服器端驗證）──");
  db.prepare("INSERT INTO classes (id, coach_id, title, category, duration, price_hkd, venue_name, latitude, longitude, status) VALUES ('c2','u2','定位測試班','瑜伽',60,150,'中環',22.2800,114.1600,'active')").run();
  db.prepare("INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, enrolled_count) VALUES ('s2','c2',?,?,10,1)").run(nowIso, endIso);
  db.prepare("INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, status, amount) VALUES ('b3','ZP-GEO1','u1','s2','c2','confirmed',150)").run();

  const noGeo = bookingService.attendBooking({ params: { id: "b3" }, user: { id: "u1" }, body: {}, ip: "", headers: {} });
  ok(noGeo.status === 400 && /定位/.test(noGeo.body.error), "場地有座標但冇定位 → 拒絕簽到");

  const far = bookingService.attendBooking({ params: { id: "b3" }, user: { id: "u1" }, body: { latitude: 22.2900, longitude: 114.1600 }, ip: "", headers: {} });
  ok(far.status === 400 && far.body.distance_m > 1000, `距離 1.1km → 拒絕（${far.body.distance_m}m）`);

  const near = bookingService.attendBooking({ params: { id: "b3" }, user: { id: "u1" }, body: { latitude: 22.2802, longitude: 114.1601 }, ip: "", headers: {} });
  ok(near.status === 200 && near.body.points_awarded === 50, "喺場地 30 米內 → 簽到成功 +50");
  ok(db.prepare("SELECT status FROM bookings WHERE id='b3'").get().status === "attended", "距離合格後標記 attended");

  db.prepare("UPDATE users SET is_coach = 1 WHERE id='u2'").run();
  db.prepare("INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, status, amount) VALUES ('b4','ZP-GEO2','u1','s2','c2','confirmed',150)").run();
  const coachAtt = bookingService.attendBooking({ params: { id: "b4" }, user: { id: "u2" }, body: { checkin_method: "coach" }, ip: "", headers: {} });
  ok(coachAtt.status === 200, "教練為自己班簽到 → 唔受 geofence 限制");

  console.log("── 路由接線檢查（文案 vs 實際）──");
  const reviewsSrc = fs.readFileSync(path.join(__dirname, "../src/routes/reviews.js"), "utf8");
  const referralSrc = fs.readFileSync(path.join(__dirname, "../src/routes/referral.js"), "utf8");
  ok(/awardPointsOnce\(/.test(reviewsSrc) && /source:\s*"review"/.test(reviewsSrc), "reviews 路由已接積分");
  ok(/awardPointsOnce\(/.test(referralSrc) && /source:\s*"referral"/.test(referralSrc), "referral 路由已接積分");
  const mutualSrc = fs.readFileSync(path.join(__dirname, "../src/routes/mutual-reviews.js"), "utf8");
  ok(/awardPointsOnce\(/.test(mutualSrc) && /source:\s*"review"/.test(mutualSrc), "真正前端用嘅 mutual-reviews 路由已接積分");
  ok(/context_type === "booking"/.test(mutualSrc) && /rater_role === "student"/.test(mutualSrc), "只限學生評課堂先加分");
  ok(/referenceId:\s*booking_id/.test(reviewsSrc), "舊 reviews 路由用 booking id 去重（唔會同新路由雙重加分）");
  const npsSrc = fs.readFileSync(path.join(__dirname, "../src/routes/nps.js"), "utf8");
  ok(/awardPointsOnce\(/.test(npsSrc) && /source:\s*"review"/.test(npsSrc), "NPS 課後問卷同樣 +20");
  ok(/referenceId:\s*String\(booking_id\)/.test(npsSrc), "NPS 用 booking id 去重（唔會與評分雙重加）");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
