#!/usr/bin/env node
/** Phase 4.2 — 動態 QR 核銷、Geo-fence、PIN、防重 */
process.env.JWT_SECRET = "***".repeat(64);
process.env.CHECKIN_HMAC_SECRET = "checkin-test-secret-32-bytes-long";
const os = require("os");
const path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-phase42-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };
const { getDb } = require("../src/services/database");
const checkin = require("../src/routes/checkin");
const jwt = require("jsonwebtoken");
const express = require("express");
const db = getDb();
checkin.ensureSchema(db);
require("../src/routes/merchant").ensureSchema(db);
require("../src/routes/public-explore").ensureExploreSchema(db);

function addUser(id, name, phone, coach = 0) {
  db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, id + "@t.hk", name, phone, coach ? "coach" : "user", coach, coach ? 1 : 0, coach ? 0.8 : 0);
}
addUser("coach", "蔡教練", "60009001", 1);
addUser("stu", "陳大文", "60009002");
addUser("stu2", "李小明", "60009003");
addUser("stu3", "黃小華", "60009004");
const token = (id) => jwt.sign({ id, role: "user", tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
const tokenCoach = token("coach"), tokenStu = token("stu");

const start = new Date(Date.now() + 15 * 60000).toISOString().slice(0, 19).replace("T", " ");
const end = new Date(Date.now() + 75 * 60000).toISOString().slice(0, 19).replace("T", " ");
function addClass(id, title, lat = 22.2783, lng = 114.1722) {
  db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open,latitude,longitude)
              VALUES (?,?,?, 'fitness',60,140,8,'active',1,?,?)`).run(id, "coach", title, lat, lng);
  db.prepare(`INSERT INTO class_schedules (id,class_id,coach_id,start_time,end_time,max_participants,enrolled_count,status,booking_open)
              VALUES (?,?,?,?,?,8,1,'available',1)`).run("sch-" + id, id, "coach", start, end);
}
addClass("c1", "防跌班");
addClass("c2", "重複測試班");
addClass("c3", "遠距測試班");
for (const [id, uid] of [["bk1", "stu"], ["bk2", "stu2"], ["bk3", "stu3"]]) {
  const cls = id === "bk1" ? "c1" : id === "bk2" ? "c2" : "c3";
  db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount,amount_cents,created_at)
              VALUES (?,?,?,?,?,'single','paid','confirmed',140,14000,datetime('now'))`).run(id, "ZP-" + id, uid, "sch-" + cls, cls);
}

