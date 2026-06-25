/**
 * ZenPass 禪流 — AI 課程爬蟲
 *
 * 自動從第三方場地網站爬取課程時間表
 * 使用 Playwright + AI 解析 HTML → 結構化課程資料
 *
 * Strategy（由最佳至 fallback）：
 * 1. AI 解析（OpenAI） — 最準確，理解各種排版
 * 2. DOM 智能解析 — 針對常見 timetable 結構 heuristic
 * 3. Raw scrape — 作為人肉 verify 嘅 raw data 展示
 *
 * @module services/course-crawler
 */

const { chromium } = require("playwright");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * 從 URL 爬取課程資料
 * @param {string} url - 場地網站 URL
 * @param {object} [options]
 * @param {boolean} [options.useAI=true] - 是否使用 AI 解析
 * @param {number} [options.timeout=30000] - 頁面 load timeout
 * @returns {Promise<{success, venue, courses[], raw?, error?}>}
 */
async function crawlVenueCourses(url, options = {}) {
  const { useAI = true, timeout = 30000 } = options;
  const startTime = Date.now();

  console.log(`🕸️  Crawl start: ${url}`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "zh-HK",
    });

    const page = await context.newPage();

    // Intercept network requests to capture API-loaded schedule data
    const apiCalls = [];
    const apiResponses = [];
    await page.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      const keywords = ["api", "schedule", "timetable", "classes", "class", "booking", "graphql", "mindbody", "json"];
      const matchUrl = keywords.some(k => url.toLowerCase().includes(k));
      const matchType = req.resourceType() === "xhr" || req.resourceType() === "fetch";
      
      if (matchUrl && (matchType || url.includes(".json"))) {
        apiCalls.push({
          url: url.substring(0, 250),
          method: req.method(),
          type: req.resourceType(),
        });
        
        // Try to capture JSON responses
        try {
          const response = await route.fetch();
          const body = await response.text();
          if (body.length > 50 && body.length < 500000) {
            const contentType = response.headers()["content-type"] || "";
            if (contentType.includes("json") || body.trim().startsWith("[") || body.trim().startsWith("{")) {
              apiResponses.push({
                url: url.substring(0, 250),
                data: JSON.parse(body),
                size: body.length,
              });
            }
          }
          route.fulfill({ response }).catch(() => {});
          return;
        } catch {
          route.continue().catch(() => {});
          return;
        }
      }
      route.continue().catch(() => {});
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout,
    }).catch(() => {});

    // Wait for dynamic content to load
    await page.waitForTimeout(3000);

    // Extract page info
    const pageData = await page.evaluate(() => {
      // Inline: find schedule-related containers
      function findScheduleContainers() {
        const containers = [];
        const selectors = [
          '[class*="schedule"]',
          '[class*="timetable"]',
          '[class*="calendar"]',
          '[class*="class-list"]',
          '[id*="schedule"]',
          '[id*="timetable"]',
          '[class*="time-table"]',
          '[class*="weekly"]',
        ];
        for (const sel of selectors) {
          try {
            const els = document.querySelectorAll(sel);
            els.forEach((el) => {
              containers.push(el.innerText.substring(0, 3000));
            });
          } catch (e) { /* ignore */ }
        }
        return containers;
      }

      return {
        title: document.title,
        url: window.location.href,
        html: document.documentElement.outerHTML,
        text: document.body.innerText.substring(0, 15000),
        meta: {
          description:
            document
              .querySelector('meta[name="description"]')
              ?.getAttribute("content") || "",
          keywords:
            document
              .querySelector('meta[name="keywords"]')
              ?.getAttribute("content") || "",
        },
        tables: Array.from(document.querySelectorAll("table")).map((t) => ({
          headers: Array.from(t.querySelectorAll("th")).map((h) =>
            h.innerText.trim()
          ),
          rows: Array.from(t.querySelectorAll("tr")).map((r) =>
            Array.from(r.querySelectorAll("td, th")).map((c) =>
              c.innerText.trim()
            )
          ),
        })),
        scheduleContainers: findScheduleContainers(),
        images: Array.from(document.querySelectorAll('img[class*="timetable"], img[class*="schedule"], img[alt*="schedule"], img[alt*="timetable"]')).map(i => ({
          src: i.src,
          alt: i.alt,
          width: i.naturalWidth,
          height: i.naturalHeight
        })),
      };
    });

    // Also check API calls for potential data
    pageData.api_calls = apiCalls.filter(c => !c.url.includes('.css') && !c.url.includes('.js') && !c.url.includes('.png') && !c.url.includes('.jpg')).slice(0, 20);
    pageData.api_responses = apiResponses.slice(0, 5);

    await browser.close();

    console.log(`  ✓ Page loaded: ${pageData.title} (${pageData.html.length} chars, ${pageData.api_calls.length} API calls)`);

    let result;

    // Try AI parsing first
    if (useAI && OPENAI_API_KEY && !OPENAI_API_KEY.startsWith("sk_test")) {
      try {
        result = await aiParseCourses(url, pageData);
        result.parsed_by = "ai";
      } catch (aiErr) {
        console.warn(`  ⚠ AI parse failed: ${aiErr.message}, using heuristic`);
        result = heuristicParseCourses(url, pageData);
        result.parsed_by = "heuristic (AI fallback)";
      }
    } else {
      result = heuristicParseCourses(url, pageData);
      result.parsed_by = "heuristic";
    }

    result.crawl_time_ms = Date.now() - startTime;
    result.raw_page = {
      title: pageData.title,
      url: pageData.url,
      text_sample: pageData.text.substring(0, 3000),
      image_timetable: (pageData.images || []).length > 0,
      image_count: (pageData.images || []).length,
      api_calls: pageData.api_calls || [],
      has_tables: (pageData.tables || []).length > 0,
    };

    console.log(
      `  ✓ Found ${result.courses?.length || 0} courses in ${result.crawl_time_ms}ms`
    );
    return { success: true, ...result };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error(`  ✗ Crawl error: ${err.message}`);
    return {
      success: false,
      url,
      error: err.message,
      crawl_time_ms: Date.now() - startTime,
    };
  }
}

