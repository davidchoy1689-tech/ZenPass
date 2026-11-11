#!/usr/bin/env node
/** Phase 2.6 — Buddy Pass 拼團、雙向發卡、超時退款 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-phase26-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };
const { getDb } = require("../src/services/database");
const buddy = require("../src/routes/buddy");
const passes = require("../src/services/passes");
const coachAffiliate = require("../src/services/coach-affiliate");
const { bindStudent } = coachAffiliate;
const { syncCoachEarningsForSchedule } = require("../src/routes/coach-earnings");
const db = getDb();
buddy.ensureSchema(db);
passes.ensureSchema(db);
coachAffiliate.ensureSchema(db);
require("../src/routes/coach-scheduling").ensureSchedulingSchema(db);
require("../src/routes/public-explore").ensureExploreSchema(db);

function addUser(id, name, phone, coach = 0) {
  db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified) VALUES (?,?,?,?,?,?,?)")
    .run(id, id + "@t.hk", name, phone, coach ? "coach" : "user", coach, coach ? 1 : 0);
}
addUser("alice", "陳大文", "60006001");
addUser("bob", "李小明", "60006002");
addUser("coachA", "蔡教練", "60006003", 1);
bindStudent(db, "alice", "coachA");

const expires = new Date(Date.now() + 12 * 3600000).toISOString().slice(0, 19).replace("T", " ");
db.prepare(`INSERT INTO buddy_groups (id,initiator_user_id,plan_key,price_per_person_cents,status,share_token,payment_intent_id,expires_at)
            VALUES ('bg1','alice','buddy_pack_4',46000,'pending','tok_buddy_1','pi_buddy_a',?)`).run(expires);

console.log("🧪 1. AC-1 防自我成團");
const self = buddy.completeGroup(db, { token: "tok_buddy_1", partnerUserId: "alice", partnerPaymentIntentId: "pi_self" });
ok(!self.ok && self.code === "CANNOT_JOIN_OWN_GROUP", "本人不可加入自己的拼團", self);

console.log("🧪 2. AC-2 雙向原子發卡");
const done = buddy.completeGroup(db, { token: "tok_buddy_1", partnerUserId: "bob", partnerPaymentIntentId: "pi_buddy_b" });
ok(done.ok && !done.duplicated, "成團成功", done);
const g = db.prepare("SELECT * FROM buddy_groups WHERE id='bg1'").get();
ok(g.status === "completed" && g.partner_user_id === "bob" && g.completed_at, "group completed");
const pa = db.prepare("SELECT * FROM user_passes WHERE payment_intent_id='buddy_bg1_a'").get();
const pb = db.prepare("SELECT * FROM user_passes WHERE payment_intent_id='buddy_bg1_b'").get();
ok(pa && pb && Number(pa.remaining_credits) === 4 && Number(pb.remaining_credits) === 4, "雙方各 4 堂");
ok(pa.user_id === "alice" && pb.user_id === "bob", "Pass 歸屬正確");
const daysA = (new Date(pa.expires_at.replace(" ", "T") + "Z") - Date.now()) / 86400000;
ok(daysA > 59 && daysA <= 60, "有效期 60 天");
ok(Number(pa.price_paid) === 460 && pa.pass_type === "buddy_pack_4", "實付 HK$460、buddy_pack_4");
ok(!!db.prepare("SELECT 1 FROM referral_rewards WHERE referrer_user_id='alice' AND referred_user_id='bob'").get(), "寫入轉介獎勵");
const again = buddy.completeGroup(db, { token: "tok_buddy_1", partnerUserId: "bob", partnerPaymentIntentId: "pi_buddy_b" });
ok(again.ok && again.duplicated, "重複完成回傳原結果，不重複發卡");
ok(db.prepare("SELECT COUNT(*) c FROM user_passes WHERE payment_intent_id IN ('buddy_bg1_a','buddy_bg1_b')").get().c === 2, "只有兩張 Pass");

console.log("🧪 3. AC-3 超時自動退款");
const old = new Date(Date.now() - 3600000).toISOString().slice(0, 19).replace("T", " ");
db.prepare(`INSERT INTO buddy_groups (id,initiator_user_id,plan_key,price_per_person_cents,status,share_token,payment_intent_id,expires_at)
            VALUES ('bg2','alice','buddy_pack_4',46000,'pending','tok_buddy_2','pi_expired',?)`).run(old);
const refunded = [];
const cleanup = buddy.cleanupExpired(db, (pi) => refunded.push(pi));
ok(cleanup.processed === 1 && refunded.includes("pi_expired"), "呼叫 Stripe 退款", cleanup);
ok(db.prepare("SELECT status FROM buddy_groups WHERE id='bg2'").get().status === "expired", "狀態 expired");
ok(!db.prepare("SELECT 1 FROM user_passes WHERE payment_intent_id LIKE 'buddy_bg2_%'").get(), "無殘留死 Pass");

console.log("🧪 4. AC-4 教練 80% 基數不受折損");
db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open,district,venue_name)
            VALUES ('c-buddy','coachA','防跌班','fitness',60,140,8,'active',1,'葵青','葵芳體育館')`).run();
const start = new Date(Date.now() + 48 * 3600000).toISOString().slice(0, 19).replace("T", " ");
const end = new Date(Date.now() + 49 * 3600000).toISOString().slice(0, 19).replace("T", " ");
db.prepare(`INSERT INTO class_schedules (id,class_id,coach_id,start_time,end_time,max_participants,enrolled_count,status,booking_open,district)
            VALUES ('s-buddy','c-buddy','coachA',?,?,8,1,'available',1,'葵青')`).run(start, end);
db.prepare(`INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount,group_size,pass_id,created_at)
            VALUES ('bk-buddy','ZP-BUDDY','alice','s-buddy','c-buddy','pass','paid','attended',0,1,?,datetime('now'))`).run(pa.id);
passes.redeemUnitsInTx(db, { passId: pa.id, bookingId: "bk-buddy", userId: "alice", units: 1 });
syncCoachEarningsForSchedule("s-buddy");
const earn = db.prepare("SELECT net_amount,gross_amount FROM coach_earnings WHERE schedule_id='s-buddy'").get();
ok(earn && Number(earn.gross_amount) === 140 && Number(earn.net_amount) === 112, "教練 80% = HK$112（按 $140 基數）", earn);

console.log("🧪 5. AC-5 隔離與前端");
const fs = require("fs");
const ex = fs.readFileSync(path.join(__dirname, "../../frontend-v2/pass.html"), "utf8");
ok(/二人同行/.test(ex) && /buddy\/create-group/.test(ex), "pass.html 有 Buddy 拼團選項");
const page = fs.readFileSync(path.join(__dirname, "../../frontend-v2/buddy.html"), "utf8");
ok(/buddy\/.*\/join/.test(page) && /WhatsApp/.test(page) && /buddy\/complete-join/.test(page), "buddy.html 有分享／參團／回跳");
const route = fs.readFileSync(path.join(__dirname, "../src/routes/buddy.js"), "utf8");
ok(/buddy_group\.completed_both_issued/.test(route), "拼團完成有審計紀錄");
const exploreRoute = fs.readFileSync(path.join(__dirname, "../src/routes/public-explore.js"), "utf8");
ok(/NOT LIKE 'prodtest-%'/.test(exploreRoute) && /VERIFIED_TEST%/.test(exploreRoute), "正式探索／對賬沿用 prodtest 隔離");

console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
