/**
 * ZenPass 禪流 — AI 課程爬蟲 API Routes
 *
 * POST /api/crawler/crawl — 爬取單一場地
 * POST /api/crawler/batch — 批量爬取
 * GET /api/crawler/status — 爬蟲狀態
 * GET /api/crawler/test-urls — 測試用的場地 URL list
 */

const express = require("express");
const path = require("path");
const router = express.Router();
const Database = require("better-sqlite3");
const { crawlVenueCourses, crawlMultipleVenues } = require("../services/course-crawler");
const { authenticateToken, requireRole } = require("../middleware/auth");
const { ok, fail, serverError } = require("../services/response");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "../../data/zenpass.db");

// ===== Test URLs (公開，唔使 login) =====
const TEST_URLS = [
  { name: "IKIGAI Yoga", url: "https://www.ikigai.hk/en/schedule", category: "瑜伽" },
  { name: "Tapas Yoga", url: "https://tapasyogahk.com/schedule.html", category: "瑜伽" },
  { name: "The Yoga Room HK", url: "https://www.yogaroomhk.com/schedule", category: "瑜伽" },
  { name: "Anahata Yoga", url: "https://www.anahatayoga.com.hk/schedule/", category: "瑜伽" },
  { name: "PURE Yoga", url: "https://www.pure-360.com.hk/en/yoga/class-schedule/", category: "瑜伽" },
  { name: "Senses Studio", url: "https://www.yogasenses.co/pages/class-schedule", category: "瑜伽" },
  { name: "香港瑜伽舍", url: "http://www.hkyogastudio.org/courses-schedule", category: "瑜伽" },
];

// ===== POST /api/crawler/crawl — 爬取單一場地 =====
// 公開 endpoint，方便 demo
router.post("/crawl", async (req, res) => {
  try {
    const { url, useAI } = req.body;
    if (!url) return fail(res, "請提供場地 URL", 400);

    // Validate URL
    try {
      new URL(url);
    } catch {
      return fail(res, "無效嘅 URL 格式", 400);
    }

    const result = await crawlVenueCourses(url, { useAI: useAI !== false });

    if (result.success) {
      return ok(res, {
        venue: result.venue,
        courses: result.courses,
        parsed_by: result.parsed_by || "heuristic",
        crawl_time_ms: result.crawl_time_ms,
        raw_page: result.raw_page,
      });
    }

    return fail(res, result.error || "爬取失敗", 500);
  } catch (err) {
    console.error("❌ crawler/crawl error:", err.message);
    return serverError(res, "爬取過程發生錯誤");
  }
});

// ===== POST /api/crawler/batch — 批量爬取 =====
router.post("/batch", authenticateToken, requireRole("admin"), async (req, res) => {
  try {
    const { urls, useAI } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return fail(res, "請提供至少一個 URL", 400);
    }

    const results = await crawlMultipleVenues(urls, { useAI: useAI !== false });

    const successCount = results.filter((r) => r.success).length;
    return ok(res, {
      total: results.length,
      success: successCount,
      failed: results.length - successCount,
      results,
    });
  } catch (err) {
    console.error("❌ crawler/batch error:", err.message);
    return serverError(res, "批量爬取失敗");
  }
});

// ===== GET /api/crawler/test-urls — 測試用場地 URL list =====
router.get("/test-urls", (req, res) => {
  return ok(res, { urls: TEST_URLS });
});

// ===== GET /api/crawler/demo — 快速 Demo：爬取第1個 test URL =====
router.get("/demo", async (req, res) => {
  try {
    const firstUrl = req.query.url || TEST_URLS[0].url;
    const result = await crawlVenueCourses(firstUrl, { useAI: false }); // heuristic first for speed

    if (result.success) {
      const html = generateDemoHtml(result);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(html);
    }

    return fail(res, result.error || "Demo 爬取失敗", 500);
  } catch (err) {
    console.error("❌ crawler/demo error:", err.message);
    return serverError(res, "Demo 發生錯誤");
  }
});