/**
 * AI 解析：用 LLM 將 raw HTML 轉成結構化課程資料
 */
async function aiParseCourses(url, pageData) {
  const OpenAI = require("openai");
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const prompt = `你係 ZenPass 課程資料擷取專家。

請從以下網頁內容中，擷取所有課程/課堂資訊。

網址：${url}
頁面標題：${pageData.title}

網頁 HTML 內容：
${pageData.text.substring(0, 8000)}

請以 JSON array 回覆，每個課程格式如下：
{
  "title": "課程名稱",
  "category": "運動類別（瑜伽/健身/舞蹈/伸展/冥想/其他）",
  "description": "課程簡介（如果有的話）",
  "instructor": "教練姓名（如果有的話）",
  "duration_min": 60,
  "price_hkd": 0,
  "level": "初學/進階/所有程度",
  "language": "粵語/英語/普通話",
  "schedules": [
    {
      "day_of_week": "Monday",
      "start_time": "10:00",
      "end_time": "11:00",
      "location": "場地/分店名稱"
    }
  ]
}

注意：
- 如果價格係試堂價/單堂價，price_hkd 填實際數字
- 如果只有 timetable 冇價格，price_hkd 填 0
- 只回覆 JSON array，唔好加其他文字`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a course data extraction expert. Reply ONLY with valid JSON array." },
      { role: "user", content: prompt },
    ],
    max_tokens: 4000,
    temperature: 0.1,
  });

  const text = completion.choices[0].message.content;
  // Strip ```json ... ``` if present
  const cleanJson = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const courses = JSON.parse(cleanJson);

  // Infer venue name from page title or URL
  const venueName = inferVenueName(url, pageData.title);

  return {
    venue: {
      name: venueName,
      source_url: url,
      inferred: true,
    },
    courses: Array.isArray(courses) ? courses : [],
  };
}

