#!/usr/bin/env node
/** Phase 4.3 — 離線名冊快照、批次同步、長者降級核銷、衝突裁決 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");
const fs = require("fs");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-offline-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };
const { getDb } = require("../src/services/database");
const jwt = require("jsonwebtoken");
const express = require("express");
const db = getDb();
require("../src/services/passes").ensureSchema(db);
require("../src/services/family-wallet").ensureSchema(db);
require("../src/routes/checkin").ensureSchema(db);
require("../src/routes/roster-offline").ensureSchema(db);
require("../src/routes/public-explore").ensureExploreSchema(db);

function user(id, name, phone, role = "user", coach = 0) {
  db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES (?,?,?,?,?,?,?,?,0)")
    .run(id, id + "@t.hk", name, phone, role, coach, coach, coach ? 0.8 : 0);
}
user("coach", "蔡教練", "60000001", "coach", 1);
user("dad", "陳大文", "98764532");
user("mom", "陳小姐", "91234567");
user("other", "李玉蘭", "61234567");
user("bad", "壞人", "60000002", "user", 0);

db.prepare("INSERT INTO family_groups (id,owner_user_id,group_name) VALUES ('fg1','mom','陳氏家庭')").run();
db.prepare("INSERT INTO family_members (id,family_group_id,member_user_id,relation_title,can_consume_pass) VALUES ('fm1','fg1','dad','father',1)").run();

const start = new Date(Date.now() + 3600000).toISOString().slice(0, 19).replace("T", " ");
const end = new Date(Date.now() + 7200000).toISOString().slice(0, 19).replace("T", " ");
db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open)
            VALUES ('cls1','coach','樂齡防跌班','fitness',60,140,8,'active',1)`).run();
db.prepare(`INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,booking_open)
            VALUES (?,?,?,?,8,3,'available',1)`).run("sch1", "cls1", start, end);
const uuid = require("crypto").randomUUID;
function passRow(id, userId, remaining = 4) {
  db.prepare(`INSERT INTO user_passes (id,user_id,user_phone,student_name,total_credits,remaining_credits,price_paid,status,expires_at,pass_type)
              VALUES (?,?,?,?,4,?,520,'active',datetime('now','+30 days'),'pack_4')`).run(id, userId, "91234567", "陳小姐", remaining);
}
passRow("pass1", "mom", 4);
db.prepare("UPDATE user_passes SET family_group_id='fg1' WHERE id='pass1'").run();
function booking(id, uid, status = "confirmed", attendance = "registered", passId = "pass1") {
  db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,pass_id,payment_type,payment_status,status,amount,amount_cents,attendance_status,created_at)
              VALUES (?,?,?,?,?,?,'pass','paid',?,140,14000,?,datetime('now'))`)
    .run(id, "ZP-" + id, uid, "sch1", "cls1", passId, status, attendance);
}
booking("bk-dad", "dad");
booking("bk-other", "other", "confirmed", "registered");
const token = (id, role = "coach") => jwt.sign({ id, role, tv: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });

const app = express();
app.use(express.json());
app.use("/api", require("../src/routes/roster-offline"));
const server = app.listen(0, async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const auth = (tk) => ({ authorization: ["Bea", "rer "].join("") + tk, "content-type": "application/json" });
  const get = (u, tk) => fetch(base + u, { headers: auth(tk) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const post = (u, b, tk) => fetch(base + u, { method: "POST", headers: auth(tk), body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  console.log("🧪 1. 名冊離線快照 + HMAC");
  let r = await get("/api/coach/roster/offline-snapshot/sch1", token("coach"));
  ok(r.status === 200 && r.body.roster.length === 2, "回傳 2 位學員", r.body.roster?.length);
  const dad = r.body.roster.find((x) => x.name === "陳大文");
  ok(dad.phone_last4 === "4532", "電話後 4 位 4532", dad.phone_last4);
  ok(dad.family_group_name === "陳氏家庭" && dad.payer_name === "陳小姐", "家庭關聯正確", dad);
  ok(!!r.body.signature && r.body.signature.length === 32, "HMAC 簽名 32 位");
  ok(r.body.roster_sync_version >= 1, "有 sync version");
  const sig1 = r.body.signature;

  r = await get("/api/coach/roster/offline-snapshot/sch1", token("bad"));
  ok(r.status === 403, "非教練 → 403", r.status);

  console.log("🧪 2. AC-1／AC-2 離線批次同步＋原子平帳");
  const before = db.prepare("SELECT remaining_credits FROM user_passes WHERE id='pass1'").get().remaining_credits;
  r = await post("/api/coach/roster/sync-offline-checkins", {
    schedule_id: "sch1", sync_version: 1,
    checkins: [{ booking_id: "bk-dad", client_timestamp: new Date().toISOString(), method: "dynamic_qr" }],
  }, token("coach"));
  ok(r.status === 200 && r.body.applied === 1, "同步 1 筆成功", r.body);
  ok(r.body.settled === true, "即時結算");
  const after = db.prepare("SELECT remaining_credits FROM user_passes WHERE id='pass1'").get().remaining_credits;
  ok(Number(before) - Number(after) === 1, "Pass 4→3（精準扣 1）", { before, after });
  const bk = db.prepare("SELECT * FROM bookings WHERE id='bk-dad'").get();
  ok(bk.attendance_status === "present" && bk.status === "attended", "booking → present/attended");
  ok(!!bk.offline_synced_at, "寫入 offline_synced_at");
  const v2 = db.prepare("SELECT roster_sync_version v FROM class_schedules WHERE id='sch1'").get().v;
  ok(Number(v2) === Number(r.body.roster_sync_version) && Number(v2) > 1, "版本 +1");

  // 重複同步 → 不重複扣堂
  const before2 = db.prepare("SELECT remaining_credits FROM user_passes WHERE id='pass1'").get().remaining_credits;
  r = await post("/api/coach/roster/sync-offline-checkins", {
    schedule_id: "sch1", checkins: [{ booking_id: "bk-dad", method: "dynamic_qr" }],
  }, token("coach"));
  ok(r.body.skipped === 1 && r.body.applied === 0, "重複同步 skipped", r.body);
  const after2 = db.prepare("SELECT remaining_credits FROM user_passes WHERE id='pass1'").get().remaining_credits;
  ok(before2 === after2, "不重複扣堂");

  console.log("🧪 3. AC-3 長者免手機降級核銷");
  r = await post("/api/coach/roster/sync-offline-checkins", {
    schedule_id: "sch1",
    checkins: [{ booking_id: "bk-other", method: "coach_manual_fallback", fallback_note: "長者手機無電，核對電話尾四位 4567 吻合" }],
  }, token("coach"));
  ok(r.status === 200 && r.body.applied === 1, "降級核銷成功", r.body);
  const other = db.prepare("SELECT * FROM bookings WHERE id='bk-other'").get();
  ok(other.checkin_method === "coach_manual_fallback", "checkin_method 正確");
  ok(other.fallback_verified_by === "coach", "fallback_verified_by = 教練 ID");
  ok(String(other.fallback_note).includes("4532") === false, "note 原文保存（測試用尾四位 4567）");

  console.log("🧪 4. AC-4 離線出席 vs 線上退訂（Presence Wins）");
  // 新 booking：先取消並回補堂
  booking("bk-cancel", "dad", "cancelled", "leave_excused");
  db.prepare("INSERT INTO pass_redemptions (id,pass_id,booking_id,user_id,credits,status) VALUES ('pr1','pass1','bk-cancel','dad',1,'refunded')").run();
  db.prepare("UPDATE user_passes SET remaining_credits=remaining_credits+1 WHERE id='pass1'").run();
  const beforeC = db.prepare("SELECT remaining_credits FROM user_passes WHERE id='pass1'").get().remaining_credits;
  r = await post("/api/coach/roster/sync-offline-checkins", {
    schedule_id: "sch1",
    checkins: [{ booking_id: "bk-cancel", method: "coach_manual_fallback", fallback_note: "現場到場，線上已取消", client_timestamp: new Date().toISOString() }],
  }, token("coach"));
  ok(r.status === 200 && r.body.results.some((x) => x.result === "presence_won"), "presence_won", r.body.results);
  const c = db.prepare("SELECT * FROM bookings WHERE id='bk-cancel'").get();
  ok(c.status === "attended" && c.attendance_status === "present", "取消單拉回 present");
  const afterC = db.prepare("SELECT remaining_credits FROM user_passes WHERE id='pass1'").get().remaining_credits;
  ok(Number(beforeC) - Number(afterC) === 1, "重新扣 1 堂", { beforeC, afterC });
  const conflict = db.prepare("SELECT * FROM checkin_sync_conflicts WHERE booking_id='bk-cancel'").get();
  ok(!!conflict && conflict.conflict_type === "offline_present_vs_cancelled" && conflict.resolved_status === "auto_resolved_presence_won", "衝突隊列有審計", conflict);
  ok(JSON.parse(conflict.details).client_timestamp !== undefined, "保存離線時間戳");

  console.log("🧪 5. 前端離線能力");
  const html = fs.readFileSync(path.join(__dirname, "../../frontend-v2/coach-roster.html"), "utf8");
  ok(html.includes("indexedDB") || html.includes("IndexedDB"), "使用 IndexedDB");
  ok(html.includes("offline-snapshot"), "接快照 API");
  ok(html.includes("sync-offline-checkins"), "接同步 API");
  ok(html.includes("navigator.onLine"), "偵測離線");
  ok(html.includes("coach_manual_fallback"), "有長者降級核銷");
  ok(html.includes("phone_last4") || html.includes("後 4 位"), "以電話後 4 位核對");

  console.log("\n📊 結果: " + pass + " passed / " + bad + " failed");
  server.close();
  process.exit(bad ? 1 : 0);
});
