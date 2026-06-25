#!/usr/bin/env node
/**
 * Generate complete outreach package from crawl results
 * Usage: node scripts/generate-outreach-package.cjs
 */

const fs = require("fs");

const CRAWL_PATH = "/tmp/zenpass-crawl/hk-venues-25.json";
const OUTPUT_DIR = "/tmp/zenpass-crawl/outreach";

function main() {
  const raw = fs.readFileSync(CRAWL_PATH, "utf8");
  const venues = JSON.parse(raw);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ========== 1. Generate CSV for import ==========
  const csvRows = [
    "Venue Name,URL,Category,Type,Status,Contact Email (guess),Notes,Suggested Message",
  ];

  for (const v of venues) {
    let type = "JS/API";
    if (v.has_mindbody) type = "Mindbody";
    else if (v.has_html_table) type = "Table";
    else if (v.has_timetable_images) type = "Image";

    const domain = new URL(v.url).hostname.replace("www.", "");
    const guessedEmail = `info@${domain}`;
    const note = v.has_mindbody
      ? "Uses Mindbody - we can integrate via MB API"
      : v.has_login_wall
        ? "Schedule requires login"
        : type === "Image"
          ? "Image timetable - needs OCR"
          : type === "Table"
            ? "HTML timetable - parseable"
            : "JS-loaded schedule - needs API intercept";

    const msg = `Hi ${v.name}團隊！ZenPass幫你免費建立咗線上listing，30秒claim即可管理課程時間表。完全免費！Claim: https://zenpass.hk/partner-apply.html 查詢2387 0724`;

    csvRows.push(`"${v.name}","${v.url}","${v.category}","${type}",${v.status},"${guessedEmail}","${note}","${msg}"`);
  }

  fs.writeFileSync(`${OUTPUT_DIR}/venue-outreach.csv`, csvRows.join("\n"));
  console.log("✅ CSV: venue-outreach.csv");

  // ========== 2. Generate WhatsApp messages ==========
  let waOutput = "===== ZenPass 場地 Outreach - WhatsApp Messages =====\n\n";
  for (const v of venues) {
    const type = v.has_mindbody ? "Mindbody" : v.has_html_table ? "Table" : v.has_timetable_images ? "Image" : "JS/API";
    waOutput += `\n${"─".repeat(60)}\n`;
    waOutput += `TO: ${v.name}\n`;
    waOutput += `URL: ${v.url}\n`;
    waOutput += `TYPE: ${type}\n\n`;
    waOutput += `Hello ${v.name} 團隊 👋\n\n`;
    waOutput += `我係 ZenPass 運動平台嘅 David。\n\n`;
    waOutput += `我哋發現你哋嘅課堂好受歡迎，已經自動幫你喺 ZenPass 免費建立咗 listing 🎯\n\n`;
    waOutput += `而家有超過 XXX 個學生用 ZenPass 搵運動課程，你只需要 30 秒 claim 返個 listing，就可以：\n`;
    waOutput += `✅ 免費管理時間表\n✅ 免費接收學生查詢\n✅ 用 ZenPass 後台睇到邊啲課堂最受歡迎\n\n`;
    waOutput += `完全免費，冇隱藏收費，冇 commitment。\n\n`;
    waOutput += `立即 claim：https://zenpass.hk/partner-apply.html\n`;
    waOutput += `WhatsApp 聯絡：2387 0724\n\n`;
    waOutput += `等我幫你開通？\n\n`;
    waOutput += `*ZenPass 禪流 — 全港運動課程平台*\n`;
  }
  fs.writeFileSync(`${OUTPUT_DIR}/whatsapp-messages.txt`, waOutput);

  // ========== 3. Generate Email messages ==========
  let emailOutput = "===== ZenPass 場地 Outreach - Email Messages =====\n\n";
  for (const v of venues) {
    emailOutput += `\n${"─".repeat(60)}\n`;
    emailOutput += `TO: ${v.name}\n`;
    emailOutput += `Subject: 免費幫你哋嘅課程放上 ZenPass — 30 秒 claim 即可使用\n\n`;
    emailOutput += `Hi ${v.name} 團隊，\n\n`;
    emailOutput += `我係 David，ZenPass 運動平台嘅創辦人。\n\n`;
    emailOutput += `我哋留意到貴場地喺 HK 運動市場好受歡迎，已經自動幫你喺 ZenPass 建立咗 listing。\n\n`;
    emailOutput += `ZenPass 係全港運動課程聚合平台，幫場地免費曝光俾更多學生。\n\n`;
    emailOutput += `你只需要 30 秒 claim 返個 listing，就可以：\n`;
    emailOutput += `• 免費管理時間表同課程資料\n`;
    emailOutput += `• 所有用 ZenPass search 嘅學生會見到你嘅課程\n`;
    emailOutput += `• 完全免費，零月費零佣金\n\n`;
    emailOutput += `Claim your listing: https://zenpass.hk/partner-apply.html\n\n`;
    emailOutput += `有問題可以 WhatsApp 我：2387 0724\n\n`;
    emailOutput += `Best regards,\nDavid\n`;
    emailOutput += `ZenPass 禪流 — 全港運動課程平台\n`;
    emailOutput += `www.hklfcl.com\n`;
  }
  fs.writeFileSync(`${OUTPUT_DIR}/email-messages.txt`, emailOutput);

  // ========== 4. Generate SMS messages ==========
  let smsOutput = "===== ZenPass 場地 Outreach - SMS Messages =====\n\n";
  for (const v of venues) {
    smsOutput += `${v.name}: `;
    smsOutput += `Hi ${v.name}團隊！ZenPass幫你免費建立咗線上listing，30秒claim即可管理課程時間表。完全免費！Claim: https://zenpass.hk/partner-apply.html 查詢2387 0724\n\n`;
  }
  fs.writeFileSync(`${OUTPUT_DIR}/sms-messages.txt`, smsOutput);

  // ========== 5. Summary report ==========
  const html = generateDashboardHTML(venues);
  fs.writeFileSync(`${OUTPUT_DIR}/venue-dashboard.html`, html);

  console.log("✅ WhatsApp: whatsapp-messages.txt");
  console.log("✅ Email: email-messages.txt");
  console.log("✅ SMS: sms-messages.txt");
  console.log("✅ Dashboard: venue-dashboard.html");
  console.log(`\n📦 All files in: ${OUTPUT_DIR}/`);

  // Print venue summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 FINAL SUMMARY — 23 HK Venues Crawled");
  console.log("=".repeat(60));
  
  const types = {};
  for (const v of venues) {
    let t = "JS/API";
    if (v.has_mindbody) t = "Mindbody";
    else if (v.has_html_table) t = `Table(${v.tables_count})`;
    else if (v.has_timetable_images) t = "Image";
    types[t] = (types[t] || 0) + 1;
  }
  
  for (const [t, c] of Object.entries(types)) {
    const pct = Math.round(c / venues.length * 100);
    const bar = "█".repeat(Math.floor(pct / 5));
    console.log(`  ${t.padEnd(15)} ${String(c).padStart(2)} (${String(pct).padStart(2)}%) ${bar}`);
  }
  
  console.log("-".repeat(60));
  console.log(`  TOTAL".padStart(2)}         ${venues.length} (100%)`);
  console.log("\n💡 23 venues ready to contact!");
  console.log("📱 Send WhatsApp messages from whatsapp-messages.txt");
  console.log("📧 Send emails from email-messages.txt");
  console.log("📊 Dashboard: venue-dashboard.html (open in browser)");
}

