#!/usr/bin/env node
/* seed-weekend-classes.cjs — 開 2 個週末新興運動體驗班（芬蘭木柱 / 地板冰壺）
 * 預設 dry-run，唔會寫 DB；要真正寫入加 --apply
 * 用法（VPS）：
 *   cd /var/www/zenpass/backend && node ../scripts/seed-weekend-classes.cjs           # 睇會做咩
 *   cd /var/www/zenpass/backend && node ../scripts/seed-weekend-classes.cjs --apply   # 真正寫入
 * 價錢／優惠屬金錢設定，執行前要有 David 明確批准。
 */
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const APPLY = process.argv.includes("--apply");
const DB_PATH = process.env.ZP_DB || path.resolve(__dirname, "..", "backend", "data", "zenpass.db");
const db = new Database(DB_PATH);

const COACH_EMAIL = "coach@zenpass.hk";
const VENUE_NAME = "觀塘・新興運動推廣社";
const VENUE_ID = "65c960ab-5142-4d93-93a3-c6617a528c53"; // 新興運動推廣社（觀塘）

// 2026-10-31 星期六 / 11-01 星期日，14:00–15:30（HKT = UTC+8 → 06:00Z）
const PLAN = [
  {
    title: "芬蘭木柱體驗班（週末場）",
    title_en: "Mölkky Weekend Taster",
    category: "新興運動",
    sport_slug: "molkky",
    duration: 90,
    price_hkd: 150,
    credits_cost: 15,
    max_participants: 20,
    description:
      "源自芬蘭的投擲木柱運動，規則 3 分鐘學識。擲倒木柱計分、剛好 50 分即勝，講手感亦講策略。零運動底子都玩得，最適合朋友聚會同公司團建。",
    schedules: ["2026-10-31T06:00:00.000Z", "2026-11-01T06:00:00.000Z"],
  },
  {
    title: "地板冰壺體驗班（週末場）",
    title_en: "Floor Curling Weekend Taster",
    category: "新興運動",
    sport_slug: "floor-curling",
    duration: 90,
    price_hkd: 150,
    credits_cost: 15,
    max_participants: 20,
    description:
      "冰壺的陸上版，唔使上冰都玩到。講力度同角度，策略性強、低衝擊，長者同新手一樣玩得開心；最後一壺反勝最刺激。",
    schedules: ["2026-10-31T08:00:00.000Z", "2026-11-01T08:00:00.000Z"], // 16:00–17:30 HKT
  },
];

const coach = db.prepare("SELECT id, name FROM users WHERE email = ?").get(COACH_EMAIL);
if (!coach) {
  console.error("❌ 搵唔到教練:", COACH_EMAIL);
  process.exit(1);
}

const now = new Date().toISOString().replace("T", " ").slice(0, 19);
let created = 0, skipped = 0;

for (const p of PLAN) {
  const exists = db
    .prepare("SELECT id FROM classes WHERE title = ? AND status = 'active'")
    .get(p.title);
  if (exists) {
    console.log(`⏭  已存在，跳過：${p.title} (${exists.id})`);
    skipped++;
    continue;
  }
  const id = crypto.randomUUID();
  console.log(`${APPLY ? "➕ 建立" : "（dry-run）會建立"} ${p.title}`);
  console.log(`   id=${id} coach=${coach.name} 場地=${VENUE_NAME}`);
  console.log(`   HK$${p.price_hkd} / ${p.credits_cost} credits · ${p.duration} 分鐘 · 上限 ${p.max_participants} 人`);
  console.log(`   班次：${p.schedules.map((s) => new Date(s).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })).join("  |  ")}`);

  if (!APPLY) continue;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO classes
       (id, coach_id, title, title_en, description, category, difficulty, duration,
        max_participants, price_hkd, credits_cost, venue_name, status, created_at, updated_at,
        partner_venue_id, sport_slug, district, booking_open)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, coach.id, p.title, p.title_en, p.description, p.category, "beginner", p.duration,
      p.max_participants, p.price_hkd, p.credits_cost, VENUE_NAME, "active", now, now,
      VENUE_ID, p.sport_slug, "觀塘", 1
    );
    const ins = db.prepare(
      `INSERT INTO class_schedules
       (id, class_id, start_time, end_time, max_participants, enrolled_count, status, created_at)
       VALUES (?,?,?,?,?,0,'available',?)`
    );
    for (const st of p.schedules) {
      const end = new Date(new Date(st).getTime() + p.duration * 60000).toISOString();
      ins.run(crypto.randomUUID(), id, st, end, p.max_participants, now);
    }
  });
  tx();
  created++;
}

console.log(`\n${APPLY ? "✅ 完成" : "（dry-run 完）"} 新建 ${created} 個班，跳過 ${skipped} 個。`);
if (!APPLY) console.log("要真正寫入：加 --apply");