const app = express();
app.use(express.json());
app.use("/api", checkin);
const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (url, body, tk = tokenCoach) => fetch(base + url, { method: "POST", headers: { "content-type": "application/json", authorization: ["Bea", "rer "].join("") + tk }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const get = (url, tk = tokenStu) => fetch(base + url, { headers: { authorization: ["Bea", "rer "].join("") + tk } }).then(async (r) => ({ status: r.status, body: await r.json() }));

  console.log("🧪 1. 動態 Token＋AC-1 逾期");
  const tr = await get("/api/student/checkin-token/bk1");
  ok(tr.status === 200 && tr.body.token.startsWith("zk_") && tr.body.expires_in_seconds <= 30, "取得 30 秒動態 Token", tr.body);
  const old = checkin.makeToken("bk1", "stu", checkin.windowNow() - 2);
  const expired = await post("/api/coach/verify-checkin", { checkin_token: old, scanner_lat: 22.2783, scanner_lng: 114.1722 }, tokenCoach);
  ok(expired.status === 400 && expired.body.code === "TOKEN_EXPIRED", "45 秒前舊 Token → TOKEN_EXPIRED", expired);

  console.log("🧪 2. 近距離核銷＋AC-2 防重");
  const v1 = await post("/api/coach/verify-checkin", { checkin_token: tr.body.token, scanner_lat: 22.2783, scanner_lng: 114.1722, device_hash: "dev1" }, tokenCoach);
  ok(v1.status === 200 && v1.body.attendance_status === "present" && v1.body.fraud_audit_status === "clean", "近距離核銷成功", v1.body);
  ok(v1.body.settled === true, "即時觸發結算");
  const bk1 = db.prepare("SELECT status,attendance_status,checkin_method,fraud_audit_status FROM bookings WHERE id='bk1'").get();
  ok(bk1.status === "attended" && bk1.attendance_status === "present" && bk1.checkin_method === "dynamic_qr", "booking 狀態／方法正確");
  const earn1 = db.prepare("SELECT net_amount FROM coach_earnings WHERE schedule_id='sch-c1'").get();
  ok(earn1 && Number(earn1.net_amount) === 112, "80% = HK$112", earn1);
  const dup = await post("/api/coach/verify-checkin", { checkin_token: tr.body.token, scanner_lat: 22.2783, scanner_lng: 114.1722 }, tokenCoach);
  ok(dup.status === 409 && dup.body.code === "ALREADY_CHECKED_IN", "第二次掃碼 → 409", dup);

  console.log("🧪 3. AC-3 地理圍欄");
  const t3 = checkin.makeToken("bk3", "stu3");
  const far = await post("/api/coach/verify-checkin", { checkin_token: t3, scanner_lat: 22.2904, scanner_lng: 114.1722 }, tokenCoach);
  ok(far.status === 200 && far.body.attendance_status === "present", "遠距仍記錄出席", far.body);
  ok(far.body.fraud_audit_status === "flagged_distance" && far.body.distance_meters > 1200, "1.2km → flagged_distance", far.body);
  ok(far.body.settled === false, "不觸發結算");
  ok(!!db.prepare("SELECT 1 FROM checkin_audit_incidents WHERE booking_id='bk3' AND incident_type='excessive_distance'").get(), "寫入審計事故");
  ok(!db.prepare("SELECT 1 FROM coach_earnings WHERE schedule_id='sch-c3'").get(), "無教練收益分錄");

  console.log("🧪 4. AC-4 無人門店 PIN");
  db.prepare("INSERT INTO merchant_studios (id,owner_user_id,studio_name,district,address,contact_phone,latitude,longitude,status) VALUES ('std1','coach','Studio 1','灣仔','地址','60009001',22.2783,114.1722,'active')").run();
  db.prepare("INSERT INTO studio_access_configs (id,studio_id,access_type,totp_secret,geo_fence_radius_meters) VALUES ('ac1','std1','dynamic_pin','door-secret-1',150)").run();
  db.prepare("UPDATE class_schedules SET studio_id='std1' WHERE id='sch-c2'").run();
  const pinr = await get("/api/student/door-pin/bk2", token("stu2"));
  ok(pinr.status === 200 && /^\d{6}$/.test(pinr.body.pin), "取得 6 位動態 PIN", pinr.body);
  const unlock = await post("/api/student/door-unlock", { booking_id: "bk2", pin: pinr.body.pin }, token("stu2"));
  ok(unlock.status === 200 && unlock.body.unlocked === true, "PIN 解鎖成功", unlock);
  const badPin = await post("/api/student/door-unlock", { booking_id: "bk2", pin: "000000" }, token("stu2"));
  ok(badPin.status === 400 && badPin.body.code === "PIN_INVALID", "錯 PIN 拒絕");

  console.log("🧪 5. 前端與遷移");
  const fs = require("fs");
  const hb = fs.readFileSync(path.join(__dirname, "../../frontend-v2/student-handbook.html"), "utf8");
  ok(/checkin-token/.test(hb) && /QRCode/.test(hb), "手冊有動態 QR 組件");
  const cs = fs.readFileSync(path.join(__dirname, "../../frontend-v2/coach-scanner.html"), "utf8");
  ok(/html5-qrcode/.test(cs) && /verify-checkin/.test(cs), "掃碼頁已接 API");
  const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  ok(cols.includes("fraud_audit_status") && cols.includes("checkin_lat") && cols.includes("checkin_method"), "bookings 安全欄位齊");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  server.close(() => process.exit(bad === 0 ? 0 : 1));
});
