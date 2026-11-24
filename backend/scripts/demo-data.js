#!/usr/bin/env node
/**
 * ZenPass — 示範資料（Demo data）管理工具
 *
 * 用途：網站未正式上架時，用嚟開／關一批「示範課程」，令平台睇落有好多班，
 *       方便內部測試、截圖、畀客睇 demo。
 *
 * 原則（鐵律）：
 *   1. 示範課程一律 id 前綴 `demo-` ＋ `is_demo = 1`，可以一次過清除。
 *   2. 示範課程**唔可以真正收錢**：booking-service 會擋（DEMO_CLASS），
 *      前端改成「即將開班・WhatsApp 優先留位」。
 *   3. 絕對唔會碰任何金錢紀錄（bookings / wallet / earnings / ledger）。
 *   4. `purge` 只會刪示範課程同時段；如有真實預約／收入紀錄，改為設 inactive 並保留。
 *
 * 用法（喺 backend/ 執行）：
 *   node scripts/demo-data.js status
 *   node scripts/demo-data.js restore            # 建立並公開展示（預設）
 *   node scripts/demo-data.js restore --hidden   # 建立但隱藏（status=inactive）
 *   node scripts/demo-data.js purge              # 上線前一鍵清除所有示範課程
 *   node scripts/demo-data.js archive <file>     # 由舊 archive JSON 還原
 */
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "zenpass.db");
const Database = require("better-sqlite3");
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

// 示範課程用已核實教練（睇落真實啲；唔會影響佢哋真實收入，因為示範班收唔到錢）
const DEMO_COACH_EMAILS = ["coach.mindbody@zenpass.hk", "coach@zenpass.hk"];

