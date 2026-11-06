/**
 * 五大角色 UI（成人票券 / 課後速評 / 名冊類型標籤）
 * 純前端部分 + 後端接線靜態檢查
 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "..", "frontend-v2");
const B = path.join(__dirname, "..", "src");

const ap = fs.readFileSync(path.join(F, "adult-pass.html"), "utf8");
const mb = fs.readFileSync(path.join(F, "my-bookings.html"), "utf8");
const cc = fs.readFileSync(path.join(F, "coach-checkin.html"), "utf8");
const rp = fs.readFileSync(path.join(F, "roster-print.html"), "utf8");
const bk = fs.readFileSync(path.join(F, "booking.html"), "utf8");
const api = fs.readFileSync(path.join(B, "routes", "coach-checkin.js"), "utf8");
const card = fs.readFileSync(path.join(B, "services", "senior-card.js"), "utf8");
const notif = fs.readFileSync(path.join(B, "services", "notification.js"), "utf8");
const roster = fs.readFileSync(path.join(B, "services", "admin-roster.js"), "utf8");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

console.log("\n🧪 1. 成人電子票券 adult-pass.html");
{
  ok("深綠票券主題", /--forest:#0b3b2a/.test(ap) && /radial-gradient/.test(ap));
  ok("撕線視覺", /\.tear:before/.test(ap) && /dashed/.test(ap));
  ok("QR 票券", /class="qr"/.test(ap) && /zenpass:checkin/.test(ap));
  ok("加入日曆（.ics Blob）", /BEGIN:VCALENDAR/.test(ap) && /text\/calendar/.test(ap));
  ok("ics 帶 TZID Asia/Hong_Kong", /DTSTART;TZID=Asia\/Hong_Kong:/.test(ap));
  ok("ics 有 DTEND（用 end_time）", /DTEND;TZID=Asia\/Hong_Kong:/.test(ap) && /c\.end_time/.test(ap));
  ok("ics 有 2 小時前提醒", /TRIGGER:-PT2H/.test(ap));
  ok("Google 地圖（座標優先）", /google\.com\/maps\/search\/\?api=1&query=\$\{c\.venue_lat\}/.test(ap));
  ok("上堂前準備提示", /自備毛巾、水樽/.test(ap));
  ok("guest / 會員 / demo 三路取數", /guest\/booking-card/.test(ap) && /\/card"/.test(ap) && /DEMO_CARD/.test(ap));
}

console.log("\n🧪 2. 後端支援");
{
  ok("card API 回傳 end_time", /end_time: ends\.time/.test(card));
  ok("card API 回傳經緯度", /venue_lat: b\.latitude/.test(card) && /venue_lng: b\.longitude/.test(card));
  ok("bookings 自動加 coach_tags 欄", /\["coach_tags", "TEXT"\]/.test(api) && /coach_tags_at/.test(api));
  ok("POST /coach/checkin/tags", /router\.post\("\/coach\/checkin\/tags"/.test(api));
  ok("只接受 3 個白名單標籤", /TAG_KEYS = \["energetic", "moves_well", "tight"\]/.test(api));
  ok("跨班 booking 會被拒", /b\.schedule_id !== ctx\.schedule\.id/.test(api));
  ok("寫 audit_log", /coach\.feedback/.test(api));
  ok("通知模板 coach.feedback", /case "coach\.feedback"/.test(notif));
  ok("舊 DB 冇 coach_tags 都讀到名冊", /NULL AS coach_tags/.test(api));
  ok("名冊 API 分樂齡／成人", /is_senior: String\(r\.attendee_type/.test(roster));
}

console.log("\n🧪 3. 導師課後速評 UI");
{
  ok("3 個標籤齊", /😊 精神好/.test(cc) && /💪 動作跟到/.test(cc) && /⚠️ 筋膜偏緊/.test(cc));
  ok("只對已出席學員顯示", /g\.attended > 0 \?/.test(cc));
  ok("可切換（再撳取消）", /includes\(k\) \? g\.coach_tags\.filter/.test(cc));
  ok("最多 3 個", /slice\(0, 3\)/.test(cc));
  ok("一鍵提交全部", /submitTags/.test(cc) && /for \(const g of list\)/.test(cc));
  ok("提交後清 dirty 並提示", /g\.__dirty = false/.test(cc) && /已提交/.test(cc));
  ok("唔會干擾原有簽到", /data-act="in"/.test(cc) && /data-tag=/.test(cc));
}

console.log("\n🧪 4. 子女端看到評語 + 成人票券入口");
{
  ok("my-bookings 顯示導師評語", /導師評語：/.test(mb) && /精神好/.test(mb));
  ok("my-bookings 電子票券入口", /adult-pass\.html\?id=/.test(mb));
  ok("付款成功頁電子票券入口", /id="adultPassBtn"/.test(bk) && /我的電子票券/.test(bk));
  ok("名冊顯示 🧓／🧑 標籤", /🧓 樂齡/.test(rp) && /🧑 成人/.test(rp));
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
