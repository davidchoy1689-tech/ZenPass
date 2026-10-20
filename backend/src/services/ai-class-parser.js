/**
 * ZenPass — AI 開班：文字／相片 → 課堂草稿
 *
 * 設計原則
 *  1. 唔靠外部收費 API：相片用本機 tesseract OCR（chi_tra/chi_sim/eng），零成本、資料唔出境
 *  2. 只做「草稿」：所有欄位都會返去前端俾人核對／修改，確認後才建立課堂
 *  3. 純函數解析（parseClassText）可以獨立測試
 */
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HK_OFFSET_MS = 8 * 3600 * 1000;

// 運動關鍵字 → 分類 / sport_slug（同 data/sport icons 對應）
const SPORTS = [
  { re: /(芬蘭)?木柱|mölkky|molkky/i, name: "芬蘭木柱", category: "新興運動", slug: "molkky" },
  { re: /(地板)?冰壺|地壺/i, name: "地板冰壺", category: "新興運動", slug: "floor-curling" },
  { re: /布袋球|cornhole/i, name: "布袋球", category: "新興運動", slug: "cornhole" },
  { re: /穿雲箭|air\s*storm/i, name: "穿雲箭", category: "新興運動", slug: "air-storm" },
  { re: /北歐式健步|nordic\s*walk/i, name: "北歐式健步行", category: "新興運動", slug: "nordic-walking" },
  { re: /圓網球|roundnet|spikeball/i, name: "圓網球", category: "新興運動", slug: "roundnet" },
  { re: /柔力球/i, name: "柔力球", category: "新興運動", slug: "rouliqiu" },
  { re: /瑜伽|yoga|瑜珈/i, name: "瑜伽", category: "瑜伽", slug: "yoga" },
  { re: /伸展|stretch/i, name: "伸展", category: "伸展", slug: "stretch" },
  { re: /冥想|meditation|正念/i, name: "冥想", category: "冥想", slug: "meditation" },
  { re: /trx/i, name: "TRX 懸吊訓練", category: "TRX 懸吊訓練", slug: "trx" },
  { re: /劍擊|fencing/i, name: "劍擊", category: "劍擊", slug: "fencing" },
  { re: /乒乓/i, name: "乒乓球", category: "乒乓球", slug: "table-tennis" },
  { re: /保齡/i, name: "保齡球", category: "保齡球", slug: "bowling" },
  { re: /兒童|小朋友|幼兒/i, name: "兒童體適能", category: "兒童體適能", slug: "kids-fitness" },
  { re: /長者|銀齡|老友記/i, name: "長者體適能", category: "長者體適能", slug: "senior-fitness" },
  { re: /舞蹈|跳舞|dance|k-?pop/i, name: "舞蹈", category: "舞蹈", slug: "dance" },
  { re: /健身|重訓|gym|fitness/i, name: "健身", category: "健身", slug: "fitness" },
];

const WEEKDAY = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

const META_LINE = /^(地點|場地|地址|費用|收費|價錢|價格|名額|人數|上限|查詢|報名|電話|whatsapp|聯絡|日期|時間|對象|導師|教練|主辦|備註)\s*[:：]/i;

/**
 * OCR 後處理：tesseract 對中文常會插入空格、用全角標點、簡繁混雜。
 * 呢步只做「還原成人睇得明嘅格式」，唔會改動數字。
 */