// [標題, 分類, 價錢, 分鐘, 上限, 地區, 場地, 對象代碼, 難度, 運動 slug, 簡介]
const DEMO_CLASSES = [
  ["芬蘭木柱 Mölkky 新手體驗班", "新興運動", 150, 60, 12, "葵青", "青衣楓樹窩體育館", "general_fitness", "beginner", "molkky", "由零開始學擲柱、計分同戰術，一班人就玩到笑出聲。"],
  ["芬蘭木柱・週末親子同樂", "新興運動", 160, 90, 14, "沙田", "沙田源禾路體育館", "general_fitness", "beginner", "molkky", "家長同小朋友一隊，齊齊練準繩度同合作。"],
  ["地板冰壺 Floor Curling 入門", "新興運動", 140, 60, 12, "觀塘", "觀塘曉光街體育館", "general_fitness", "beginner", "floor-curling", "無冰都可以玩冰壺，策略＋手感，長幼咸宜。"],
  ["地板冰壺・樂齡策略班", "新興運動", 130, 60, 12, "黃大仙", "摩士公園體育館", "elderly", "beginner", "floor-curling", "坐低都玩得，練手眼協調同判斷力，關節零負擔。"],
  ["布袋球 Cornhole 同樂夜", "新興運動", 120, 60, 16, "油尖旺", "旺角花園街體育館", "general_fitness", "beginner", "cornhole", "輕鬆擲袋入洞，唔使跑唔使跳，最啱放工鬆一鬆。"],
  ["穿雲箭 AIR STORM 體驗", "新興運動", 150, 60, 12, "荃灣", "荃灣楊屋道體育館", "general_fitness", "beginner", "air-storm", "吹箭式新興運動，專注力＋呼吸控制，一試上癮。"],
  ["圓網球 Roundnet 挑戰賽", "新興運動", 160, 60, 10, "深水埗", "荔枝角公園體育館", "general_fitness", "intermediate", "roundnet", "四人兩隊彈網對攻，反應同默契嘅極限測試。"],
  ["柔力球 Rouliqiu 基礎班", "新興運動", 120, 60, 14, "東區", "北角渣華道體育館", "active_50plus", "beginner", "rouliqiu", "圓融流暢嘅球拍運動，練平衡、練腰腿，長者最愛。"],
  ["Flexi-Bar 深層筋膜訓練", "健體及新興", 140, 45, 12, "灣仔", "灣仔伊利沙伯體育館", "office_worker", "beginner", "flexi-bar", "震動桿激活深層核心，10 分鐘就感覺到分別。"],
  ["北歐式健走 Nordic Walking", "戶外活動", 90, 90, 16, "南區", "香港仔海濱長廊", "active_50plus", "beginner", "nordic-walking", "用杖行路，減少膝關節壓力，行得更遠更輕鬆。"],

  ["身心伸展運動班（晚間）", "身心伸展", 140, 75, 12, "葵青", "青衣楓樹窩體育館", "office_worker", "beginner", "stretch", "針對肩頸腰背嘅深層伸展，坐辦公室一族必上。"],
  ["陰瑜伽深度伸展", "身心伸展", 150, 75, 12, "九龍城", "何文田體育館", "general_fitness", "beginner", "yoga", "每個式子停留 3–5 分鐘，慢慢打開筋膜同關節。"],
  ["哈達瑜伽基礎", "身心伸展", 140, 60, 12, "西貢", "將軍澳體育館", "general_fitness", "beginner", "yoga", "呼吸配合體位，建立穩定基礎，新手完全冇問題。"],
  ["流瑜伽 Flow Yoga", "身心伸展", 150, 60, 10, "中西區", "上環體育館", "general_fitness", "intermediate", "yoga", "一氣呵成嘅流動序列，出汗同時練專注。"],
  ["空中瑜伽 Aerial Yoga", "身心伸展", 180, 60, 8, "油尖旺", "九龍公園體育館", "general_fitness", "beginner", "aerial-yoga", "用布吊起半空，減脊椎壓力，打卡一流。"],
  ["普拉提 Pilates 核心訓練", "身心伸展", 160, 60, 10, "深水埗", "石硤尾公園體育館", "office_worker", "beginner", "pilates", "由呼吸開始重建核心，改善寒背同腰痛。"],
  ["樂齡深層伸展（上午班）", "身心伸展", 130, 60, 14, "屯門", "屯門大興體育館", "elderly", "beginner", "stretch", "椅子輔助、全程慢節奏，關節友善零壓力。"],
  ["產後修復・盆骨核心班", "身心伸展", 160, 60, 8, "大埔", "大埔墟體育館", "postnatal", "beginner", "postnatal", "產後 6 星期起可以做，專業指導修復腹直肌。"],
  ["正念伸展＋呼吸冥想", "身心伸展", 130, 60, 12, "東區", "西灣河文娛中心", "office_worker", "beginner", "mindfulness", "邊拉筋邊練呼吸，一個鐘幫你熄機。"],
  ["普拉提器械體驗（小班）", "身心伸展", 220, 60, 6, "灣仔", "灣仔合和中心", "general_fitness", "intermediate", "pilates", "器械輔助更精準，6 人極小班，教練逐一調整。"],

  ["兒童體適能遊戲班（4–6 歲）", "兒童體適能", 130, 45, 10, "沙田", "沙田大會堂", "general_fitness", "beginner", "kids-fitness", "用遊戲練平衡、協調同紀律，放電一流。"],
  ["兒童體適能遊戲班（7–10 歲）", "兒童體適能", 140, 45, 12, "觀塘", "觀塘遊樂場體育館", "general_fitness", "beginner", "kids-fitness", "加入球類同反應遊戲，練團隊合作。"],
  ["幼兒感統訓練（2–4 歲）", "兒童體適能", 160, 45, 8, "荃灣", "荃灣大會堂", "general_fitness", "beginner", "kids-fitness", "家長陪同上堂，練前庭感統同手腳協調。"],
  ["兒童芬蘭木柱體驗", "兒童體適能", 130, 60, 12, "元朗", "元朗朗屏體育館", "general_fitness", "beginner", "molkky", "小朋友學計數＋策略，玩得開心又練專注。"],
  ["青少年體能訓練班", "兒童體適能", 160, 60, 12, "葵青", "葵涌運動場", "general_fitness", "intermediate", "kids-fitness", "12–16 歲專項體能，為校隊同運動打好底。"],

  ["HIIT 高強度間歇燃脂", "健體及新興", 150, 45, 14, "油尖旺", "旺角大角咀體育館", "general_fitness", "intermediate", "hiit", "20 分鐘爆汗，後燃效應持續燒脂。"],
  ["功能性力量訓練", "健體及新興", 150, 60, 10, "深水埗", "深水埗體育館", "general_fitness", "intermediate", "strength", "深蹲、硬拉、推拉，練返日常要用嘅力量。"],
  ["壺鈴 Kettlebell 入門", "健體及新興", 160, 60, 10, "東區", "柴灣體育館", "general_fitness", "beginner", "strength", "一個壺鈴練全身，教你安全發力。"],
  ["TRX 懸吊訓練體驗", "健體及新興", 160, 60, 8, "灣仔", "灣仔修頓室內場館", "general_fitness", "intermediate", "trx", "用自己體重做阻力，核心即刻有感覺。"],
  ["樂齡肌力防跌班", "健體及新興", 130, 60, 14, "黃大仙", "黃大仙竹園體育館", "elderly", "beginner", "strength", "練下肢肌力同平衡，實測減低跌倒風險。"],
  ["辦公室肩頸解鎖班", "健體及新興", 140, 45, 16, "南區", "鴨脷洲體育館", "office_worker", "beginner", "stretch", "針對長期對電腦嘅肩頸，45 分鐘即場鬆返。"],

  ["Zumba 舞動燃脂", "舞蹈文化", 140, 60, 16, "油尖旺", "旺角麥花臣場館", "general_fitness", "beginner", "zumba", "跟住拉丁節奏跳，唔覺唔覺燒咗幾百卡。"],
  ["K-Pop 舞蹈體驗班", "舞蹈文化", 150, 60, 14, "觀塘", "觀塘海濱活動空間", "general_fitness", "beginner", "dance", "人氣韓團舞步逐段拆解，影相拍片一流。"],
  ["爵士舞基礎 Jazz Funk", "舞蹈文化", 150, 60, 12, "中西區", "西營盤社區綜合大樓", "general_fitness", "beginner", "dance", "由基礎 isolation 開始，跳出自信。"],
  ["長者排舞同樂", "舞蹈文化", 110, 60, 20, "沙田", "沙田瀝源社區會堂", "elderly", "beginner", "dance", "簡單步法、老友記一齊跳，開心又健康。"],

  ["網球初學者班（成人）", "球類及其他", 200, 90, 8, "九龍城", "九龍仔公園網球場", "general_fitness", "beginner", "tennis", "握拍、正手、發球，由零開始打得成局。"],
  ["羽毛球雙打戰術班", "球類及其他", 170, 90, 12, "葵青", "青衣體育館", "general_fitness", "intermediate", "badminton", "走位、輪轉、殺波時機，業餘雙打即刻升級。"],
  ["乒乓球基礎訓練", "球類及其他", 150, 60, 12, "深水埗", "深水埗北河街體育館", "general_fitness", "beginner", "table-tennis", "由握拍同推擋學起，練反應同專注。"],

  ["北歐健走・城門水塘導賞", "戶外活動", 120, 120, 20, "荃灣", "城門水塘", "active_50plus", "beginner", "nordic-walking", "邊行邊學用杖技巧，風景靚又唔傷膝。"],
  ["海濱日落伸展團", "戶外活動", 100, 75, 20, "南區", "堅尼地城海濱", "general_fitness", "beginner", "stretch", "海邊做伸展，日落背景，最治癒嘅一小時。"],
];

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

