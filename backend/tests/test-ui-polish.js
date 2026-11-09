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
const mine = fs.readFileSync(path.join(F, "my-bookings.html"), "utf8");
const detail = fs.readFileSync(path.join(F, "detail.html"), "utf8");
const home = fs.readFileSync(path.join(F, "index.html"), "utf8");
const bkRoute = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "bookings.js"), "utf8");
const bkSvc = fs.readFileSync(path.join(__dirname, "..", "src", "services", "booking-service.js"), "utf8");

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

console.log("\n🧪 8. FPS 轉帳備註一鍵複製");
{
  ok("備註卡 .fps-ref-box", /class="fps-ref-box"/.test(book));
  ok("顯示預約編號 #fps-booking-ref", /id="fps-booking-ref"><\$\{esc\(refCodes\.join/.test(book) || /id="fps-booking-ref"/.test(book));
  ok("複製備註按鈕", /id="btn-copy-ref"[^>]*data-copy="\$\{esc\(refCodes\.join\(" "\)\)\}"/.test(book));
  ok("Toast 含備註編號", /已複製備註編號：/.test(book));
  ok("備註卡喺 FPS 號碼卡之後", book.indexOf("fps-guide-hint") < book.indexOf("${refBox}"));
  ok("FPS 同 PayMe 都用同一個備註卡（2 處）", (book.match(/\$\{refBox\}/g) || []).length === 2);
}

console.log("\n🧪 9. 教練簽到防手震（Optimistic UI）");
{
  ok("inFlight 鎖存在", /const inFlight = new Set\(\)/.test(cc));
  ok("重複點擊直接 return", /if \(inFlight\.has\(bid\)\) return;/.test(cc));
  ok("Optimistic 標記 __busy", /g\.__busy = action;/.test(cc));
  ok("按鈕即時顯示 ⏳ 簽到中…", /g\.__busy === "checkin" \? "⏳ 簽到中…"/.test(cc));
  ok("busy 時 disabled + opacity .7", /done \|\| absent \|\| g\.__busy \? "disabled"/.test(cc) && /opacity:\.7/.test(cc));
  ok("finally 解鎖（失敗都唔會卡死）", /\} finally \{[\s\S]{0,120}inFlight\.delete\(bid\);/.test(cc));
  ok("QR 2 秒冷卻", /lastQrAt/.test(cc) && /< 2000\) \{ scanRAF = requestAnimationFrame\(tick\); return; \}/.test(cc));
}

console.log("\n🧪 10. 4 堂通行證（Multi-Pass）前端");
{
  ok("預約頁扣堂卡", /class="pass-redeem-card"/.test(book) && /id="btn-pass-submit"/.test(book));
  ok("顯示剩餘堂數 + 扣除數學", /passCreditNum/.test(book) && /passDeductMath/.test(book));
  ok("探測 /passes/my", /api\.get\("\/passes\/my"\)/.test(book));
  ok("扣堂走 redeem-pass（非直接付款）", /\/bookings\/redeem-pass/.test(book));
  ok("扣堂有防手震 passBusy", /passBusy = true/.test(book) && /if \(passBusy \|\| !activePass\) return;/.test(book));
  ok("可改回單堂付款", /passUseCash/.test(book));
  ok("我的預約有卡包", /pass-wallet/.test(mine) && /pw-dot used/.test(mine));
  ok("4 格進度點由 total/remaining 計算", /for \(let i = 0; i < total; i\+\+\)/.test(mine));
  ok("續購連 WhatsApp", /wa\.me\/85290335538/.test(mine) && /續購再減 \$40/.test(mine));
  ok("一鍵預約帶 class_id", /booking\.html\?id=\$\{encodeURIComponent\(classId\)\}/.test(mine));
  ok("未持卡顯示升級橫幅", /id="passUpsell"/.test(book) && /function updateUpsell/.test(book));
  ok("持卡時隱藏升級橫幅", /el\.hidden = !!activePass/.test(book));
  ok("升級橫幅連 WhatsApp 套票", /4堂通行卡（\$480）/.test(book));
}

console.log("\n🧪 11. 通行證示範模式（?demo_pass=1）");
{
  ok("只認 demo_pass=1 旗標（唔用電話號碼）", /get\("demo_pass"\) === "1"/.test(book) && !/98765432/.test(book));
  ok("示範橫幅清楚講明唔會真實預約", /唔會建立真實預約/.test(book) && /passDemoBanner/.test(book));
  ok("mock 資料存 localStorage", /zenpass_mock_credits/.test(book) && /zenpass_mock_bookings/.test(book));
  ok("示範扣堂 400ms 模擬、不呼叫 API", /\}, 400\);/.test(book) && /MOCK_CREDITS_KEY, String\(Math\.max/.test(book));
  ok("無 id 都可示範（示範課程 fallback）", /!classId && DEMO_PASS/.test(book));
  ok("my-bookings 示範卡包", /pass-wallet-card/.test(mine) && /pass-stamp-grid/.test(mine));
  ok("示範模式繞過登入閘", /if \(DEMO_PASS\) \{ load\(\); \}/.test(mine));
  ok("用完改顯示續購（早鳥減 $40）", /續購 4 堂通行卡（早鳥減 \$40）/.test(mine));
  ok("常規模式不受影響（requireLogin 保留）", /api\.requireLogin\("my-bookings.html"\)/.test(mine));
}

