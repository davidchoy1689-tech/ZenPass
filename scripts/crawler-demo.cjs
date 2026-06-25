#!/usr/bin/env node
/**
 * ZenPass AI Crawler Demo Script
 * 快速測試爬蟲效果，唔使開 server
 *
 * Usage: node scripts/crawler-demo.js [url]
 * Default: crawl the first test URL
 */

const path = require("path");

// Set DB path for local dev
process.env.DB_PATH = path.join(__dirname, "..", "backend", "data", "zenpass.db");

const { crawlVenueCourses } = require("../backend/src/services/course-crawler");

const TEST_URLS = [
  { name: "IKIGAI Yoga", url: "https://www.ikigai.hk/en/schedule" },
  { name: "Tapas Yoga", url: "https://tapasyogahk.com/schedule.html" },
  { name: "The Yoga Room HK", url: "https://www.yogaroomhk.com/schedule" },
  { name: "Anahata Yoga", url: "https://www.anahatayoga.com.hk/schedule/" },
  { name: "PURE Yoga", url: "https://www.pure-360.com.hk/en/yoga/class-schedule/" },
  { name: "Senses Studio", url: "https://www.yogasenses.co/pages/class-schedule" },
  { name: "香港瑜伽舍", url: "http://www.hkyogastudio.org/courses-schedule" },
];

async function main() {
  const targetUrl = process.argv[2];

  if (targetUrl) {
    console.log(`\n🔍 Crawling single URL: ${targetUrl}\n`);
    const result = await crawlVenueCourses(targetUrl, { useAI: false });
    printResult(result);
  } else {
    console.log(`\n🕸️  ZenPass AI Crawler Demo — 批量測試 ${TEST_URLS.length} 個場地\n`);
    for (const t of TEST_URLS) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`🏪  ${t.name}`);
      console.log(`🔗  ${t.url}`);
      console.log(`${"=".repeat(60)}`);
      const result = await crawlVenueCourses(t.url, { useAI: false });
      printResult(result);
      // Rate limiting
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function printResult(result) {
  if (!result.success) {
    console.log(`  ❌ ${result.error}`);
    return;
  }
  console.log(`  ✅ Crawled in ${result.crawl_time_ms}ms`);
  console.log(`  🏪 Venue: ${result.venue?.name || "Unknown"}`);
  console.log(`  📊 Courses found: ${result.courses?.length || 0}`);
  console.log(`  🧠 Parser: ${result.parsed_by || "heuristic"}`);
  console.log(`\n  Courses:`);

  const courses = result.courses || [];
  if (courses.length === 0) {
    console.log("    (no courses extracted — heuristic may need AI upgrade)");
    return;
  }

  // Show top 10
  const show = courses.slice(0, 10);
  for (const c of show) {
    const title = c.title || "(unnamed)";
    const truncated = title.length > 60 ? title.substring(0, 57) + "..." : title;
    const schedules = c.schedules || [];
    const scheduleStr = schedules.length
      ? schedules.map((s) => `${s.day_of_week} ${s.start_time}-${s.end_time}`).join(", ")
      : "";
    console.log(`    📍 ${truncated}`);
    if (c.category) console.log(`       🏷 ${c.category}`);
    if (c.price_hkd > 0) console.log(`       💰 HK$${c.price_hkd}`);
    if (scheduleStr) console.log(`       🕐 ${scheduleStr.substring(0, 60)}`);
    if (c.confidence) console.log(`       📊 信心: ${c.confidence}`);
  }
  if (courses.length > 10) {
    console.log(`    ... and ${courses.length - 10} more`);
  }

  console.log();
}

main().catch(console.error);
