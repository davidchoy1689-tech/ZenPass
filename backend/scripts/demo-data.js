#!/usr/bin/env node
/**
 * ZenPass — 示範資料（Demo data）管理工具
 *
 * 用途：網站未正式上架時，用嚟開／關一批「示範課程」，方便內部測試、截圖、畀客睇 demo。
 * 原則：
 *   1. 示範課程一律 id 前綴 `demo-`，方便一次過清除。
 *   2. 示範課程預設 `status='inactive'`（唔會出現在公開列表）；用 --active 才公開展示。
 *   3. 唔會碰任何金錢紀錄（bookings / wallet / earnings / ledger）。
 *
 * 用法（喺 backend/ 執行）：
 *   node scripts/demo-data.js status
 *   node scripts/demo-data.js restore [--active]
 *   node scripts/demo-data.js purge
 *   node scripts/demo-data.js archive [檔案路徑]   # 由舊 archive JSON 還原
 */
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "zenpass.db");
const Database = require("better-sqlite3");
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

const DEMO_COACH_EMAIL = "coach@zenpass.hk";

const DEMO_CLASSES = [
  ["芬蘭木柱 Mölkky 體驗班", "新興運動", 100, 60, 10],
  ["地板冰壺 Floor Curling 入門", "新興運動", 120, 60, 10],
  ["布袋球 Cornhole 同樂", "新興運動", 80, 60, 12],
  ["圓網球 Roundnet 挑戰", "新興運動", 90, 60, 10],
  ["穿雲箭 AIR STORM 體驗", "新興運動", 110, 60, 12],
  ["北歐式健步行 Nordic Walking", "戶外及體能", 60, 90, 15],
  ["流瑜伽 Flow Yoga", "身心伸展", 140, 60, 12],
  ["陰瑜伽深度伸展", "身心伸展", 140, 75, 12],
  ["哈達瑜伽 Hatha Yoga", "身心伸展", 140, 60, 12],
  ["空中瑜伽 Aerial Yoga", "身心伸展", 180, 60, 8],
  ["普拉提 Pilates 核心訓練", "健體及新興", 160, 60, 10],
  ["HIIT 高強度間歇訓練", "健體及新興", 150, 45, 12],
  ["功能性力量訓練", "健體及新興", 140, 60, 10],
  ["兒童體適能遊戲班", "兒童健體", 120, 45, 10],
  ["柔力球 Rouliqiu 基礎", "健體及新興", 80, 60, 12],
  ["Zumba 舞動燃脂", "舞蹈文化其他", 130, 60, 15],
  ["正念冥想基礎班", "身心伸展", 100, 60, 15],
  ["網球親子同樂班", "球類及其他", 160, 60, 8],
  ["保齡球初體驗 Bowling", "球類及其他", 150, 90, 12],
  ["Flexi-Bar 深層肌筋膜訓練", "健體及新興", 130, 45, 10],
];

function coachId() {
  const u = db.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_COACH_EMAIL);
  return u ? u.id : null;
}

function status() {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS live FROM classes WHERE id LIKE 'demo-%'",
    )
    .get();
  const sched = db
    .prepare(
      "SELECT COUNT(*) AS n FROM class_schedules WHERE class_id LIKE 'demo-%'",
    )
    .get();
  console.log(
    `示範課程：${row.n || 0} 個（公開中：${row.live || 0}）／時段：${sched.n || 0} 個`,
  );
  console.log(`真實課程：${db.prepare("SELECT COUNT(*) c FROM classes WHERE id NOT LIKE 'demo-%'").get().c} 個`);
}

function purge() {
  const ids = db.prepare("SELECT id FROM classes WHERE id LIKE 'demo-%'").all().map((r) => r.id);
  if (!ids.length) return console.log("冇示範課程需要清除。");
  const q = ids.map(() => "?").join(",");
  const bk = db.prepare(`SELECT COUNT(*) c FROM bookings WHERE class_id IN (${q})`).get(...ids).c;
  const ce = db.prepare(`SELECT COUNT(*) c FROM coach_earnings WHERE class_id IN (${q})`).get(...ids).c;
  if (bk || ce) {
    console.error(`⚠️ 示範課程有 ${bk} 個預約／${ce} 筆收入紀錄，為保留審計鏈唔會刪除。`);
    console.error("   改為全部設為 inactive。");
    db.prepare(`UPDATE classes SET status='inactive' WHERE id IN (${q})`).run(...ids);
    return;
  }
  db.transaction(() => {
    db.prepare(`DELETE FROM class_schedules WHERE class_id IN (${q})`).run(...ids);
    db.prepare(`DELETE FROM classes WHERE id IN (${q})`).run(...ids);
  })();
  console.log(`🗑️ 已清除 ${ids.length} 個示範課程及相關時段。`);
}