function hkNowParts() {
  const hk = new Date(Date.now() + 8 * 3600 * 1000);
  return { y: hk.getUTCFullYear(), m: hk.getUTCMonth(), d: hk.getUTCDate(), wd: hk.getUTCDay() };
}

/** 由「今日（HK）」起計，搵下一個指定星期幾（0=日）之後 dayStart 日，回傳 HK 當地時間轉 ISO UTC */
function nextWeekdayIso(weekday, hh, mm, minDaysAhead = 1) {
  const { y, m, d, wd } = hkNowParts();
  let delta = (weekday - wd + 7) % 7;
  if (delta < minDaysAhead) delta += 7;
  return new Date(Date.UTC(y, m, d + delta, hh - 8, mm, 0)).toISOString();
}

function hkIso(dayOffset, hh, mm) {
  const { y, m, d } = hkNowParts();
  return new Date(Date.UTC(y, m, d + dayOffset, hh - 8, mm, 0)).toISOString();
}

function coachIds() {
  const rows = db
    .prepare(
      `SELECT id FROM users WHERE email IN (${DEMO_COACH_EMAILS.map(() => "?").join(",")})`,
    )
    .all(...DEMO_COACH_EMAILS);
  return rows.map((r) => r.id);
}

function ensureDemoColumn() {
  try {
    const cols = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
    if (!cols.includes("is_demo")) {
      db.exec("ALTER TABLE classes ADD COLUMN is_demo INTEGER DEFAULT 0");
    }
  } catch (e) {
    console.warn("⚠️ 無法加 is_demo 欄：", e.message);
  }
}

