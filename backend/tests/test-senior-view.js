/**
 * 長者大字版 + 子女安心時間軸（純前端）
 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "..", "frontend-v2");
const sv = fs.readFileSync(path.join(F, "senior-view.html"), "utf8");
const mb = fs.readFileSync(path.join(F, "my-bookings.html"), "utf8");
const bk = fs.readFileSync(path.join(F, "booking.html"), "utf8");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

console.log("\n🧪 1. 長者大字版規格");
{
  ok("日期 34px（≥26pt）", /\.date\{ font-size:34px/.test(sv));
  ok("地點 26px（≥20pt）", /\.place\{ font-size:26px/.test(sv));
  ok("提示 20px", /\.tip\{ font-size:20px/.test(sv));
  ok("QR 佔 70vw（上限 320px）", /width:min\(70vw,320px\)/.test(sv));
  ok("高對比粗黑邊框", /border:3px solid #0b1220/.test(sv));
  ok("特大紅色致電按鈕（68px 高）", /\.call\{[\s\S]{0,220}min-height:68px/.test(sv) && /background:#dc2626/.test(sv));
  ok("tel: 直撥", /href = "tel:" \+ tel\(c\.emergency_phone\)/.test(sv));
  ok("顯示緊急聯絡人卡片", /🆘 有需要打畀/.test(sv));
  ok("guest token 取數", /guest\/booking-card\?token=\$\{tok\}/.test(sv));
  ok("會員用 card API", /\/api\/bookings\/" \+ encodeURIComponent\(ID\) \+ "\/card"/.test(sv));
  ok("demo 預覽", /DEMO_CARD/.test(sv) && /"demo"\) === "1"/.test(sv));
  ok("wake lock（保持螢幕）", /wakeLock/.test(sv));
  ok("讀取失敗有指示", /請叫仔女再傳一次連結/.test(sv));
}

console.log("\n🧪 2. 子女安心時間軸");
{
  ok("三格時間軸樣式", /\.tl\{display:flex/.test(mb) && (mb.match(/class="st /g) || []).length >= 3);
  ok("已鎖定席位（綠）", /已鎖定席位/.test(mb));
  ok("簽到狀態：已簽到顯示時間", /已簽到/.test(mb) && /hktTime\(b\.checked_in_at\)/.test(mb));
  ok("未簽到：待長者到達", /待長者到達/.test(mb));
  ok("過堂未簽到：待確認", /待確認簽到/.test(mb));
  ok("課後反饋格存在", /課後反饋/.test(mb));
  ok("取消／待付款唔顯示時間軸", /if \(b\.status === "cancelled" \|\| b\.status === "pending_payment"\) return ""/.test(mb));
  ok("長者大字版連結", /senior-view\.html\?id=/.test(mb));
  ok("WhatsApp 提醒（含連結）", /傳提醒給父母/.test(mb) && /wa\.me\/\?text=/.test(mb));
}

console.log("\n🧪 3. 付款成功頁入口");
{
  ok("有 seniorViewBtn", /id="seniorViewBtn"/.test(bk));
  ok("文案：長者大字版（傳給父母）", /長者大字版（傳給父母）/.test(bk));
  ok("帶 booking id + guest token", /senior-view\.html\?id=" \+ encodeURIComponent\(firstId\) \+ suffix/.test(bk));
  ok("單筆預約才顯示", /payIds\.length <= 1/.test(bk));
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