function generateDemoHtml(result) {
  const courses = result.courses || [];
  const rows = courses
    .map(
      (c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escHtml(c.title)}</td>
      <td>${c.category || "-"}</td>
      <td>${c.instructor || "-"}</td>
      <td>${c.duration_min ? c.duration_min + "min" : "-"}</td>
      <td>${c.price_hkd ? "HK$" + c.price_hkd : "-"}</td>
      <td>${c.level || "-"}</td>
      <td style="font-size:11px;color:#6b7280;">${(c.schedules || []).length ? c.schedules.map(s => s.day_of_week + " " + s.start_time + "-" + s.end_time).join("<br>") : "-"}</td>
    </tr>`,
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>ZenPass AI Crawler Demo</title>
<style>
  body { font-family: system-ui; max-width: 960px; margin: 0 auto; padding: 20px; background: #f9fafb; }
  h1 { font-size: 24px; }
  .stats { display: flex; gap: 16px; margin: 16px 0; }
  .stat { background: white; border-radius: 12px; padding: 16px; flex: 1; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .stat .num { font-size: 28px; font-weight: 700; color: #c94420; }
  .stat .lbl { font-size: 12px; color: #6b7280; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  th { text-align: left; padding: 10px 12px; background: #c94420; color: white; font-size: 12px; font-weight: 600; }
  td { padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #f3f4f6; }
  .venue-info { background: white; border-radius: 12px; padding: 16px; margin: 16px 0; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .badge { display: inline-block; background: #f0fdfa; color: #0d9488; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
  .raw-btn { display: inline-block; margin-top: 12px; padding: 8px 16px; background: #c94420; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; text-decoration: none; }
  .raw-btn:hover { background: #aa3218; }
</style></head><body>
  <h1>🕸️ ZenPass AI Crawler Demo</h1>
  <div class="venue-info">
    <strong>🏪 ${escHtml(result.venue?.name || "Unknown")}</strong>
    <span class="badge" style="margin-left:8px;">${result.parsed_by || "heuristic"}</span>
    <br>
    <span style="font-size:12px;color:#6b7280;">🔗 ${result.venue?.source_url || ""}</span>
    <br>
    <span style="font-size:12px;color:#6b7280;">⏱ ${result.crawl_time_ms}ms</span>
  </div>
  <div class="stats">
    <div class="stat"><div class="num">${courses.length}</div><div class="lbl">課程</div></div>
    <div class="stat"><div class="num">${new Set(courses.map(c => c.category)).size}</div><div class="lbl">類別</div></div>
    <div class="stat"><div class="num">${courses.filter(c => c.price_hkd > 0).length}</div><div class="lbl">有價格</div></div>
  </div>
  <table><thead><tr>
    <th>#</th><th>課程名稱</th><th>類別</th><th>教練</th><th>時長</th><th>價格</th><th>程度</th><th>時間表</th>
  </tr></thead><tbody>
    ${rows || '<tr><td colspan="8" style="text-align:center;padding:40px;color:#9ca3af;">😕 未能自動擷取課程資料</td></tr>'}
  </tbody></table>
  <p style="font-size:11px;color:#9ca3af;margin-top:20px;">
    ⚡ 呢個係 heuristic 解析結果 · 啟用 AI 解析後準確率會大幅提升
  </p>
</body></html>`;
}

function escHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ===== GET /api/crawler/venues — 列出所有 crawl 到嘅場地 =====
router.get("/venues", (req, res) => {
  try {
    const db = new Database(DB_PATH);
    const { status, category } = req.query;
    
    let sql = "SELECT id, name, url, category, type, has_mindbody, has_html_table, has_timetable_images, status FROM crawled_venues";
    const conditions = [];
    const params = [];
    
    if (status) { conditions.push("status = ?"); params.push(status); }
    if (category) { conditions.push("category = ?"); params.push(category); }
    
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY name ASC";
    
    const venues = db.prepare(sql).all(...params);
    db.close();
    
    return ok(res, { venues, total: venues.length });
  } catch (err) {
    console.error("❌ crawler/venues error:", err.message);
    return serverError(res, "載入場地列表失敗");
  }
});

module.exports = router;