function status() {
  ensureDemoColumn();
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS live FROM classes WHERE is_demo=1 OR id LIKE 'demo-%'",
    )
    .get();
  const sched = db
    .prepare(
      `SELECT COUNT(*) AS n FROM class_schedules cs JOIN classes c ON c.id = cs.class_id
         WHERE c.is_demo=1 OR c.id LIKE 'demo-%'`,
    )
    .get();
  const future = db
    .prepare(
      `SELECT COUNT(*) AS n FROM class_schedules cs JOIN classes c ON c.id = cs.class_id
         WHERE (c.is_demo=1 OR c.id LIKE 'demo-%') AND datetime(cs.start_time) > datetime('now') AND cs.status='available'`,
    )
    .get();
  console.log(
    `示範課程：${row.n || 0} 個（公開中：${row.live || 0}）／時段：${sched.n || 0} 個（未來可預約：${future.n || 0}）`,
  );
  console.log(
    `真實課程：${db.prepare("SELECT COUNT(*) c FROM classes WHERE COALESCE(is_demo,0)=0 AND id NOT LIKE 'demo-%' AND status='active'").get().c} 個（active）`,
  );
}

function purge() {
  ensureDemoColumn();
  const rows = db
    .prepare("SELECT id FROM classes WHERE is_demo=1 OR id LIKE 'demo-%'")
    .all();
  const ids = rows.map((r) => r.id);
  if (!ids.length) return console.log("冇示範課程需要清除。");
  const q = ids.map(() => "?").join(",");
  const bk = db.prepare(`SELECT COUNT(*) c FROM bookings WHERE class_id IN (${q})`).get(...ids).c;
  let ce = 0;
  try {
    ce = db.prepare(`SELECT COUNT(*) c FROM coach_earnings WHERE class_id IN (${q})`).get(...ids).c;
  } catch (e) {}
  if (bk || ce) {
    console.error(`⚠️ 示範課程有 ${bk} 個預約／${ce} 筆收入紀錄，為保留審計鏈唔會刪除。`);
    console.error("   改為全部設為 inactive（隱藏）＋移除未來時段。");
    db.prepare(`UPDATE classes SET status='inactive', booking_open=0, updated_at=datetime('now') WHERE id IN (${q})`).run(...ids);
    return;
  }
  const schedIds = db
    .prepare(`SELECT id FROM class_schedules WHERE class_id IN (${q})`)
    .all(...ids)
    .map((r) => r.id);
  db.transaction(() => {
    if (schedIds.length) {
      const sq = schedIds.map(() => "?").join(",");
      try {
        db.prepare(`DELETE FROM waitlist WHERE schedule_id IN (${sq})`).run(...schedIds);
      } catch (e) {}
    }
    db.prepare(`DELETE FROM class_schedules WHERE class_id IN (${q})`).run(...ids);
    db.prepare(`DELETE FROM classes WHERE id IN (${q})`).run(...ids);
  })();
  console.log(`🗑️ 已清除 ${ids.length} 個示範課程及 ${schedIds.length} 個時段。`);
  status();
}

