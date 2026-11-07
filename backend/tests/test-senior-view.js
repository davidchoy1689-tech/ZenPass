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
  ok("tel: 直撥", /href = "tel:" \+ tel\(c\.emergency_phone\)/.test(sv) || /href = "tel:" \+ tel\(ephone\)/.test(sv));
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

console.log("\n🧪 7. 🌸 老友記同行推薦（純 DOM/CSS + wa.me）");
{
  ok("推薦卡存在", /class="elder-referral"/.test(sv));
  ok("放在 QR／預約編號之後", sv.indexOf('class="elder-referral"') > sv.indexOf('class="qrwrap"'));
  ok("溫潤杏黃漸變", /linear-gradient\(135deg,\s*#FFF9E6\s*0%,\s*#FFF2CC\s*100%\)/i.test(sv));
  ok("2px #E6B800 邊框 + 16px 圓角 + 20px padding",
    /border\s*:\s*2px\s+solid\s+#E6B800/i.test(sv) && /border-radius\s*:\s*16px/.test(sv) && /padding\s*:\s*20px/.test(sv));
  ok("標題 20pt 級（26px）＋祝賀字句", /祝老友記健康常伴・一齊做拉筋/.test(sv) && /er-title\{[^}]*font-size\s*:\s*26px/.test(sv));
  ok("內文提到膝頭／靜儀／平 $30", /膝頭緊/.test(sv) && /靜儀教練/.test(sv) && /平 \$30/.test(sv));
  ok("推薦碼標籤 SILVER2", /【老友記推薦碼：SILVER2】/.test(sv));
  ok("WhatsApp 大掣 56px / #25D366", /min-height\s*:\s*56px/.test(sv) && /#25D366/.test(sv) && /撳呢度傳畀老友記（WhatsApp）/.test(sv));
  ok("截圖提示", /直接截圖呢個畫面/.test(sv));
  ok("用 wa.me deep link", /https:\/\/wa\.me\/\?text=/.test(sv) && /encodeURIComponent\(msg\)/.test(sv));
  ok("訊息含 SILVER2 連結", /booking\.html\?ref=elder_share&code=SILVER2/.test(sv));
  ok("訊息有祝賀語 + emoji", /祝各位老友記身體健康/.test(sv) && /長命百歲/.test(sv));
  ok("零 Canvas／零截圖庫", !/<canvas[\s>]/i.test(sv) && !/html2canvas/i.test(sv));
  ok("有 reduced-motion 守衛（沿用）", /prefers-reduced-motion/.test(sv));
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
