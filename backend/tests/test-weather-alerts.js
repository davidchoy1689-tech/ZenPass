/**
 * ZenPass — 極端天氣警報（系統報警、管理員決定）tests
 * node backend/tests/test-weather-alerts.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test-s…cdef";
const tmp = path.join(os.tmpdir(), "zenpass-wxalert-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log("  ✅ " + m); pass++; } else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT, status TEXT DEFAULT 'active');
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  for (const [id, role] of [["admin","admin"],["coach","coach"],["u1","user"]]) {
    pre.prepare("INSERT INTO users (id,name,email,phone,role) VALUES (?,?,?,?,?)").run(id, id, id + "@x.hk", "91234567", role);
  }
  pre.close();

  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  const start = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 19).replace("T", " ");
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status) VALUES ('c1','coach','木柱班','新興運動',120,150,'active')").run();
  db.prepare("INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status) VALUES ('s1','c1',?,?,10,2,'available')").run(start, start);
  db.prepare("INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,status,payment_status,amount) VALUES ('b1','ZP-WX1','u1','s1','c1','confirmed','paid',150)").run();

  const watch = require("../src/services/weather-watch");
  const { WEATHER_POLICY } = require("../src/config/weather-policy");

  console.log("\n🧪 極端天氣警報\n");

  console.log("📋 1. 條款內容");
  ok(Array.isArray(WEATHER_POLICY.clauses) && WEATHER_POLICY.clauses.length === 9, "公開條款 9 段");
  ok(WEATHER_POLICY.clauses.some((c) => /觸發條件/.test(c.h)), "含觸發條件章節");
  ok(WEATHER_POLICY.clauses.some((c) => /人手決定/.test(c.p)), "條款寫明由管理員人手決定");

  console.log("📋 2. 狀態轉變 → 警報");
  const noData = watch.applyState({ ok: false }, null);
  ok(!noData.created && noData.reason === "no_data", "讀唔到天文台資料 → 唔會亂發警報");

  const idle = { ok: true, activity_suspended: false, warnings: [], codes: [] };
  ok(!watch.applyState(idle, { activity_suspended: false }).created, "一直無警告 → 冇警報");

  const active = {
    ok: true, activity_suspended: true,
    warnings: [{ code: "TC8NE", name: "八號東北烈風或暴風信號" }], codes: ["TC8NE"],
  };
  const a1 = watch.applyState(active, { activity_suspended: false });
  ok(!!a1.created && a1.created.type === "weather_signal", "警告首次生效 → 建立 urgent 警報");
  ok(/需要立即跟進/.test(a1.created.title || ""), "標題含「需要立即跟進」");
  ok(/八號東北烈風/.test(a1.created.message || ""), "訊息含警告名稱");
  ok(/受影響/.test(a1.created.message || ""), "訊息含影響評估");
  const open1 = watch.listAlerts("open");
  ok(open1.length === 1 && open1[0].severity === "urgent", "警報為 open / urgent");

  const a2 = watch.applyState(active, { activity_suspended: true });
  ok(!a2.created, "同一狀態重複檢查 → 唔會重複發警報");
  ok(watch.listAlerts("open").length === 1, "open 警報仍只有 1 條");

  const a3 = watch.applyState(idle, { activity_suspended: true });
  ok(!!a3.created && a3.created.type === "weather_lifted", "警告除下 → 建立「請確認課堂安排」警報");
  ok(/10:00/.test(a3.created.message || "") && /15:00/.test(a3.created.message || ""), "訊息帶康文署分界時間");

  console.log("📋 3. 管理員處理");
  const id = a1.created.id;
  const h1 = watch.handleAlert(id, { decision: "cancel", note: "已通知教練", userId: "admin" });
  ok(h1.ok && h1.decision === "cancel", "記錄決定：取消");
  const row = db.prepare("SELECT * FROM ops_alerts WHERE id=?").get(id);
  ok(row.status === "handled" && row.handled_by === "admin", "警報已標記 handled");
  ok(!!row.handled_at, "已記錄處理時間");
  const audit = db.prepare("SELECT * FROM audit_log WHERE action_type='ops.weather_alert_handled'").get();
  ok(!!audit, "已寫入 audit_log");
  const h2 = watch.handleAlert(id, { decision: "ack", userId: "admin" });
  ok(h2.ok === false && h2.status === 409, "重複處理 → 409");

  console.log("📋 4. 接線與頁面");
  const idx = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  ok(/weather-watch"\)\.start\(10 \* 60 \* 1000\)/.test(idx), "每 10 分鐘自動監察天文台");
  const ops = fs.readFileSync(path.join(__dirname, "../src/routes/admin-ops.js"), "utf8");
  ok(/\/alerts"[\s\S]{0,120}requireAdmin/.test(ops), "GET /alerts 有管理員權限");
  ok(/alerts\/:id\/handle/.test(ops) && /weather-scan/.test(ops), "有處理與手動重讀端點");
  const ui = fs.readFileSync(path.join(__dirname, "../../frontend-v2/admin-ops.html"), "utf8");
  ok(/loadAlerts/.test(ui) && /去處理取消/.test(ui), "後台有警報面板與處理按鈕");
  const page = fs.readFileSync(path.join(__dirname, "../../frontend-v2/weather-policy.html"), "utf8");
  ok(/weather-policy/.test(page) && /極端天氣條款/.test(page), "公開條款頁存在並讀 API");
  const detail = fs.readFileSync(path.join(__dirname, "../../frontend-v2/detail.html"), "utf8");
  ok(/weather-policy\.html/.test(detail), "課程頁連去天氣條款");
  const bk = fs.readFileSync(path.join(__dirname, "../../frontend-v2/booking.html"), "utf8");
  ok(/weather-policy\.html/.test(bk), "報名頁免責聲明連去天氣條款");
  const footer = fs.readFileSync(path.join(__dirname, "../../frontend-v2/assets/footer.js"), "utf8");
  ok(/weather-policy\.html/.test(footer), "頁尾有極端天氣條款連結");

  console.log("\n📊 結果: " + pass + " ✅ 通過, " + fail + " ❌ 失敗\n");
  try { fs.unlinkSync(tmp); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