/** 每班嘅時段模板：兩個固定星期幾 × 時間，連續 4 星期 */
function sessionPlan(idx) {
  const plans = [
    { wd: [2, 4], time: [19, 0] },
    { wd: [2, 4], time: [20, 30] },
    { wd: [3, 5], time: [19, 30] },
    { wd: [1, 3], time: [10, 30] },
    { wd: [6, 6], time: [10, 0] },
    { wd: [6, 0], time: [11, 0] },
    { wd: [0, 0], time: [10, 30] },
    { wd: [5, 0], time: [14, 0] },
    { wd: [2, 6], time: [18, 30] },
    { wd: [4, 0], time: [9, 30] },
  ];
  return plans[idx % plans.length];
}

function restore(opts = {}) {
  ensureDemoColumn();
  const coachs = coachIds();
  if (!coachs.length) {
    return console.error("❌ 搵唔到示範教練（" + DEMO_COACH_EMAILS.join(" / ") + "）");
  }
  const existing = db
    .prepare("SELECT COUNT(*) c FROM classes WHERE is_demo=1 OR id LIKE 'demo-%'")
    .get().c;
  if (existing) {
    console.log(`已有 ${existing} 個示範課程；如要重建，先執行 purge。`);
    status();
    return;
  }
  const st = opts.hidden ? "inactive" : "active";
  const insC = db.prepare(
    `INSERT INTO classes (id, coach_id, title, category, description, duration, price_hkd, credits_cost,
                          max_participants, min_participants, venue_name, venue_address, district, target_audience,
                          target_audience_enum, target_audience_label, difficulty, sport_slug, equipment,
                          booking_open, is_demo, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
  );
  const insS = db.prepare(
    `INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, enrolled_count, status,
                                 booking_open, min_threshold, coach_id, title)
     VALUES (?,?,?,?,?,?,'available',1,4,?,?)`,
  );
  const AUD_LABEL = {
    elderly: "長者／樂齡",
    active_50plus: "50+ 活力一族",
    office_worker: "辦公室一族",
    postnatal: "產後媽媽",
    general_fitness: "大眾體適能",
  };
  let nClasses = 0;
  let nSched = 0;
  db.transaction(() => {
    DEMO_CLASSES.forEach(([title, cat, price, dur, cap, district, venue, audEnum, diff, slug, intro], i) => {
      const id = "demo-" + String(i + 1).padStart(3, "0");
      insC.run(
        id,
        coachs[i % coachs.length],
        title,
        cat,
        intro + "（示範班次：可優先留位，正式開班即刻通知你。）",
        dur,
        price,
        Math.max(1, Math.round(price / 10)),
        cap,
        4,
        venue,
        district,
        district,
        AUD_LABEL[audEnum] || "大眾體適能",
        audEnum,
        AUD_LABEL[audEnum] || "大眾體適能",
        diff,
        slug,
        "提供基本裝備，穿運動服及室內運動鞋即可。",
        st === "active" ? 1 : 0,
        1,
        st,
      );
      const plan = sessionPlan(i);
      // 兩個星期幾 × 4 星期；同一天只排一個時間（用第二個時間做偶爾加場）
      for (let w = 0; w < 4; w++) {
        plan.wd.forEach((wd, k) => {
          if (plan.wd[0] === plan.wd[1] && k === 1) return; // 同一星期幾唔重複
          const hh = plan.time[0];
          const mm = plan.time[1];
          // 每週第二場微調時間／日數，睇落更自然
          const jitter = w % 2 === 0 ? 0 : 1;
          const targetWd = (wd + jitter) % 7;
          const iso = nextWeekdayIso(targetWd, hh, mm, 1 + w * 7);
          const endIso = new Date(new Date(iso).getTime() + dur * 60000).toISOString();
          const enrolled = Math.min(cap - 2, Math.max(0, ((i * 3 + w * 5 + k * 2) % (cap - 1)) - 1));
          insS.run(uuidv4(), id, iso, endIso, cap, enrolled, coachs[i % coachs.length], title);
          nSched++;
        });
      }
      // 額外一班「下個月首週」示範場，拉長可預約窗口
      const iso2 = hkIso(26 + (i % 5), 19, 0);
      insS.run(
        uuidv4(),
        id,
        iso2,
        new Date(new Date(iso2).getTime() + dur * 60000).toISOString(),
        cap,
        Math.min(cap - 2, (i % (cap - 2)) + 1),
        coachs[i % coachs.length],
        title,
      );
      nSched++;
      nClasses++;
    });
  })();
  console.log(
    `✅ 已建立 ${nClasses} 個示範課程、${nSched} 個未來時段（${st === "active" ? "公開展示" : "隱藏"}）。`,
  );
  console.log("   示範班已封鎖真實付款；前端會顯示「即將開班・WhatsApp 優先留位」。");
  status();
}

function restoreFromArchive(file, opts = {}) {
  ensureDemoColumn();
  if (!fs.existsSync(file)) return console.error("❌ 找唔到檔案：" + file);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const cls = data.deleted_classes || data.classes || [];
  const scheds = data.deleted_schedules || data.schedules || [];
  const st = opts.hidden ? "inactive" : "active";
  let n = 0;
  db.transaction(() => {
    for (const c of cls) {
      const newId = "demo-" + c.id;
      const dup = db.prepare("SELECT id FROM classes WHERE id = ?").get(newId);
      if (dup) continue;
      db.prepare(
        `INSERT INTO classes (id, coach_id, title, category, description, duration, price_hkd, credits_cost,
                              max_participants, status, booking_open, is_demo, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'),datetime('now'))`,
      ).run(
        newId,
        coachIds()[0] || c.coach_id,
        c.title,
        c.category || "新興運動",
        c.description || "",
        c.duration || 60,
        c.price_hkd || 100,
        c.credits_cost || Math.max(1, Math.round((c.price_hkd || 100) / 10)),
        c.max_participants || 10,
        st,
        st === "active" ? 1 : 0,
      );
      n++;
    }
    for (const s of scheds) {
      const newClassId = "demo-" + s.class_id;
      if (!db.prepare("SELECT id FROM classes WHERE id = ?").get(newClassId)) continue;
      db.prepare(
        `INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, enrolled_count, status, booking_open)
         VALUES (?,?,?,?,?,0,'available',1)`,
      ).run(uuidv4(), newClassId, s.start_time, s.end_time, s.max_participants || 10);
    }
  })();
  console.log(`✅ 由 archive 還原 ${n} 個課程（${st}）。`);
}

const cmd = process.argv[2];
const hidden = process.argv.includes("--hidden");
switch (cmd) {
  case "status":
    status();
    break;
  case "restore":
    restore({ hidden });
    break;
  case "purge":
    purge();
    break;
  case "archive":
    restoreFromArchive(process.argv[3] || path.join(__dirname, "..", "data", "archive", "demo-classes-2026-10-24.json"), { hidden });
    break;
  default:
    console.log("用法：node scripts/demo-data.js status|restore [--hidden]|purge|archive <file>");
}
