/**
 * 教練招生推廣包（純 DOM/CSS，零 Canvas 版面依賴）
 * 靜態檢查：版面比例、QR、複製、wa.me、角色入口
 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "..", "frontend-v2");

const read = (f) => fs.readFileSync(path.join(F, f), "utf8");
const promo = read("coach-promo.html");
const checkin = read("coach-checkin.html");
const ops = read("admin-ops.html");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

console.log("\n🧪 1. 零 Canvas／零重型庫");
{
  ok("檔案存在且有一定體積", promo.length > 8000, String(promo.length));
  ok("冇 html2canvas", !/html2canvas/i.test(promo));
  ok("冇 <canvas> 做版面（QR 由 qrcodejs 內部生成）", !/<canvas[\s>]/i.test(promo));
  ok("冇外部 CDN 依賴", !/src="https?:\/\//.test(promo));
  ok("只載入本地 vendor/qrcode.min.js", /src="vendor\/qrcode\.min\.js"/.test(promo));
}

console.log("\n🧪 2. 海報版面規格（9:16 鎖死）");
{
  ok("aspect-ratio: 9 / 16", /aspect-ratio\s*:\s*9\s*\/\s*16/.test(promo));
  ok("max-width 380px", /max-width\s*:\s*380px/.test(promo));
  ok("深森林綠漸變", /linear-gradient\(180deg,\s*#1A5336\s*0%,\s*#113824\s*100%\)/i.test(promo));
  ok("圓角 20px + 陰影", /border-radius\s*:\s*20px/.test(promo) && /box-shadow\s*:\s*0\s+16px\s+40px\s+rgba\(0,\s*0,\s*0,\s*\.22\)/.test(promo));
  ok("padding 24/20 級", /padding\s*:\s*22px\s+20px/.test(promo));
  ok("Flex column + space-between", /display\s*:\s*flex;\s*flex-direction\s*:\s*column;\s*justify-content\s*:\s*space-between/.test(promo.replace(/\n/g, " ")));
  ok("金色膠囊標籤", /pc-pill/.test(promo) && /--gold:#f2d28b/.test(promo));
}

console.log("\n🧪 3. 內容層級");
{
  ok("品牌標籤", /ZenPass 樂齡社區體適能/.test(promo));
  ok("限額膠囊（動態）", /小班限額[\s\S]{0,40}席/.test(promo));
  ok("主標題預設 膝關節強健・防跌伸展", /膝關節強健・防跌伸展/.test(promo));
  ok("副標 給父母最踏實的健康禮物", /給父母最踏實的健康禮物/.test(promo));
  ok("亮點 1 膝關節／腰椎舊患", /專為膝關節、腰椎舊患設計/.test(promo));
  ok("亮點 2 子女報平安", /子女即時收手機「報平安」簽到通知/.test(promo));
  ok("亮點 3 防走失隨身卡 90×54mm", /90×54mm 防走失隨身卡/.test(promo));
  ok("班次日期/時間", /12 月 12 日（六）/.test(promo) && /10:30–12:00/.test(promo));
  ok("地點 青衣楓樹窩體育館", /青衣楓樹窩體育館 1 樓活動室/.test(promo));
  ok("社區價 $140 + SILVER2", /社區價 \$140/.test(promo) && /SILVER2/.test(promo));
  ok("QR 白底容器 96-100px", /\.pc-qr\s*\{[\s\S]{0,200}width\s*:\s*96px;\s*height\s*:\s*96px;[\s\S]{0,120}background\s*:\s*#fff/.test(promo));
  ok("底部文案 長按截圖分享／掃碼", /長按截圖分享 或 掃碼即時鎖位/.test(promo));
  ok("支援 FPS / PayMe", /支援 FPS \/ PayMe/.test(promo));
  ok("查詢熱線 9033 5538", /9033 5538/.test(promo));
}

console.log("\n🧪 4. 一鍵轉發工具箱");
{
  ok("截圖提示條", /手機直接截圖上方海報/.test(promo));
  ok("3 個 Tab：溫情熟人／子女孝親／地區痛點", /溫情熟人版/.test(promo) && /子女孝親版/.test(promo) && /地區痛點版/.test(promo));
  ok("Tab 有 active 樣式", /\.tabs button\.on/.test(promo));
  ok("顯示預格式化文案（保留換行）", /white-space\s*:\s*pre-wrap/.test(promo));
  ok("複製用 navigator.clipboard.writeText", /navigator\.clipboard\.writeText/.test(promo));
  ok("舊機 fallback（execCommand copy）", /execCommand\("copy"\)/.test(promo));
  ok("Toast 文案已複製", /已複製文案，可直接貼到 WhatsApp 群組/.test(promo));
  ok("wa.me deep link", /https:\/\/wa\.me\/\?text=/.test(promo) && /encodeURIComponent\(TEXTS\[current\]\)/.test(promo));
  ok("WhatsApp 只揀聊天室（唔自動發送）", /noopener/.test(promo) && /唔會自動發送/.test(promo));
  ok("三版文案都有報名連結", (promo.match(/\+\s*D\.link/g) || []).length >= 3);
  ok("子女版有報平安 + 隨身卡", /父母一簽到/.test(promo) && /防走失隨身卡/.test(promo));
  ok("地區版有青衣街坊字眼", /青衣街坊注意/.test(promo));
}

console.log("\n🧪 5. URL 參數與 QR 連結");
{
  ok("支援 ?schedule_id=", /qs\.get\("schedule_id"\)/.test(promo));
  ok("支援 ?coach=", /qs\.get\("coach"\)/.test(promo));
  ok("無參數預設 12/12 班", /2026-12-12T10:30:00\+08:00/.test(promo) && /DEFAULT\.link/.test(promo));
  ok("預設短連結 /c/ching-yee?ref=coach", /https:\/\/zenpass\.hk\/c\/ching-yee\?ref=coach/.test(promo));
  ok("有 schedule_id → booking.html?sid=", /booking\.html\?sid=/.test(promo));
  ok("QR 用同一個報名連結", /text:\s*D\.link/.test(promo));
  ok("時間統一 HKT 顯示", /timeZone:\s*"Asia\/Hong_Kong"/.test(promo));
  ok("有 title/start/end/venue/seats 覆寫參數", ["title", "start", "end", "venue", "seats"].every((k) => new RegExp('qs\\.get\\("' + k + '"\\)').test(promo)));
}

console.log("\n🧪 6. 角色入口");
{
  ok("coach-checkin 有 📢 按鈕", /id="promoBtn"/.test(checkin) && /招生推廣包/.test(checkin));
  ok("教練端帶 schedule 資料開新頁", /coach-promo\.html\?" \+ q\.toString\(\)/.test(checkin));
  ok("教練端新分頁（noopener）", /window\.open\("coach-promo\.html\?"[\s\S]{0,80}"_blank"/.test(checkin));
  ok("admin-ops 班次列有 📢 招生推廣包", /📢 招生推廣包/.test(ops));
  ok("admin-ops 連去 coach-promo.html", /href="coach-promo\.html\?/.test(ops));
  ok("admin-ops 帶 schedule_id", /schedule_id:\s*x\.id/.test(ops));
  ok("admin-ops 仍保留 A4 列印", /roster-print\.html\?schedule_id=/.test(ops));
}

console.log(`\n${failed === 0 ? "✅" : "❌"} coach-promo：${passed} 通過 / ${failed} 失敗\n`);
process.exit(failed ? 1 : 0);
