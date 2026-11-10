#!/usr/bin/env node
/**
 * test-auth-referral.js — 工單十三
 *  1. OTP 發送／頻率限制／錯誤鎖定／驗證建帳戶
 *  2. 推薦碼綁定防刷（自己、同電話、同裝置、重複）
 *  3. 首堂出席才派堂（原子、雙方各 +1）；缺席不派
 *  4. 每月上限
 *  5. 前端頁面存在並接駁 API
 */
process.env.JWT_SECRET = "***".repeat(48);
const os = require("os"), path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-auth-ref-" + Date.now() + ".db");
delete process.env.NODE_ENV;
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
initDatabase();
updateDatabase();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : typeof x === "string" ? x : JSON.stringify(x))); };

const { getDb } = require("../src/services/database");
const db = getDb();
const otp = require("../src/services/otp-service");
const referral = require("../src/services/referral-rewards");
const jwt = require("jsonwebtoken");

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { body = {}, user = null, params = {}, query = {} } = {}) => new Promise((resolve) => {
  const res = {
    statusCode: 200, body: null, cookies: [],
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; resolve(this); },
    cookie(n, v, o) { this.cookies.push({ n, v, o }); return this; },
  };
  try { h({ body, user, params, query, headers: {}, ip: "127.0.0.1", cookies: {} }, res); } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

function mkUser(id, name, phone, role = "user") {
  db.prepare("INSERT INTO users (id,email,name,phone,role,created_at) VALUES (?,?,?,?,?,datetime('now'))")
    .run(id, `${id}@t.hk`, name, phone, role);
}
function refCodeFor(uid) {
  const code = "ZP" + uid.toUpperCase();
  db.prepare("INSERT INTO referral_codes (id,user_id,code) VALUES (?,?,?)").run("rc-" + uid, uid, code);
  return code;
}
function mkBooking(id, uid) {
  db.prepare(
    "INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, status, payment_status) VALUES (?,?,?,?,?, 'attended','paid')",
  ).run(id, "REF" + id, uid, "s1", "c1");
}

(async () => {
  console.log("🧪 1. OTP 發送 + 沙盒碼");
  const s1 = await otp.sendOtp({ phone: "91234567", ip: "1.1.1.1" });
  ok(s1.status === 200 && /^\d{6}$/.test(s1.body.dev_code || ""), "沙盒回傳 6 位驗證碼", s1.body);
  ok(s1.body.channel === "log" && s1.body.expires_in === 600, "10 分鐘有效、log 通道");

  const s2 = await otp.sendOtp({ phone: "91234567", ip: "1.1.1.1" });
  ok(s2.status === 429 && s2.body.code === "OTP_TOO_SOON", "60 秒內重發 → 429", s2.body);

  const s3 = await otp.sendOtp({ phone: "12345" });
  ok(s3.status === 400, "格式錯 → 400");

  console.log("🧪 2. 驗證碼錯誤 / 鎖定 / 過期");
  const vWrong = await otp.verifyOtp({ phone: "91234567", code: "000000" });
  ok(vWrong.status === 400 && vWrong.body.attempts_left === 4, "錯碼扣次數", vWrong.body);
  for (let i = 0; i < 4; i++) await otp.verifyOtp({ phone: "91234567", code: "000000" });
  const vLocked = await otp.verifyOtp({ phone: "91234567", code: "123456" });
  ok(vLocked.status === 429 && vLocked.body.code === "OTP_LOCKED", "5 次錯 → 鎖定", vLocked.body);

  db.prepare("DELETE FROM auth_otps WHERE phone='91234567'").run();
  const s4 = await otp.sendOtp({ phone: "98765432" });
  const vOk = await otp.verifyOtp({ phone: "98765432", code: s4.body.dev_code, name: "陳婆婆", deviceId: "dev-a" });
  ok(vOk.status === 200 && vOk.body.token, "正確碼 → 發出 token", vOk.body.error);
  ok(vOk.body.user && vOk.body.user.phone === "98765432", "新電話自動建檔");
  const decoded = jwt.decode(vOk.body.token);
  ok(decoded && Math.round((decoded.exp - decoded.iat) / 86400) === 30, "長效 30 日 session", decoded && decoded.exp - decoded.iat);
  const uid1 = vOk.body.user.id;

  const s5 = await otp.sendOtp({ phone: "98765432" });
  db.prepare("UPDATE auth_otps SET created_at=datetime('now','-2 minutes') WHERE phone='98765432'").run();
  const s5b = await otp.sendOtp({ phone: "98765432" });
  const vAgain = await otp.verifyOtp({ phone: "98765432", code: s5b.body.dev_code });
  ok(vAgain.body.user.id === uid1, "舊電話登入讀返同一帳戶");

  const s6 = await otp.sendOtp({ phone: "61234567" });
  db.prepare("UPDATE auth_otps SET expires_at=datetime('now','-1 minute') WHERE phone='61234567'").run();
  const vExp = await otp.verifyOtp({ phone: "61234567", code: s6.body.dev_code });
  ok(vExp.status === 400 && vExp.body.code === "OTP_EXPIRED", "過期 → OTP_EXPIRED");

  console.log("🧪 3. 推薦碼綁定防刷");
  mkUser("ref1", "蔡教練", "91111111", "coach");
  db.prepare(
    "INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status) VALUES ('c1','ref1','測試班','fitness',60,140,'active')",
  ).run();
  db.prepare(
    "INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants) VALUES ('s1','c1',datetime('now','+3 days'),datetime('now','+3 days','+1 hour'),20)",
  ).run();
  const CODE = refCodeFor("ref1");
  const router = require("../src/routes/referral-rewards");
  const claimH = handlerOf(router, "post", "/student/referral/claim-code");

  const selfCode = db.prepare("SELECT code FROM referral_codes WHERE user_id='ref1'").get();
  mkUser("u-self", "蔡教練", "91111111");
  const rSelf = await call(claimH, { user: { id: "u-self", role: "user" }, body: { code: selfCode.code } });
  ok(rSelf.statusCode === 400 && rSelf.body.code === "SELF_REFERRAL", "自己嘅碼 → 400", rSelf.body);

  mkUser("u-same", "蔡二", "91111111");
  const rSame = await call(claimH, { user: { id: "u-same", role: "user" }, body: { code: CODE } });
  ok(rSame.statusCode === 400 && rSame.body.code === "SELF_REFERRAL", "同電話 → 400", rSame.body);

  mkUser("u-dev", "街坊甲", "92222222");
  referral.touchDevice(db, "ref1", "device-x");
  const rDev = await call(claimH, { user: { id: "u-dev", role: "user" }, body: { code: CODE, device_id: "device-x" } });
  ok(rDev.statusCode === 400 && rDev.body.code === "SAME_DEVICE", "同一裝置 → 400", rDev.body);

  mkUser("u-a", "李淑芬", "93333333");
  const rA = await call(claimH, { user: { id: "u-a", role: "user" }, body: { code: CODE, device_id: "dev-a" } });
  ok(rA.statusCode === 200 && rA.body.status === "pending_attendance", "正常綁定 → pending", rA.body);
  ok(db.prepare("SELECT COUNT(*) c FROM user_passes WHERE user_id IN ('ref1','u-a')").get().c === 0, "綁定時未派堂");

  const rAgain = await call(claimH, { user: { id: "u-a", role: "user" }, body: { code: CODE, device_id: "dev-a" } });
  ok(rAgain.statusCode === 409 && rAgain.body.code === "ALREADY_REFERRED", "重複綁定 → 409", rAgain.body);

  console.log("🧪 4. 首堂出席 Hook");
  mkBooking("bk-a1", "u-a");
  // 老師點名 present：模擬 booking 已 attended
  db.prepare("UPDATE bookings SET status='attended' WHERE id='bk-a1'").run();
  const rew = referral.onAttendance(db, { userId: "u-a", bookingId: "bk-a1" });
  ok(rew && rew.rewarded === true, "首次出席 → 派堂", rew);
  const pr = db.prepare("SELECT * FROM user_passes WHERE user_id='ref1' AND notes LIKE '%推薦獎賞%'").get();
  const pe = db.prepare("SELECT * FROM user_passes WHERE user_id='u-a' AND notes LIKE '%首堂%'").get();
  ok(pr && Number(pr.remaining_credits) === 1, "推薦人 +1 堂");
  ok(pe && Number(pe.remaining_credits) === 1, "被推薦人 +1 堂");
  const rw = db.prepare("SELECT * FROM referral_rewards WHERE referee_user_id='u-a'").get();
  ok(rw.status === "rewarded" && rw.qualifying_booking_id === "bk-a1" && rw.rewarded_at, "獎賞紀錄 rewarded + 班次");
  const auditRow = db.prepare("SELECT * FROM audit_log WHERE action_type='referral.reward_issued'").get();
  ok(!!auditRow, "寫入 audit_log");

  const rew2 = referral.onAttendance(db, { userId: "u-a", bookingId: "bk-a1" });
  ok(rew2 === null, "重複 hook 唔會再派");
  ok(db.prepare("SELECT COUNT(*) c FROM user_passes WHERE user_id='u-a'").get().c === 1, "只有 1 張獎賞 pass");

  console.log("🧪 5. 非首次出席 / 缺席");
  mkUser("u-b", "黃伯", "94444444");
  db.prepare("INSERT INTO referral_rewards (id,referrer_user_id,referee_user_id,referee_phone,status) VALUES ('rr-b','ref1','u-b','94444444','pending_attendance')").run();
  mkBooking("bk-b0", "u-b");
  db.prepare("UPDATE bookings SET status='attended' WHERE id='bk-b0'").run();
  const notFirst = referral.onAttendance(db, { userId: "u-b", bookingId: "bk-b1" });
  ok(notFirst === null, "非首次出席 → 不派");
  ok(db.prepare("SELECT status FROM referral_rewards WHERE id='rr-b'").get().status === "pending_attendance", "維持 pending");

  console.log("🧪 6. 每月上限 4 次");
  for (let i = 0; i < 4; i++) {
    const rid = "cap-" + i;
    mkUser(rid, "學員" + i, "9555555" + i);
    db.prepare("INSERT INTO referral_rewards (id,referrer_user_id,referee_user_id,referee_phone,status,rewarded_at) VALUES (?, 'ref1', ?, ?, 'rewarded', datetime('now'))")
      .run("rr-" + rid, rid, "9555555" + i);
  }
  mkUser("u-cap", "第五位", "96666666");
  db.prepare("INSERT INTO referral_rewards (id,referrer_user_id,referee_user_id,referee_phone,status) VALUES ('rr-cap','ref1','u-cap','96666666','pending_attendance')").run();
  mkBooking("bk-cap", "u-cap");
  db.prepare("UPDATE bookings SET status='attended' WHERE id='bk-cap'").run();
  const capped = referral.onAttendance(db, { userId: "u-cap", bookingId: "bk-cap" });
  ok(capped && capped.rewarded === false && capped.reason === "MONTHLY_CAP", "超過每月上限 → 拒絕", capped);
  ok(db.prepare("SELECT status, reject_reason FROM referral_rewards WHERE id='rr-cap'").get().reject_reason === "MONTHLY_CAP", "記錄 reject_reason");

  console.log("🧪 7. 摘要 API");
  const sum = referral.summaryForUser("ref1");
  ok(sum.code && sum.stats.rewarded === 5 && sum.stats.monthly_cap === 4, "推薦摘要（已獎賞 5）", sum.stats);
  ok(sum.recent.length > 0 && !sum.recent[0].phone_masked.includes("96666666"), "電話有遮罩");
  ok(referral.summaryForUser("u-a").my_referral.status === "rewarded", "被推薦人見到已獎賞");

  console.log("🧪 8. 前端頁面");
  const fs = require("fs");
  const base = path.join(__dirname, "../../frontend-v2");
  const otpPage = fs.readFileSync(path.join(base, "login-otp.html"), "utf8");
  const login = fs.readFileSync(path.join(base, "login.html"), "utf8");
  const hb = fs.readFileSync(path.join(base, "student-handbook.html"), "utf8");
  const wel = fs.readFileSync(path.join(base, "welcome.html"), "utf8");
  ok(/auth\/otp\/send/.test(otpPage) && /auth\/otp\/verify/.test(otpPage), "OTP 頁接 API");
  ok(/autocomplete="one-time-code"/.test(otpPage), "支援手機自動填入驗證碼");
  ok(/login-otp\.html/.test(login), "登入頁有免密碼入口");
  ok(/我的堂數存簿/.test(hb) && /student\/referral\/summary/.test(hb), "手冊有堂數存簿");
  ok(/&ref=/.test(wel) && /referral\/claim-code/.test(wel), "迎新頁帶推薦碼");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error("💥", e); process.exit(1); });
