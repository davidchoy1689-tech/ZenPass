/**
 * ZenPass — AI 開班：多通道一致性投票 + OCR 自學字典 tests
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
const tmp = path.join(os.tmpdir(), "zenpass-ai-vote-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => {
  if (c) console.log("  ✅ " + m);
  else {
    console.log("  ❌ " + m);
    fail++;
  }
};

(async () => {
  const pre = new Database(tmp);
  pre.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, credits REAL DEFAULT 0,
    role TEXT DEFAULT 'user', is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT);`);
  pre.close();

  await require("../src/config/init-db")();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { parseClassText, mergeDrafts, applyCorrections, loadCorrections, dice } =
    require("../src/services/ai-class-parser");

  console.log("🧪 多通道投票 + 自學字典 tests");

  // ── 一致性投票 ──
  const a = parseClassText("木柱體驗班\n10月21日 19:00-20:30\n費用：$150\n名額：12人".replace("{", ""), { now: "2026-10-20T12:00:00Z" });
  const b = parseClassText("木柱體驗班\n10月21日 19:00-20:30\n費用：$150", { now: "2026-10-20T12:00:00Z" });
  const c = parseClassText("木柱體驗班\n10月21日 19:00-20:30\n費用：$180\n名額：9人", { now: "2026-10-20T12:00:00Z" });
  const m = mergeDrafts([a, b, c]);
  ok(m.draft.title === "木柱體驗班", "標題三通道一致 → 採用");
  ok(m.field_confidence.title === 1, "標題信心 1.0（3/3 通道一致）");
  ok(m.draft.price_hkd === 150, "價錢 2:1 投票 → 150（少數服從多數）");
  ok(m.field_confidence.price_hkd > 0.6 && m.field_confidence.price_hkd < 1, "價錢信心被標示為中等（2/3）");
  ok(m.draft.schedules.length === 1, "場次去重後只有 1 個");

  const sparse = mergeDrafts([parseClassText("太極班", { now: "2026-10-20T12:00:00Z" })]);
  ok(sparse.draft.needs_review === true, "資料不足 → needs_review");
  ok((sparse.draft.missing_fields || []).includes("price_hkd"), "指出缺少 price_hkd");

  // ── 自學字典 ──
  ok(typeof dice("地点", "地點") === "number", "dice 相似度可計算");
  ok(dice("地点","地点") === 1, "完全相同 → 1.0");

  db.prepare(
    "INSERT INTO ocr_corrections (field, from_text, to_text, hits) VALUES (?,?,?,1) ON CONFLICT(field, from_text) DO UPDATE SET to_text=excluded.to_text, hits=hits+1",
  ).run("venue_name", "观塘 APM 体育馆3樓", "觀塘 APM 體育館 3樓");

  const rules = loadCorrections(db, "venue_name");
  ok(rules.length === 1, "讀到 1 條字典規則");

  const hit = applyCorrections("观塘 APM 体育馆3樓", rules);
  ok(hit.value === "觀塘 APM 體育館 3樓", "同一個 OCR 錯法 → 自動修正為正確寫法");
  ok(hit.learned && hit.learned.score === 1, "標記為 learned");

  const near = applyCorrections("观塘APM体育馆3樓", rules);
  ok(near.value === "觀塘 APM 體育館 3樓", "近似寫法（少空格）都修正到");

  const unrelated = applyCorrections("沙田大會堂", rules);
  ok(unrelated.value === "沙田大會堂" && !unrelated.learned, "唔相似 → 唔會亂改");

  // 累積 hits
  db.prepare(
    "INSERT INTO ocr_corrections (field, from_text, to_text, hits) VALUES (?,?,?,1) ON CONFLICT(field, from_text) DO UPDATE SET to_text=excluded.to_text, hits=hits+1",
  ).run("venue_name", "观塘 APM 体育馆3樓", "觀塘 APM 體育館 3樓");
  const hits = db.prepare("SELECT hits FROM ocr_corrections WHERE field='venue_name'").get().hits;
  ok(hits === 2, "同一修正重複出現 → hits 累加（2）");

  try {
    fs.unlinkSync(tmp);
  } catch (e) {}
  console.log(fail === 0 ? "\n✅ 全部通過" : "\n❌ " + fail + " 項失敗");
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("❌ 測試錯誤:", e.message);
  process.exit(1);
});
