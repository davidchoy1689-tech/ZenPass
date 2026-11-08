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

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