/**
 * Heuristic 解析：用 DOM 結構 heuristic 提取課程
 * 冇 AI 時用，或者 AI 失敗時 fallback
 */
function heuristicParseCourses(url, pageData) {
  // Look for timetable-like structures
  const courses = [];
  const seen = new Set();

  // 1. Check tables
  for (const table of pageData.tables || []) {
    for (const row of table.rows) {
      for (const cell of row) {
        const lower = cell.toLowerCase();
        // Skip header-like cells
        if (cell.length < 3 || cell.length > 100) continue;
        // Skip common non-course text
        if (/^(mon|tue|wed|thu|fri|sat|sun|time|day|class|課堂|時間|地點)$/i.test(cell.trim())) continue;

        const key = cell.trim().substring(0, 40);
        if (!seen.has(key)) {
          seen.add(key);
          courses.push({
            title: cell.trim(),
            source: "table_cell",
            confidence: "low",
          });
        }
      }
    }
  }

  // 2. Check schedule containers (divs with class/ID containing "schedule" or "timetable")
  for (const container of pageData.scheduleContainers || []) {
    const entries = container.match(/[A-Z][a-z]+day\s+\d{1,2}:\d{2}[-–]\d{1,2}:\d{2}\s+[^\n]{3,50}/g);
    if (entries) {
      for (const entry of entries) {
        if (!seen.has(entry.substring(0, 40))) {
          seen.add(entry.substring(0, 40));
          courses.push({
            title: entry.trim(),
            source: "schedule_container",
            confidence: "medium",
          });
        }
      }
    }
  }

  // 3. Try to extract day+time patterns from text
  const dayPattern = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun|星期一|星期二|星期三|星期四|星期五|星期六|星期日)/gi;
  const timePattern = /\b(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\b/g;
  const lines = (pageData.text || "").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length < 5 || line.length > 150) continue;

    const hasDay = dayPattern.test(line);
    const hasTime = timePattern.test(line);

    if (hasDay && hasTime) {
      const key = line.substring(0, 60);
      if (!seen.has(key)) {
        seen.add(key);
        courses.push({
          title: line,
          source: "text_pattern",
          confidence: "medium",
        });
      }
    }
  }

  // Deduplicate by title
  const unique = [];
  const titleSet = new Set();
  for (const c of courses) {
    const t = c.title.toLowerCase().trim();
    if (!titleSet.has(t) && t.length > 3) {
      titleSet.add(t);
      unique.push(c);
    }
  }

  return {
    venue: {
      name: inferVenueName(url, pageData.title),
      source_url: url,
      inferred: true,
    },
    courses: unique.slice(0, 50), // cap at 50
  };
}

/**
 * 從 URL 同 title infer 場地名稱
 */
function inferVenueName(url, title) {
  try {
    const u = new URL(url);
    // Try to extract from hostname
    const hostParts = u.hostname.replace("www.", "").split(".");
    if (hostParts.length >= 2) {
      const name = hostParts[0]
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return name;
    }
  } catch (e) {
    // fallback
  }
  // Use title's first meaningful part
  const cleanTitle = title.replace(/\s*\|\s*.*$/, "").trim();
  return cleanTitle || "Unknown Venue";
}

/**
 * 批量爬取多個場地
 */
async function crawlMultipleVenues(urls, options = {}) {
  const results = [];
  for (const url of urls) {
    const result = await crawlVenueCourses(url, options);
    results.push(result);
    // Rate limit: wait between requests
    await new Promise((r) => setTimeout(r, 2000));
  }
  return results;
}

module.exports = {
  crawlVenueCourses,
  crawlMultipleVenues,
};