function normalizeOcr(s) {
  return String(s || "")
    .replace(/[﹕ː:：]/g, ":")
    .replace(/[﹩＄]/g, "$")
    .replace(/[﹣－—–−]/g, "-")
    .replace(/[～~]/g, "~")
    .replace(/[﹙]/g, "(")
    .replace(/[﹚]/g, ")")
    .replace(/[﻿]/g, "")
    // 中文字之間嘅多餘空格
    .replace(/([\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, "$1")
    // 中文 ↔ 數字／標點之間嘅空格（"10 月 21 日" → "10月21日"）
    .replace(/([\u4e00-\u9fff])[ \t]+(?=[\d$:(])/g, "$1")
    .replace(/([\d$）)])[ \t]+(?=[\u4e00-\u9fff])/g, "$1")
    // 簡體關鍵字 → 繁體（只限宣傳單張常見字，避免誤改地名／品牌）
    .replace(/地点/g, "地點")
    .replace(/时间/g, "時間")
    .replace(/费用/g, "費用")
    .replace(/名额/g, "名額")
    .replace(/查询/g, "查詢")
    .replace(/价[钱錢]/g, "價錢")
    .replace(/^地\s*點/gm, "地點")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function stripTags(s) {
  return String(s || "")
    // WhatsApp / Telegram 粗體斜體標記（*文字* _文字_ `code` ~刪除線~）
    .replace(/[*_`~＊]+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .trim();
}

/**
 * 由一行文字抽出「似標題」嘅部分（處理單行貼上：日期時間價錢同一行）
 */
function titleFromLine(line) {
  let t = String(line || "");
  // 1) 斬走「費用：…」「查詢：…」等尾段
  t = t.split(/(?:日期|時間|地點|場地|地址|費用|收費|價錢|價格|名額|人數|上限|查詢|報名|電話|whatsapp|聯絡)\s*[:：]?/i)[0];
  // 2) 斬走開頭嘅日期（年/月/日 或 日/月）
  t = t.replace(/^[\s:：,，]*\d{4}\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*日?/, "");
  t = t.replace(/^[\s:：,，]*\d{1,2}\s*[年\/\-.]\s*\d{1,2}\s*[日\/\-.]?(\s*\d{2,4})?/, "");
  t = t.replace(/^[\s:：,，]*\d{1,2}\s*月\s*\d{1,2}\s*日?/, "");
  // 3) 斬走開頭嘅時間範圍
  t = t.replace(/^[\s:：,，]*(?:上午|下午|晚上|早上|中午|am|pm)?\s*\d{1,2}(?:[:：]\d{2})?\s*(?:am|pm|上午|下午|晚上|早上|中午)?\s*[-–~至到]\s*\d{1,2}(?:[:：]\d{2})?\s*(?:am|pm|上午|下午|晚上|早上|中午)?/i, "");
  // 4) 斬走殘留價錢
  t = t.replace(/^[\s:：,，]*(?:HK\s*\$|\$)?\s*\d+(?:\.\d+)?\s*(?:元|蚊)?/, "");
  return t.replace(/^[\s:：,，\-–—•·]+/, "").replace(/[\s:：,，\-–—]+$/, "").trim();
}

/**
 * 抽出日期。支援：
 *   2026年10月21日 / 2026-10-21 / 2026/10/21（年在前）
 *   21/10/2026、21-10-26（日/月/年）
 *   10月21日（月/日）
 *   21/10、21-10、5/11（香港慣例：日/月）
 * 含糊情況（兩邊都 ≤12）一律當「日/月」，符合香港寫法。
 * @returns {{dates:Array<{y:number|null,mo:number,d:number}>, masked:string}}
 */
function extractDates(text) {
  let work = String(text || "");
  const dates = [];
  const mask = (m) => {
    work = work.slice(0, m.index) + " ".repeat(m[0].length) + work.slice(m.index + m[0].length);
  };
  const push = (y, mo, d) => {
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) dates.push({ y: y || null, mo, d });
  };

  // 1) 年在前：2026年10月21日 / 2026-10-21 / 2026/10/21
  for (const m of [...work.matchAll(/(\d{4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*日?/g)]) {
    push(Number(m[1]), Number(m[2]), Number(m[3]));
    mask(m);
  }

  // 2) 日在前的三段：21/10/2026、21-10-26
  for (const m of [...work.matchAll(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})/g)]) {
    let d = Number(m[1]);
    let mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (d > 31 || mo > 12) continue;
    if (d > 12 && mo <= 12) {
      /* 明確日/月 */
    } else if (mo > 12 && d <= 12) {
      const t = d;
      d = mo;
      mo = t;
    }
    push(y, mo, d);
    mask(m);
  }

  // 3) 中文月/日：10月21日
  for (const m of [...work.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g)]) {
    push(null, Number(m[1]), Number(m[2]));
    mask(m);
  }

  // 4) 兩段數字：10/21、21/10、5-11（香港＝日/月）
  for (const m of [...work.matchAll(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?![\d:：\/\-.])/g)]) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    let d;
    let mo;
    if (a > 12 && b <= 12) {
      d = a;
      mo = b; // 21/10 → 10月21日
    } else if (b > 12 && a <= 12) {
      d = b;
      mo = a; // 10/21 → 10月21日
    } else {
      d = a;
      mo = b; // 含糊 → 香港慣例 日/月
    }
    push(null, mo, d);
    mask(m);
  }

  return { dates, masked: work };
}

/** 由文字抽出課堂草稿（純函數，方便測試） */
function parseClassText(rawText, opts) {
  opts = opts || {};
  const text = stripTags(normalizeOcr(rawText));
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const flat = lines.join(" ");

  // ── 運動／分類 ──
  let sport = null;
  for (const s of SPORTS) {
    if (s.re.test(flat)) {
      sport = s;
      break;
    }
  }

  // ── 價格 ──
  let price = null;
  const priceMatch =
    flat.match(/(?:HK\s*\$|港幣|\$)\s*([\d,]+(?:\.\d+)?)/i) ||
    flat.match(/([\d,]+)\s*(?:元|蚊|hkd)/i) ||
    flat.match(/(?:費用|收費|價錢|價格)[:：]?\s*([\d,]+)/);
  if (priceMatch) price = Number(String(priceMatch[1]).replace(/,/g, "")) || null;

  // ── 名額 ──
  let capacity = null;
  const capMatch =
    flat.match(/(?:名額|人數|上限|限額)[:：]?\s*(\d{1,3})/) || flat.match(/(\d{1,3})\s*(?:人|位|個名額)/);
  if (capMatch) capacity = Number(capMatch[1]) || null;

  // ── 時長（分鐘）──
  let durationMin = null;
  const durMatch = flat.match(/(\d+(?:\.\d+)?)\s*(?:小時|hrs?|hours?)/i) || flat.match(/(\d{2,3})\s*分鐘/);
  if (durMatch) {
    durationMin = /分鐘/.test(durMatch[0]) ? Number(durMatch[1]) : Math.round(Number(durMatch[1]) * 60);
  }

  // ── 場地 ──
  let venue = null;
  const venueLine = lines.find((l) => /^(地點|场地|地址)\s*[:：]/.test(l));
  if (venueLine) venue = venueLine.replace(/^(地點|场地|地址)\s*[:：]\s*/, "").trim();
  else {
    const vm = flat.match(/(?:地點|場地|地址)[:：]?\s*([^\s,，。;；|]+(?:\s[^\s,，。;；|]+){0,4})/);
    if (vm) venue = vm[1].trim();
  }

  // ── 裝備 ──
  let equipment = null;
  const eqLine = lines.find((l) => /^(裝備|器材|設備|用品)\s*[:：]/.test(l));
  if (eqLine) {
    equipment = eqLine.replace(/^(裝備|器材|設備|用品)\s*[:：]\s*/, "").trim();
  } else {
    const eqInline = flat.match(/(請自備[^。\n,，;；]{0,28}|自備[^。\n,，;；]{0,28}|提供[^。\n,，;；]{0,28}|請帶[^。\n,，;；]{0,24})/);
    if (eqInline) equipment = eqInline[1].trim();
  }
  if (equipment) equipment = equipment.replace(/[*_`~＊]+/g, "").slice(0, 80);

  // ── 日期（支援 日/月/年、年/月/日、10月21日；香港慣例：DD/MM 優先）──
  const parsedDates = extractDates(flat);
  const dates = parsedDates.dates;
  // 已當成日期嘅字串要遮蓋，避免 "21/10" 被誤判成時間範圍
  const flatForTime = parsedDates.masked;

  // 逢星期幾 / 每週X
  const weekly = [...flat.matchAll(/(?:逢|每個|每)\s*(?:星期|週|禮拜|周)?\s*([一二三四五六日天])/g)]
    .map((m) => WEEKDAY[m[1]])
    .filter((d) => d != null);

  // ── 時間 ──
  const times = [];
  const timeRe = /(上午|下午|晚上|早上|中午|am|pm)?\s*(\d{1,2})(?:[:：](\d{2}))?\s*(上午|下午|晚上|早上|中午|am|pm)?\s*[-–~至到]\s*(\d{1,2})(?:[:：](\d{2}))?\s*(上午|下午|晚上|早上|中午|am|pm)?/gi;
  for (const m of flatForTime.matchAll(timeRe)) {
    const t = parseTimePair(m);
    if (t) times.push(t);
  }

  // ── 標題 ──
  let title = null;
  for (const l of lines) {
    if (META_LINE.test(l)) continue;
    if (/^(日期|時間|費用|地點)[:：]/.test(l)) continue;
    if (/^[\d\s:：\-–~至年月日()（）\/.,，]+$/.test(l)) continue;
    if (l.length < 2) continue;
    const cand = titleFromLine(l);
    if (cand && cand.length >= 2 && /[\u4e00-\u9fffA-Za-z]/.test(cand)) {
      title = cand.slice(0, 60);
      break;
    }
    continue;
  }
  if (!title) title = sport ? sport.name + "體驗班" : "";

  // ── 組 schedules ──
  const now = opts.now ? new Date(opts.now) : new Date();
  const hkNow = new Date(now.getTime() + HK_OFFSET_MS);
  const schedules = [];
  const slot = times[0] || null;

  if (slot) {
    for (const d of dates) {
      const year = d.y || hkNow.getUTCFullYear();
      const startISO = hkToISO(year, d.mo, d.d, slot.startMin);
      if (!startISO) continue;
      schedules.push({
        start_time: startISO,
        end_time: hkToISO(year, d.mo, d.d, slot.endMin) || undefined,
        recurring: "none",
      });
    }
    if (!dates.length && weekly.length) {
      // 由下一個符合嘅星期幾開始，共 4 堂
      for (const dow of weekly) {
        let base = new Date(hkNow.getTime());
        for (let i = 0; i < 8; i++) {
          const cand = new Date(base.getTime() + i * 86400000);
          if (cand.getUTCDay() === dow) {
            for (let w = 0; w < 4; w++) {
              const day = new Date(cand.getTime() + w * 7 * 86400000);
              const iso = hkToISO(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), slot.startMin);
              const endIso = hkToISO(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), slot.endMin);
              if (iso) schedules.push({ start_time: iso, end_time: endIso || undefined, recurring: "weekly" });
            }
            break;
          }
        }
      }
    }
    if (!schedules.length && !dates.length && !weekly.length) {
      // 只有時間冇日期 → 明日同一時段（草稿用，等人改）
      const tmr = new Date(hkNow.getTime() + 86400000);
      schedules.push({
        start_time: hkToISO(tmr.getUTCFullYear(), tmr.getUTCMonth() + 1, tmr.getUTCDate(), slot.startMin),
        end_time: hkToISO(tmr.getUTCFullYear(), tmr.getUTCMonth() + 1, tmr.getUTCDate(), slot.endMin),
        recurring: "none",
      });
    }
  }

  // 去重：OCR 兩次可能抽到同一場次（格式略異）
  const seenSlots = new Set();
  const uniqSchedules = schedules.filter((s) => {
    if (!s.start_time || seenSlots.has(s.start_time)) return false;
    seenSlots.add(s.start_time);
    return true;
  });

  if (!durationMin && slot) durationMin = slot.endMin - slot.startMin;

  // ── 描述（自動分段：剷走報名／價錢等行政資料，保留課堂內容）──
  const descLines = lines
    .filter((l) => l !== title)
    .filter((l) => !/^(查詢|報名|電話|whatsapp|聯絡)[:：]/i.test(l))
    .filter((l) => !META_LINE.test(l))
    .filter((l) => !/^(星期|逢|每(?:個)?(?:星期|週|禮拜))\s*[:：]?/.test(l))
    .map((l) => l.trim())
    .filter(Boolean);
  let description = descLines.join("\n").slice(0, 1200);
  // 單一大段（例如一段過嘅 WhatsApp 文字）→ 按句號／問號分段，方便閱讀
  if (description && !description.includes("\n") && description.length > 90) {
    description = description.replace(/([。！？!?；;])\s*/g, "$1\n\n").trim();
  }

  const confidence = [title ? 1 : 0, sport ? 1 : 0, price ? 1 : 0, schedules.length ? 1 : 0].reduce((a, b) => a + b, 0);

  return {
    title,
    title_en: null,
    description,
    category: sport ? sport.category : "新興運動",
    sport_slug: sport ? sport.slug : null,
    difficulty: "beginner",
    duration: durationMin || 60,
    max_participants: capacity || 15,
    price_hkd: price || 0,
    credits_cost: price ? Math.round(price / 10) : 0,
    venue_name: venue,
    venue_address: venue,
    equipment,
    image_url: null,
    schedules: uniqSchedules,
    confidence, // 0–4
    needs_review: confidence < 3 || !uniqSchedules.length,
    source: { chars: text.length, lines: lines.length },
  };
}

function parseTimePair(m) {
  // groups: 1 pre-mer1, 2 h1, 3 m1, 4 post-mer1, 5 h2, 6 m2, 7 mer2
  const h1 = Number(m[2]);
  const mi1 = m[3] ? Number(m[3]) : 0;
  const h2 = Number(m[5]);
  const mi2 = m[6] ? Number(m[6]) : 0;
  if (!(h1 >= 0 && h1 <= 24) || !(h2 >= 0 && h2 <= 24)) return null;

  const mer1 = String(m[1] || m[4] || "").toLowerCase();
  const mer2 = String(m[7] || "").toLowerCase();
  const pmish = (x) => /pm|下午|晚上|中午/.test(x);
  const amish = (x) => /am|上午|早上/.test(x);

  let s = h1 * 60 + mi1;
  if (pmish(mer1) && h1 < 12) s += 12 * 60;
  if (amish(mer1) && h1 === 12) s -= 12 * 60;
  if (!mer1 && pmish(mer2) && h1 < 12) s += 12 * 60;

  let e = h2 * 60 + mi2;
  if (pmish(mer2) && h2 < 12) e += 12 * 60;
  if (amish(mer2) && h2 === 12) e -= 12 * 60;
  if (!mer2 && pmish(mer1) && h2 < 12) e += 12 * 60;
  if (e <= s) e += 12 * 60;

  return { startMin: s, endMin: e };
}

/** 香港本地時間 → UTC ISO（資料庫一律存 UTC） */
function hkToISO(year, month, day, minutes) {
  const ms = Date.UTC(year, month - 1, day, 0, 0, 0) + minutes * 60000 - HK_OFFSET_MS;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** 圖片前處理（可選，失敗就 fallback 原圖） */
function preprocessImage(file) {
  return new Promise((resolve) => {
    const out = file.replace(/\.[a-z0-9]+$/i, "") + "-pre.png";
    execFile(
      "python3",
      [path.join(__dirname, "..", "..", "scripts", "preprocess-image.py"), file, out, "2"],
      { timeout: 30000 },
      (err, stdout) => {
        if (err) return resolve({ ok: false, file });
        try {
          const j = JSON.parse(String(stdout || "{}"));
          if (j.ok) return resolve({ ok: true, file: out, inverted: j.inverted || null, meta: j });
        } catch (e) {}
        resolve({ ok: false, file });
      },
    );
  });
}

/** 單通道 OCR */
function runTesseract(file, psm) {
  return new Promise((resolve) => {
    execFile(
      "tesseract",
      [file, "stdout", "-l", "chi_tra+chi_sim+eng", "--psm", String(psm)],
      { timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve(err ? "" : String(stdout || "")),
    );
  });
}

/**
 * 多通道 OCR：原圖 psm6 + 前處理後 psm 3/4/6，逐通道交返文字，
 * 畀上層做「一致性投票」（同一欄位多通道都抽到 → 高信心）。
 */
async function ocrChannels(buffer, ext = "png") {
  const file = path.join(os.tmpdir(), `zp-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  fs.writeFileSync(file, buffer);
  try {
    const pre = await preprocessImage(file);
    const jobs = [
      { source: "original", psm: 6, file },
      { source: "enhanced", psm: 6, file: pre.file },
      { source: "enhanced", psm: 3, file: pre.file },
    ];
    if (pre.inverted) {
      jobs.push({ source: "inverted", psm: 3, file: pre.inverted });
    }
    const texts = await Promise.all(jobs.map((j) => runTesseract(j.file, j.psm)));
    const channels = jobs
      .map((j, i) => ({ source: j.source, psm: j.psm, text: texts[i] || "" }))
      .filter((c) => c.text.trim());
    if (!channels.length) throw new Error("OCR returned empty");
    return { channels, preprocess: pre.ok ? pre.meta : null };
  } finally {
    try {
      fs.unlinkSync(file);
    } catch (e) {}
  }
}

/** 兼容舊介面：合併所有通道文字 */
async function ocrImage(buffer, ext = "png") {
  const { channels } = await ocrChannels(buffer, ext);
  const seen = new Set();
  const merged = [];
  for (const ch of channels) {
    for (const line of ch.text.split("\n")) {
      const key = line.replace(/\s+/g, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(line);
    }
  }
  return merged.join("\n");
}

// ==================== 一致性投票 ====================

function dice(a, b) {
  const x = String(a || "").replace(/\s+/g, "").toLowerCase();
  const y = String(b || "").replace(/\s+/g, "").toLowerCase();
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bigrams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const A = bigrams(x);
  const B = bigrams(y);
  let hit = 0;
  for (const [g, c] of A) hit += Math.min(c, B.get(g) || 0);
  const total = Math.max(1, x.length - 1 + y.length - 1);
  return (2 * hit) / total;
}

const VOTE_FIELDS = [
  "title",
  "category",
  "sport_slug",
  "price_hkd",
  "credits_cost",
  "max_participants",
  "duration",
  "venue_name",
];

/** 中文比例（用嚟判斷標題係咪亂碼） */
function cjkRatio(v) {
  const s = String(v || "");
  if (!s) return 0;
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk / s.length;
}

/** 單一草稿品質分：抽到幾多個有意義欄位（用嚟揀最可信嘅通道，而非少數服從多數） */
function draftScore(d) {
  if (!d) return -1;
  let sc = 0;
  if (d.title && cjkRatio(d.title) >= 0.5) sc += 3;
  if (Number(d.price_hkd) > 0) sc += 3;
  if ((d.schedules || []).length) sc += 2;
  if (Number(d.duration) > 0) sc += 1;
  if (Number(d.max_participants) > 0) sc += 1;
  if (d.venue_name && cjkRatio(d.venue_name) >= 0.4) sc += 2;
  if (d.category) sc += 1;
  return sc;
}

/**
 * 多通道草稿合併：以「品質最高」嘅通道做主稿，其餘通道只用作
 * ① 補缺欄位 ② 交叉確認（提升信心）。避免兩個差通道一齊錯就蓋過好通道。
 */
function mergeDrafts(drafts) {
  const list = (drafts || []).filter(Boolean);
  if (!list.length) throw new Error("no drafts");

  const scored = list.map((d, i) => ({ d, i, score: draftScore(d) }));
  scored.sort((a, b) => b.score - a.score);
  const base = scored[0].d;
  const out = Object.assign({}, base);
  const fieldConfidence = {};

  for (const f of VOTE_FIELDS) {
    const vals = list
      .map((d) => d[f])
      .filter((v) => v !== null && v !== undefined && v !== "" && !(typeof v === "number" && v === 0));
    const hasBase =
      !(out[f] === null || out[f] === undefined || out[f] === "" || (typeof out[f] === "number" && out[f] === 0));

    if (!hasBase) {
      const pick = majority(vals);
      if (pick.value !== null) {
        out[f] = pick.value;
        fieldConfidence[f] = Math.round(pick.ratio * 50) / 100;
      } else {
        fieldConfidence[f] = 0;
      }
      continue;
    }

    const same = (v) => (typeof out[f] === "number" ? v === out[f] : dice(out[f], v) >= 0.8);
    const support = vals.filter(same).length;
    // 信心 = 支持數 / 有提供此欄位嘅通道數（唔係全部通道）
    fieldConfidence[f] = Math.round((support / Math.max(1, vals.length)) * 100) / 100;

    // 主稿只係少數、而有另一個值獲多數支持 → 改用多數值
    if (support / Math.max(1, vals.length) < 0.5) {
      const pick = majority(vals);
      if (pick.value !== null && pick.ratio > support / Math.max(1, vals.length) && !same(pick.value)) {
        out[f] = pick.value;
        fieldConfidence[f] = Math.round(pick.ratio * 100) / 100;
      }
    }

    if (f === "title" && cjkRatio(out[f]) < 0.5) {
      const bestTitle = list
        .map((d) => d.title)
        .filter(Boolean)
        .sort((a, b) => cjkRatio(b) - cjkRatio(a) || b.length - a.length)[0];
      if (bestTitle) out.title = bestTitle;
    }
  }

  // 場次：主稿優先，再併入至少兩個通道都抽到嘅時間
  const slotCount = new Map();
  for (const d of list) {
    const seen = new Set();
    for (const s of d.schedules || []) {
      if (!s.start_time || seen.has(s.start_time)) continue;
      seen.add(s.start_time);
      slotCount.set(s.start_time, (slotCount.get(s.start_time) || 0) + 1);
    }
  }
  const need = Math.max(2, Math.ceil(list.length / 2));
  const confirmed = [...slotCount.entries()].filter(([, c]) => c >= need).map(([t]) => t);
  const baseSlots = (base.schedules || []).map((s) => s.start_time).filter(Boolean);
  const chosen = [...new Set([...baseSlots, ...confirmed])].sort();

  out.schedules = chosen.map((t) => {
    const from = list.flatMap((d) => d.schedules || []).find((s) => s.start_time === t) || {};
    return { start_time: t, end_time: from.end_time || null, recurring: from.recurring || "none" };
  });
  fieldConfidence.schedules = out.schedules.length ? (confirmed.length ? 1 : 0.6) : 0;

  out.description = list.map((d) => d.description || "").sort((a, b) => b.length - a.length)[0] || "";
  out.confidence = Math.min(4, Math.round(Object.values(fieldConfidence).reduce((a, b) => a + b, 0)));
  out.missing_fields = ["title", "price_hkd"].filter((f) => !out[f]).concat(out.schedules.length ? [] : ["schedules"]);
  const weakTitle = (fieldConfidence.title || 0) < 0.5 && cjkRatio(out.title) < 0.5;
  out.needs_review = out.missing_fields.length > 0 || weakTitle || (fieldConfidence.price_hkd || 0) < 0.34;
  return { draft: out, field_confidence: fieldConfidence, base_channel: scored[0].i };
}

/** 眾數（文字用相似度 0.85 聚類） */
function majority(vals) {
  if (!vals.length) return { value: null, ratio: 0 };
  const clusters = [];
  for (const v of vals) {
    const hit = clusters.find((c) =>
      typeof v === "number" ? c.value === v : dice(c.value, v) >= 0.85,
    );
    if (hit) {
      hit.count++;
      if (String(v).length > String(hit.value).length) hit.value = v;
    } else clusters.push({ value: v, count: 1 });
  }
  clusters.sort((a, b) => b.count - a.count || String(b.value).length - String(a.value).length);
  return { value: clusters[0].value, ratio: clusters[0].count / vals.length };
}

// ==================== 自學字典 ====================

/** 讀取字典（field + from_text → to_text） */
function loadCorrections(db, field) {
  try {
    return db
      .prepare("SELECT field, from_text, to_text FROM ocr_corrections WHERE field = ? OR field = '*'")
      .all(field);
  } catch (e) {
    return [];
  }
}

/** 用字典修正一個欄位（相似度 >= 0.72 才套用，避免亂改） */
function applyCorrections(value, rules) {
  if (value == null || value === "") return { value, learned: null };
  let best = null;
  for (const r of rules || []) {
    const score = dice(r.from_text, value);
    if (score >= 0.72 && (!best || score > best.score)) best = { rule: r, score };
  }
  if (!best) return { value, learned: null };
  return { value: best.rule.to_text, learned: { from: value, to: best.rule.to_text, score: Math.round(best.score * 100) / 100 } };
}

module.exports = {
  extractDates,
  parseClassText,
  ocrImage,
  ocrChannels,
  mergeDrafts,
  loadCorrections,
  applyCorrections,
  dice,
  hkToISO,
  normalizeOcr,
  SPORTS,
};