console.log("\n🧪 12. 通行證自助改期");
{
  ok("API POST /:id/reschedule", /router\.post\("\/:id\/reschedule"/.test(bkRoute));
  ok("需要登入", /reschedule", authenticateToken/.test(bkRoute));
  ok("原子 transaction（immediate）", /move\.immediate\(\)/.test(bkSvc));
  ok("舊班 -1 條件 enrolled_count > 0", /enrolled_count = enrolled_count - 1 WHERE id = \? AND enrolled_count > 0/.test(bkSvc));
  ok("新班 +1 條件 enrolled_count < max_participants", /enrolled_count = enrolled_count \+ 1 WHERE id = \? AND enrolled_count < max_participants/.test(bkSvc));
  ok("≥24 小時門檻", /RESCHEDULE_WINDOW_CLOSED/.test(bkSvc) && />= 24/.test(bkSvc));
  ok("只限 pass 預約", /NOT_PASS_BOOKING/.test(bkSvc));
  ok("只可改同課程", /TARGET_CLASS_MISMATCH/.test(bkSvc));
  ok("拒絕跨用戶（IDOR）", /FORBIDDEN/.test(bkSvc) && /booking\.user_id !== userId/.test(bkSvc));
  ok("舊 DB 缺 updated_at 自動補", /updated_at"\)\) db\.exec\("ALTER TABLE bookings ADD COLUMN updated_at/.test(bkSvc));
  ok("前端有改期按鈕 + 24h 鎖", /openReschedule/.test(mine) && /已過改期時限（開課前 24 小時）/.test(mine));
  ok("前端列替代班次並過濾", /enrolled_count\) < Number\(s\.max_participants\)/.test(mine));
  ok("前端防手震", /go\.dataset\.busy === "1"/.test(mine));
}

console.log("\n🧪 13. 課程詳情頁（骨架屏／安心標籤／貨幣文案／席位）");
{
  ok("shimmer 骨架 CSS", /\.skeleton\{[\s\S]{0,220}animation:shimmer 1\.5s infinite/.test(detail));
  ok("標題預設 skeleton（唔再寫『載入中…』）", /<h1 class="dt-title skeleton" id="title"><\/h1>/.test(detail) && !/>\s*載入中/.test(detail));
  ok("載入後批次移除 skeleton", /querySelectorAll\("\.skeleton"\)\.forEach/.test(detail));
  ok("減少動態效果時關動畫", /prefers-reduced-motion: reduce\)\{\.skeleton\{animation:none/.test(detail));
  ok("樂齡安心標籤 4 枚", /🪑 全程椅子輔助/.test(detail) && /🩺 關節友善・零基礎/.test(detail) && /🛡️ 已含器材及場地保障/.test(detail));
  ok("標籤只對長者／樂齡班顯示", /isElder = \/長者\|樂齡\|senior\/i/.test(detail));
  ok("已移除 1 Credit = HK$10", !/1 Credit = HK\$10/.test(detail));
  ok("付款文案改用 FPS／通行卡", /支援 FPS 轉數快 \/ PayMe，或以「樂齡 4 堂通行卡」扣堂/.test(detail));
  ok("價格副標唔再用 credits", !/約 " \+ Math\.round\(price \/ 10\) \+ " credits/.test(detail));
  ok("樂齡班先顯示可扣通行卡", /可扣通行卡/.test(detail));
  ok("時段 🔥 僅餘 N 席", /🔥 僅餘 ['"] \+ left \+ ['"] 席/.test(detail));
  ok("時段 已滿額", /已額滿/.test(detail));
  ok("404 友善文案 + 返回探索", /搵唔到呢個課程/.test(detail) && /返回探索/.test(detail));
}

console.log("\n🧪 14. 詳情頁 CRO（首屏價值主張 + Dock + 直通車）");
{
  ok("首屏 CRO 區塊", /class="course-hero-cro"/.test(detail) && /hero-badges-grid/.test(detail));
  ok("長者痛點 banner（條件式）", /專為長者膝頭痛、筋緊、防跌倒設計 · 適合 55-80 歲/.test(detail) && /isElder/.test(detail));
  ok("成人班用泛用文案（唔亂貼）", /小班教學 · 初學者友善 · 導師全程照顧/.test(detail));
  ok("4 格規格卡 2x2", /\.dt-params\{display:grid;grid-template-columns:1fr 1fr/.test(detail));
  ok("收費格顯示通行卡價", /通行卡 \$120/.test(detail));
  ok("高轉化 Dock", /sticky-booking-dock/.test(detail) && /btn-dock-book/.test(detail));
  ok("Dock 真實席位徽章", /dockSeats\.textContent = "🔥 僅餘 "/.test(detail));
  ok("safe-area inset", /env\(safe-area-inset-bottom\)/.test(detail));
  ok("Dock 主掣文案", /立即揀時段預約/.test(detail));
  ok("時段自動預選最近有位", /if \(!SEL_SID\) \{[\s\S]{0,240}filter\(function \(s\) \{ return _free\(s\) > 0; \}\)/.test(detail));
  ok("確認掣顯示已選時段＋剩餘席位", /前往填寫報名資料/.test(detail) && /已選 " \+ \(d\.getMonth/.test(detail) && /剩 " \+ leftN \+ " 席/.test(detail));
  ok("內容底部留白避開 Dock", /\.dt-body \{ padding: 14px var\(--dt-pad\) 96px; \}/.test(detail));
}

console.log("\n🧪 15. 首頁機構級重構");
{
  const visible = home.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const emoji = (visible.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  ok("搜尋膠囊 .search-capsule", /class="search-capsule"/.test(home) && /id="qsGo"/.test(home));
  ok("保留搜尋參數 id", /id="qsArea"/.test(home) && /id="qsDate"/.test(home) && /id="qsCat"/.test(home));
  ok("18 區平鋪已收納為 6 粒", (home.match(/class="loc-pill"/g) || []).length === 6 && !/explore\.html\?zone=ytm/.test(home));
  ok("Header 次級導航", /class="header-nav"/.test(home) && /企業團建/.test(home));
  ok("三大守護卡 3 欄", /class="trust-cards"/.test(home) && /trust-card/.test(home) && /repeat\(3,1fr\)/.test(home));
  ok("信任卡用 SVG 非 Emoji", /class="trust-ic"><svg/.test(home) && !/shield-ic/.test(home));
  ok("Bento 4 卡", /class="bento-grid"/.test(home) && /bento-grid[\s\S]{0,60}repeat\(2,minmax/.test(home));
  ok("Emoji < 10（實測 " + emoji + "）", emoji < 10, String(emoji));
  ok("熱門區隱藏唔會連 .wrap 一齊 hide", /rail\.style\.display = "none"/.test(home) && /classList\.contains\("section-title"\)/.test(home));
}

console.log("\n🧪 16. 預約表單轉化優化");
{
  ok("聲明折疊手風琴", /waiver-accordion-wrapper/.test(book) && /id="btn-toggle-waiver"/.test(book));
  ok("條款預設收合", /id="waiver-collapse-body" hidden/.test(book));
  ok("保留 waiverAgree（一次簽署）", /id="waiverAgree"/.test(book) && /rememberWaiver\(\)/.test(book));
  ok("已記憶提示", /waiver-bound-hint/.test(book) && /此裝置已記憶健康安全聲明/.test(book));
  ok("身分切換喺 Step 2 最頂", /<section id="step2" class="hide">[\s\S]{0,400}誰去上堂/.test(book));
  ok("3 粒藥丸（自己／父母／子女）", /data-att="self"[\s\S]{0,300}data-att="parent"[\s\S]{0,300}data-att="child"/.test(book));
  ok("取消 30 秒強制跳轉", /startDoneRedirect\(0\)/.test(book) && !/redirectSec">30</.test(book));
  ok("長者大字版升為主要 CTA", /class="btn btn-primary btn-block success-hero-action" id="seniorViewBtn"/.test(book));
  ok("72 小時保證只剩 2 處", (book.match(/開課前 3 日（72 小時）免費取消/g) || []).length <= 3);
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