function restore(opts = {}) {
  const cid = coachId();
  if (!cid) return console.error(`❌ 搵唔到示範教練 ${DEMO_COACH_EMAIL}`);
  const existing = db.prepare("SELECT COUNT(*) c FROM classes WHERE id LIKE 'demo-%'").get().c;
  if (existing) {
    console.log(`已有 ${existing} 個示範課程，先執行 purge 再 restore。`);
    status();
    return;
  }
  const st = opts.active ? "active" : "inactive";
  const insC = db.prepare(
    `INSERT INTO classes (id, coach_id, title, category, description, duration, price_hkd, credits_cost,
                          max_participants, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
  );
  const insS = db.prepare(
    `INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, enrolled_count, status)
     VALUES (?,?,?,?,?,0,'available')`,
  );
  let n = 0;
  db.transaction(() => {
    DEMO_CLASSES.forEach(([title, cat, price, dur, cap], i) => {
      // 固定 id → 重複執行唔會爆，亦方便 purge
      const id = "demo-" + String(i + 1).padStart(3, "0");
      insC.run(
        id,
        cid,
        title,
        cat,
        "示範資料：用於內部測試及展示，非真實課堂。",
        dur,
        price,
        Math.round(price / 10),
        cap,
        st,
      );
      // 每個課程 4 個未來時段
      for (let w = 0; w < 4; w++) {
        const d = new Date();
        d.setDate(d.getDate() + 2 + w * 7);
        d.setHours(19, 0, 0, 0);
        const end = new Date(d.getTime() + dur * 60000);
        insS.run(uuidv4(), id, d.toISOString(), end.toISOString(), cap);
      }
      n++;
    });
  })();
  console.log(`✅ 已建立 ${n} 個示範課程（${st === "active" ? "公開展示" : "隱藏，只供後台預覽"}），每個 4 個時段。`);
}

function restoreFromArchive(file, opts = {}) {
  if (!fs.existsSync(file)) return console.error("❌ 找唔到檔案：" + file);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const cls = data.deleted_classes || data.classes || [];
  const scheds = data.deleted_schedules || data.schedules || [];
  const st = opts.active ? "active" : "inactive";
  let n = 0;
  db.transaction(() => {
    for (const c of cls) {
      const newId = "demo-" + c.id;
      const dup = db.prepare("SELECT id FROM classes WHERE id = ?").get(newId);
      if (dup) continue;
      db.prepare(
        `INSERT INTO classes (id, coach_id, title, category, description, duration, price_hkd, credits_cost,
                              max_participants, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
      ).run(
        newId,
        coachId() || c.coach_id,
        c.title,
        c.category || "新興運動",
        c.description || "",
        c.duration || 60,
        c.price_hkd || 100,
        c.credits_cost || Math.round((c.price_hkd || 100) / 10),
        c.max_participants || 10,
        st,
      );
      n++;
    }
    for (const s of scheds) {
      const newClassId = "demo-" + s.class_id;
      if (!db.prepare("SELECT id FROM classes WHERE id = ?").get(newClassId)) continue;
      db.prepare(
        `INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, enrolled_count, status)
         VALUES (?,?,?,?,?,0,'available')`,
      ).run(uuidv4(), newClassId, s.start_time, s.end_time, s.max_participants || 10);
    }
  })();
  console.log(`✅ 由 archive 還原 ${n} 個課程（${st}）。`);
}

const [cmd, arg] = process.argv.slice(2);
const active = process.argv.includes("--active");
switch (cmd) {
  case "status":
    status();
    break;
  case "restore":
    restore({ active });
    break;
  case "purge":
    purge();
    break;
  case "archive":
    restoreFromArchive(arg || path.join(__dirname, "..", "data", "archive", "demo-classes-2026-10-24.json"), { active });
    break;
  default:
    console.log("用法：node scripts/demo-data.js status|restore [--active]|purge|archive <file>");
}