function generateDashboardHTML(venues) {
  const rows = venues
    .map((v, i) => {
      let type = "⚙️ JS/API";
      let badge = "badge-gray";
      if (v.has_mindbody) { type = "🧘 Mindbody"; badge = "badge-purple"; }
      else if (v.has_html_table) { type = `📋 Table(${v.tables_count})`; badge = "badge-green"; }
      else if (v.has_timetable_images) { type = "🖼 Image"; badge = "badge-yellow"; }

      const login = v.has_login_wall ? "🔒" : "";
      const contactLink = `https://wa.me/?text=${encodeURIComponent(`Hi ${v.name}團隊！ZenPass免費幫你建立咗listing，30秒claim即可管理課程時間表。完全免費！Claim: https://zenpass.hk/partner-apply.html`)}`;

      return `<tr>
        <td>${i + 1}</td>
        <td><strong>${v.name}</strong></td>
        <td><span class="badge ${badge}">${type}</span></td>
        <td>${v.category}</td>
        <td>${login} <a href="${v.url}" target="_blank">${new URL(v.url).hostname}</a></td>
        <td><a href="${contactLink}" target="_blank" class="btn-sm">📱 WhatsApp</a></td>
      </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-HK">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZenPass Venue Dashboard</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: system-ui; background: #f9fafb; color: #1a1a2e; padding: 20px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 20px; }
  .stats { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat { background: white; border-radius: 12px; padding: 16px 20px; flex: 1; min-width: 140px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); border: 1px solid rgba(0,0,0,0.04); }
  .stat .num { font-size: 28px; font-weight: 700; }
  .stat .lbl { font-size: 12px; color: #6b7280; margin-top: 2px; }
  .table-wrap { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.06); border: 1px solid rgba(0,0,0,0.04); }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 10px 14px; background: #c94420; color: white; font-size: 12px; font-weight: 600; }
  td { padding: 8px 14px; font-size: 13px; border-bottom: 1px solid #f3f4f6; }
  tr:hover td { background: #fff8f4; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
  .badge-gray { background: #f3f4f6; color: #374151; }
  .badge-green { background: #d1fae5; color: #065f46; }
  .badge-purple { background: #ede9fe; color: #5b21b6; }
  .badge-yellow { background: #fef3c7; color: #92400e; }
  .btn-sm { display: inline-block; padding: 4px 10px; background: #c94420; color: white; border-radius: 6px; font-size: 11px; text-decoration: none; }
  .btn-sm:hover { background: #aa3218; }
  a { color: #c94420; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .legend { margin: 16px 0; font-size: 12px; color: #6b7280; display: flex; gap: 16px; flex-wrap: wrap; }
</style>
</head><body>
  <h1>🏪 ZenPass Venue Directory</h1>
  <p class="subtitle">Auto-discovered HK fitness venues — ready for outreach</p>
  
  <div class="stats">
    <div class="stat"><div class="num" style="color:#c94420">${venues.length}</div><div class="lbl">Total Venues</div></div>
    <div class="stat"><div class="num" style="color:#059669">${venues.filter(v => v.has_html_table).length}</div><div class="lbl">Parseable (Table)</div></div>
    <div class="stat"><div class="num" style="color:#7c3aed">${venues.filter(v => v.has_mindbody).length}</div><div class="lbl">Mindbody Users</div></div>
    <div class="stat"><div class="num" style="color:#d97706">${venues.filter(v => v.has_timetable_images).length}</div><div class="lbl">Image Timetable</div></div>
    <div class="stat"><div class="num" style="color:#6b7280">${venues.filter(v => v.has_login_wall).length}</div><div class="lbl">Login Required</div></div>
  </div>

  <div class="legend">
    <span>📋 Parseable</span>
    <span>🧘 Uses Mindbody</span>
    <span>🖼 Image timetable</span>
    <span>⚙️ JS/API widget</span>
    <span>🔒 Login wall</span>
    <span>📱 Click WhatsApp to send outreach</span>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr><th>#</th><th>Venue</th><th>Type</th><th>Category</th><th>URL</th><th>Outreach</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <p style="margin-top: 16px; font-size: 11px; color: #9ca3af;">
    Generated: ${new Date().toISOString().slice(0, 10)} · 
    <a href="https://zenpass.hk/partner-apply.html">Partner apply page</a> · 
    <a href="https://zenpass.hk/">ZenPass Home</a>
  </p>
</body></html>`;
}

main();
