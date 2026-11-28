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
const guestRoute = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "guest.js"), "utf8");
const guestBookPage = fs.readFileSync(path.join(F, "guest-booking.html"), "utf8");

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
  // 2026-11-27 改版：每個時段只講一句「剩 N/總」，≤5 位才出幼條（原本三重名額橫幅已移除）
  ok("一個時段一行名額文案（剩 N/總）", /剩 \$\{seatsLeft\(s\)\}\/\$\{Number\(s\.max_participants \|\| 0\)\} 位/.test(book));
  ok("≤5 位才顯示幼條 .seat-thin", /left > 5/.test(book) && /class="seat-thin"/.test(book));
  ok("滿額顯示候補入口", /已滿 · <a href="detail\.html\?id=/.test(book) && /候補名單/.test(book));
  ok("滿額班次 checkbox disabled", /\$\{full\?"disabled":""\}/.test(book));
  ok("≤5 位轉橙（seat-meta low）", /seatsLeft\(s\) <= 5 \? " low"/.test(book));
  ok("已滿標記 full（灰色）", /full \? " full"/.test(book));
  ok("全選唔會揀滿額班", /filter\(s => seatsLeft\(s\) > 0\)/.test(book));
  ok("時段容器用 container query（窄位自動堆疊）", /container-name:slotlist/.test(book) && /@container slotlist \(min-width:560px\)/.test(book));
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
  ok("持卡時隱藏升級橫幅", /if \(activePass\) \{ el\.hidden = true; return; \}/.test(book));
  ok("升級橫幅連 WhatsApp 套票", /4 堂通行卡（HK\$520）/.test(book));
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
  // 2026-11-18：改期要按 group_size 搬位（三人同行 = 3 位）
  ok("舊班按 seats 扣位（>=1）", /enrolled_count = MAX\(0, enrolled_count - \?\) WHERE id = \? AND enrolled_count > 0/.test(bkSvc));
  ok("新班按 seats 加位（容量守衛）", /enrolled_count = enrolled_count \+ \? WHERE id = \? AND enrolled_count \+ \? <= max_participants/.test(bkSvc));
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
  ok("樂齡安心標籤 4 枚", /🪑 全程椅子輔助/.test(detail) && /🩺 關節友善・零基礎/.test(detail) && /📋 每堂點名・絕不硬銷/.test(detail));
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
  // 排除底部導覽：2026-11-14 全站統一 nav icon（🏠🔍📅🎫），屬功能性圖示非裝飾 emoji
  const visible = home
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<nav class="bottomnav"[\s\S]*?<\/nav>/gi, "");
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
  ok("頂部品牌漸層條 + 品牌藥丸", /class="brand-topbar"/.test(home) && /linear-gradient\(90deg,#10B981 0%,#059669 100%\)/.test(home) && /class="hero-brand-pill"/.test(home));
  ok("H1 深黑 + 翡翠綠關鍵字 + 44px", /body\.home \.hero h1\{[^}]*44px/.test(home) && /\.hero h1 \.hl\{color:#059669/.test(home));
  ok("搜尋膠囊 2px 綠框", /\.search-capsule\{border:2px solid #059669/.test(home) && /border-radius:16px/.test(home));
  ok("Bento 實色塊 + 徽章", /class="bento-badge"/.test(home) && /nth-child\(1\)\{background:#ECFDF5;border-color:#6EE7B7\}/.test(home));
  ok("評價卡 SVG 引號 + 金星", /class="proof-quote"/.test(home) && /\.proof-stars svg\{[^}]*fill:currentColor/.test(home));
  ok("安心保障撞色區塊", /class="trust-block"/.test(home) && /\.trust-block\{background:#F0FDF4/.test(home));
  ok("信任卡實色綠圖標", /\.trust-ic\{width:44px;height:44px;background:#059669;color:#FFFFFF\}/.test(home));
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

console.log("\n🧪 17. 續付舊單／成功頁金額（2026-11-28 修正）");
{
  ok("續付 pending 單回傳 booking_reference", /booking_reference: existing\.booking_reference/.test(bkSvc));
  ok("續付 pending 單回傳 amount", /amount: Number\(existing\.amount\) \|\| 0/.test(bkSvc));
  ok("findExistingBookingForUser 有查 booking_reference/amount/hold_until/付款證明", /SELECT id, booking_reference, amount, status, payment_status, hold_until,/.test(bkSvc) && /payment_reported_at FROM bookings/.test(bkSvc));
  ok("付款頁總額計齊新建＋續付", /payList\.reduce\(\(s, x\) => s \+ \(Number\(x\.body && x\.body\.amount\) \|\| 0\), 0\)/.test(book) && /bodyTotal > 0 \? bodyTotal : d\.payable_amount/.test(book));
  ok("成功頁改用 orderParts()", /renderDoneSummary[\s\S]{0,900}orderParts\(\)/.test(book) && !/unit\(\) \* n \* gs/.test(book));
  ok("成功頁有同行人數列", /renderDoneSummary[\s\S]{0,1400}位（同行）/.test(book));
  ok("Credits 成功頁顯示 cr", /isCredits \? cr\(total\) \+ " cr" : hkd\(total\)/.test(book));
  ok("全部失敗顯示「未扣款」而唔係原價", /amountHkd: chargedHkd/.test(book) && /—（未扣款）/.test(book));
  ok("4 堂卡超過 4 堂有提示", /sel\.size > 4[\s\S]{0,200}只包 4 堂/.test(book));
  ok("自動套用優惠碼失敗會 toast", /wasSaved[\s\S]{0,200}未能套用/.test(book));
  ok("batch payable_amount 包埋續付舊單", /const resumedRows = results\.filter\(\(x\) => x\.status === 200 && x\.body && x\.body\.requires_payment\)/.test(bkRoute) && /createdPayable \+ resumedPayable/.test(bkRoute));
  ok("重新鎖定保留 attendee（子女／監護人資料）", /const relockAttendee = getAttendeePayload\(true\)/.test(book) && /attendee: relockAttendee/.test(book));
  ok("部分付款提交有清楚提示", /fail===0[\s\S]{0,700}已提交 \$\{ok\} \/ \$\{payIds\.length\}/.test(book));
  ok("訪客結賬會帶 guest token（回訪可續用帳號）", /token: \(\(\) => \{ try \{ return localStorage\.getItem\("zp_guest_token"\)/.test(book));
  ok("回訪訪客電話已有 guest 帳號有專屬提示", /PHONE_EXISTS_GUEST/.test(book));
  ok("回訪訪客付款只用今次新 booking 嘅備註", /const paidRows = list\.filter\(b => idSet\.has\(String\(b\.id\)\)\)/.test(book) && /paidRows\.map\(b => b\.booking_reference/.test(book));
  ok("混合新舊單倒數用最遲 hold_until", /holdCandidates\[holdCandidates\.length - 1\]/.test(book));
  ok("訪客續付（200）唔會當失敗", /payableResults = results\.filter\(\(r\) => r\.booking_id && \(r\.status === 201 \|\| r\.status === 200\)\)/.test(guestRoute));
  const penaltyRoute = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "penalty.js"), "utf8");
  ok("拒絕付款按 group_size 釋放座位", /rejSeats = Math\.max\(1, Number\(booking\.group_size\) \|\| 1\)/.test(fs.readFileSync(path.join(__dirname, "..", "src", "services", "admin-service.js"), "utf8")));
  ok("缺席／遲取消按 group_size 釋放座位", /noShowSeats/.test(penaltyRoute) && /lateSeats/.test(penaltyRoute) && /adminNoShowSeats/.test(penaltyRoute) && !/enrolled_count = MAX\(0, enrolled_count - 1\)/.test(penaltyRoute));
  const adminSvc = fs.readFileSync(path.join(__dirname, "..", "src", "services", "admin-service.js"), "utf8");
  ok("拒絕付款標 cancelled 而非 refunded", /status = 'cancelled', payment_status = 'cancelled'/.test(adminSvc) && /UPDATE transactions SET status = 'failed'/.test(adminSvc));
  ok("我的預約：已提交付款顯示待核實（唔再叫繼續付款）", /paymentSubmitted = \(b\)/.test(mine) && /待核實/.test(mine) && /已提交付款，等待核實/.test(mine));
  ok("已提交付款再開付款頁 → 409", /PAYMENT_REVIEW_PENDING/.test(bkSvc) && /請勿重複轉帳/.test(bkSvc));
  ok("訪客預約頁：已提交付款顯示待核實+WhatsApp查詢", /submitted && b\.status === "pending_payment" \? "待核實"/.test(guestBookPage) && /WhatsApp 查詢核實進度/.test(guestBookPage));
  ok("訪客已提交付款唔准自助取消", /pending_payment" && !submitted\)/.test(guestBookPage) && /PAYMENT_REVIEW_PENDING/.test(bkSvc));
  const adminOps = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "admin-ops.js"), "utf8");
  ok("後台課堂列表 booked 按 group_size 計座位", /COALESCE\(SUM\(COALESCE\(b\.group_size,1\)\),0\) FROM bookings b WHERE b\.schedule_id = cs\.id AND b\.status = 'confirmed'\) AS booked/.test(adminOps));
  ok("後台預約管理 seats 按 group_size（唔係 booking 數）", /SUM\(COALESCE\(b\.group_size,1\)\) AS seats/.test(adminOps) && /THEN COALESCE\(b\.group_size,1\) ELSE 0 END\) AS paid_seats/.test(adminOps));
  ok("信用卡退款顯示自動退卡（唔出 FPS 表單）", /信用卡退款會自動退回原卡/.test(mine) && /card.*credit_card/.test(mine));
  ok("部分退款／扣手續費有清楚顯示", /payment_status === "partial_refund"/.test(mine) && /已按取消政策退款/.test(mine));
  const payRoute = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "payments.js"), "utf8");
  ok("Stripe webhook 核對實收金額", /AMOUNT MISMATCH/.test(payRoute) && /paidCents - expectedCents/.test(payRoute));
  ok("取消後才付款 → 自動退原卡（唔出確認／入賬）", /課堂已取消（付款後）/.test(payRoute) && /booking\.status === "cancelled" && booking\.payment_status !== "refunded"/.test(payRoute));
  ok("重複 Stripe 付款會自動退款", /duplicate refunded/.test(payRoute) && /zp-dup-/.test(payRoute));
  ok("天氣取消用香港日期（凌晨班唔會漏）", /date\(start_time, '\+8 hours'\) = \?/.test(adminOps));
  ok("天氣取消會還原通行證堂數", /restoreInTx\(db, \{ passId: b\.pass_id, bookingId: b\.id \}\)/.test(adminOps) && /refund_channel='pass'/.test(adminOps));
  ok("通行證退款文案正確", /堂數已退回你嘅通行證/.test(mine));
  const coachEarn = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "coach-earnings.js"), "utf8");
  ok("教練收入日期／月份用香港時區", /Date\.now\(\) \+ 8 \* 3600 \* 1000/.test(coachEarn) && /getTime\(\) \+ 8 \* 3600 \* 1000\)\.toISOString\(\)\.slice\(0, 10\)/.test(coachEarn));
}

console.log("\n🧪 18. 鎖位倒數跟後台設定（2026-11-28 修正）");
{
  const platform = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "platform.js"), "utf8");
  const guest = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "guest.js"), "utf8");
  ok("公開 config 提供 booking_hold_minutes", /booking_hold_minutes: settings\.num\(db, "booking_hold_minutes", 10\)/.test(platform));
  ok("前端讀 __HOLD_MIN", /window\.__HOLD_MIN = hm/.test(book) && /c\.booking_hold_minutes/.test(book));
  ok("付款倒數唔再固定 30 分鐘", /holdMinLeft\(holdUntil\) \|\| holdCfgMin\(\)/.test(book) && !/startHoldCountdown\("payCountdown", showTimeoutModal\);/.test(book));
  ok("Step 3 倒數用 holdCfgMin", /startHoldCountdown\("countdown", showTimeoutModal, holdCfgMin\(\)\)/.test(book));
  ok("續付用伺服器 hold_until", /hold_until: existing\.hold_until \|\| null/.test(bkSvc));
  ok("訪客重新鎖定會延長 hold_until（唔止改 created_at）", /hold_until = datetime\('now', '\+' \|\| \? \|\| ' minutes'\)/.test(guest));
  ok("訪客 relock 回傳 hold_minutes", /bookings: guestBookings\(db, s\.id\), hold_minutes: mins/.test(guest));
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
