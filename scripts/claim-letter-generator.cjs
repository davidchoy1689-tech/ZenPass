#!/usr/bin/env node
/**
 * ZenPass 場地 Claim Letter Generator
 *
 * 根據 crawl result，自動生成畀場地嘅 email/WhatsApp message
 * 用嚟話俾佢哋知：「我哋已經幫你整咗 listing，免費 claim 就可以管理」
 */

const fs = require("fs");
const path = require("path");

const CRAWL_RESULTS_PATH = "/tmp/zenpass-crawl/results.json";

// Claim letter templates
const TEMPLATES = {
  whatsapp: (venue, crawlNote) =>
    `Hello ${venue.name} 團隊 👋

我係 ZenPass 運動平台嘅 David。

我哋發現你哋嘅課堂好受歡迎，已經自動幫你喺 ZenPass 免費建立咗 listing 🎯

而家有超過 XXX 個學生用 ZenPass 搵運動課程，你只需要 30 秒 claim 返個 listing，就可以：
✅ 免費管理時間表
✅ 免費接收學生查詢
✅ 用 ZenPass 後台睇到邊啲課堂最受歡迎

完全免費，冇隱藏收費，冇 commitment。

立即 claim：https://zenpass.hk/partner-apply.html
WhatsApp 聯絡：2387 0724

等我幫你開通？

*ZenPass 禪流 — 全港運動課程平台*`,

  email: (venue, crawlNote) =>
    `Subject: 免費幫你哋嘅課程放上 ZenPass — 30 秒 claim 即可使用

Hi ${venue.name} 團隊，

我係 David，ZenPass 運動平台嘅創辦人。

我哋留意到貴場地喺 HK 運動市場好受歡迎，已經自動幫你喺 ZenPass 建立咗 listing。

ZenPass 係全港運動課程聚合平台，幫場地免費曝光俾更多學生。

你只需要 30 秒 claim 返個 listing，就可以：
• 免費管理時間表同課程資料
• 所有用 ZenPass search 嘅學生會見到你嘅課程
• 完全免費，零月費零佣金

Claim your listing: https://zenpass.hk/partner-apply.html

有問題可以 WhatsApp 我：2387 0724

Best regards,
David
ZenPass 禪流 — 全港運動課程平台
www.hklfcl.com`,

  sms: (venue, crawlNote) =>
    `Hi ${venue.name}團隊！ZenPass幫你免費建立咗線上listing，30秒claim即可管理課程時間表。完全免費！Claim: https://zenpass.hk/partner-apply.html 查詢2387 0724`,
};

function main() {
  const raw = fs.readFileSync(CRAWL_RESULTS_PATH, "utf8");
  const results = JSON.parse(raw);

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║         ZenPass 場地自動 Claim Letter Generation            ║
╚══════════════════════════════════════════════════════════════╝
`);

  for (const v of results) {
    const crawlNote = v.has_timetable_images
      ? "🖼 圖片時間表（需要確認準確度）"
      : v.table_count > 0
        ? "📋 可爬取時間表"
        : "⚙️ 動態時間表";

    console.log(`\n${"─".repeat(70)}`);
    console.log(`🏪  ${v.name}`);
    console.log(`🔗  ${v.url}`);
    console.log(`📊  ${crawlNote}`);
    console.log(`\n📱 WhatsApp Message:`);
    console.log(TEMPLATES.whatsapp(v, crawlNote));
    console.log(`\n📧 Email:`);
    console.log(TEMPLATES.email(v, crawlNote));
    console.log(`\n💬 SMS:`);
    console.log(TEMPLATES.sms(v, crawlNote));
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log("📝 Total venues: " + results.length);

  // Generate a combined outreach spreadsheet
  const csvRows = [
    "Venue,URL,Category,Crawl Status,Notes,WhatsApp Message Preview",
  ];
  for (const v of results) {
    const note = v.has_timetable_images
      ? "Image timetable - confirm accuracy"
      : v.table_count > 0
        ? "Has HTML timetable data"
        : "JS/API schedule - needs manual setup";
    csvRows.push(
      `${v.name},${v.url},${v.category},${v.status},${note},"Hi ${v.name}！ZenPass幫你..."`
    );
  }

  const csvPath = "/tmp/zenpass-crawl/claim-letters.csv";
  fs.writeFileSync(csvPath, csvRows.join("\n"));
  console.log(`📄 CSV saved: ${csvPath}`);
}

main();
