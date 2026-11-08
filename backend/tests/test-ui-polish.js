/**
 * 全面打磨：長者端亮色鎖定／子女分享文案／教練強光模式／票券凹槽（純前端）
 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "..", "frontend-v2");
const sv = fs.readFileSync(path.join(F, "senior-view.html"), "utf8");
const mb = fs.readFileSync(path.join(F, "my-bookings.html"), "utf8");
const cc = fs.readFileSync(path.join(F, "coach-checkin.html"), "utf8");
const ap = fs.readFileSync(path.join(F, "adult-pass.html"), "utf8");
const book = fs.readFileSync(path.join(F, "booking.html"), "utf8");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

console.log("\n🧪 1. 長者端亮色鎖定 + 大字防破版");
{
  ok("meta color-scheme light only", /<meta name="color-scheme" content="light only"/.test(sv));
  ok(":root color-scheme:light only", /:root\{ color-scheme:light only;/.test(sv));
  ok("body text-size-adjust 100%", /-webkit-text-size-adjust:100%;\s*\n\s*text-size-adjust:100%;/.test(sv));
  ok("推薦卡 text-size-adjust 100%", /\.elder-referral\{[\s\S]*?text-size-adjust:100%;/.test(sv));
  ok("推薦卡 padding 用 clamp(12px,4vw,20px)", /padding:clamp\(12px,4vw,20px\)/.test(sv));
  ok("優惠碼／WhatsApp 按鈕用 clamp 邊距", /padding:8px clamp\(12px,4vw,20px\)/.test(sv) && /padding:10px clamp\(12px,4vw,20px\)/.test(sv));
}

console.log("\n🧪 2. 子女端分享文案包裝");
{
  ok("大字版含「爸爸/媽媽」引導句", /爸爸\/媽媽，呢個係你嘅專屬大字入場卡/.test(mb));
  ok("票券含友善說明", /這是您的專屬電子票券連結（含入場 QR Code 與日曆提醒）/.test(mb));
  ok("剪貼簿寫入完整訊息（唔再只係 URL）", /navigator\.clipboard\.writeText\(text\)/.test(mb));
  ok("Toast 提示同步更新", /已複製專屬長者大字版說明與連結/.test(mb));
  ok("剪貼簿失敗仍有手動複製 fallback", /prompt\("請手動複製以下訊息：", text\)/.test(mb));
}

console.log("\n🧪 3. 教練端強光模式");
{
  ok("工具列有 ☀️ 強光模式按鈕", /id="hcBtn"[\s\S]{0,200}強光模式/.test(cc));
  ok("body.high-contrast-mode 黑底白字", /body\.high-contrast-mode\{ background:#000 !important; color:#fff !important \}/.test(cc));
  ok("學員卡黑底金框", /body\.high-contrast-mode \.card\{[\s\S]*?background:#111111 !important; border:2px solid #FFD700 !important/.test(cc));
  ok("舊患標籤紅底白字 900", /body\.high-contrast-mode \.warn\{[\s\S]*?background:#FF0000 !important; color:#FFFFFF !important;[\s\S]*?font-weight:900 !important/.test(cc));
  ok("localStorage 記憶 coach_high_contrast", /HCKEY = "coach_high_contrast"/.test(cc) && /localStorage\.getItem\(HCKEY\) === "1"/.test(cc));
  ok("按鈕文字切換 正常模式／強光模式", /正常模式/.test(cc) && /強光模式/.test(cc));
}

console.log("\n🧪 4. 成人票券 Passbook 凹槽");
{
  ok(".pass 有 ticket-notch 標記", /class="pass ticket-notch"/.test(ap));
  ok("::before / ::after 20px 圓形", /\.ticket-notch::before, \.ticket-notch::after\{[\s\S]*?width:20px; height:20px; border-radius:50%/.test(ap));
  ok("左右各 -10px 凹入", /\.ticket-notch::before\{ left:-10px \}/.test(ap) && /\.ticket-notch::after\{ right:-10px \}/.test(ap));
  ok("位於 65% 條碼交界", /top:65%/.test(ap));
  ok("零圖片／零 canvas", !/background-image:\s*url\(/i.test(ap) && !/<canvas[\s>]/i.test(ap));
}

console.log("\n🧪 5. 報名頁席位緊張度");
{
  ok("進度條容器 .seat-urgency-wrapper", /\.seat-urgency-wrapper\{/.test(book));
  ok("熱門徽章 + 餘額文案", /seat-badge-hot/.test(book) && /僅餘 <strong>/.test(book));
  ok("滿額顯示候補入口", /可入候補名單/.test(book) && /detail\.html\?id=/.test(book));
  ok("滿額班次 checkbox disabled", /\$\{full\?"disabled":""\}/.test(book));
  ok("百分比按 max_participants / enrolled_count 計算", /Number\(s\.enrolled_count \|\| 0\) \/ cap/.test(book));
  ok("≤2 席切 critical、滿額切 full", /left <= 2 \? "critical"/.test(book) && /left === 0 \? "full"/.test(book));
  ok("全選唔會揀滿額班", /filter\(s => seatsLeft\(s\) > 0\)/.test(book));
  ok("reduced-motion 關進度動畫", /prefers-reduced-motion: reduce\)\{ \.seat-progress-fill\{ transition:none/.test(book));
}

console.log("\n🧪 6. 付款頁 FPS 一鍵複製");
{
  ok("FPS 互動卡 .fps-copy-box", /class="fps-copy-box"/.test(book));
  ok("顯示 9492 5828 + 戶名", /id="fps-identifier">9492 5828</.test(book) && /戶名：ZenPass/.test(book));
  ok("複製按鈕寫入純數字", /id="btn-copy-fps" data-copy="94925828"/.test(book));
  ok("成功率 Toast 文案", /已複製 FPS 號碼：9492 5828/.test(book));
  ok("按鈕 1.5 秒後復原 + 深綠反饋", /setTimeout\(\(\) => \{ btn\.textContent = old; btn\.classList\.remove\("copied"\); \}, 1500\)/.test(book));
  ok("execCommand 降級仍在", /document\.execCommand\("copy"\)/.test(book));
  ok("FPS QR payload 用新號碼", /tlv\("01", "94925828"\)/.test(book));
  ok("客服 WhatsApp 仍然係 9033 5538", /wa\.me\/85290335538/.test(book) && /WhatsApp <b>9033 5538<\/b>/.test(book));
  ok("舊 FPS 收款號碼已清走", !/data-copy="90335538"/.test(book));
}

console.log("\n🧪 7. 預約流程回歸（rememberWaiver 修正）");
{
  ok("rememberWaiver 有定義", /function rememberWaiver\(\) \{/.test(book));
  ok("仍然會記住免責同意", /localStorage\.setItem\("zenpass_waiver_agreed", "true"\)/.test(book));
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
