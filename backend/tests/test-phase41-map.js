#!/usr/bin/env node
/** Phase 4.1 — LBS 地圖 pins、距離排序、Flash 價格、隔離 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-phase41-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x))); };
const { getDb } = require("../src/services/database");
const map = require("../src/routes/explore-map");
const merchant = require("../src/routes/merchant");
const db = getDb();
merchant.ensureSchema(db);
map.ensureSchema(db);
require("../src/routes/public-explore").ensureExploreSchema(db);

function addUser(id, name, phone, coach = 0) {
  db.prepare("INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified) VALUES (?,?,?,?,?,?,?)")
    .run(id, id + "@t.hk", name, phone, coach ? "coach" : "user", coach, coach ? 1 : 0);
}
addUser("ownerW", "灣仔館", "60008001");
addUser("ownerC", "銅鑼灣館", "60008002");
addUser("ownerM", "旺角館", "60008003");
addUser("coach", "教練", "60008004", 1);
const studios = {
  wan: ["std-wan", 22.28235, 114.1722, "灣仔站 A3 出口步行 3 分鐘"],
  cwb: ["std-cwb", 22.2800, 114.1867, "銅鑼灣站"],
  mk: ["std-mk", 22.3161, 114.1722, "旺角站"],
};
for (const [k, [id, lat, lng, mtr]] of Object.entries(studios)) {
  const owner = k === "wan" ? "ownerW" : k === "cwb" ? "ownerC" : "ownerM";
  db.prepare(`INSERT INTO merchant_studios (id,owner_user_id,studio_name,district,address,contact_phone,latitude,longitude,mtr_station,status)
              VALUES (?,?,?,?,?,?,?,?,?, 'active')`).run(id, owner, k.toUpperCase() + " Studio", k === "wan" ? "灣仔" : k === "cwb" ? "銅鑼灣" : "旺角", "地址", "60008001", lat, lng, mtr);
}
const now = Date.now();
function addClass(id, studio, title, hours, remaining, price = 18000, flash = 12800) {
  const start = new Date(now + hours * 3600000).toISOString().slice(0, 19).replace("T", " ");
  const end = new Date(now + (hours + 1) * 3600000).toISOString().slice(0, 19).replace("T", " ");
  db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,price_hkd_cents,status,booking_open,venue_name,district,target_audience_enum,target_audience_label) VALUES (?,?,?, 'fitness',60,10,?,?, 'active',1,?,?, 'office_worker','上班族痛症')`).run(id, "coach", title, price / 100, price, title, studio === "std-wan" ? "灣仔" : "銅鑼灣");
  db.prepare(`INSERT INTO class_schedules (id,class_id,coach_id,start_time,end_time,max_participants,enrolled_count,status,booking_open,district,studio_id,is_dropin_enabled,is_flash_sale_enabled,flash_price_cents)
              VALUES (?,?,?,?,?,10,?, 'available',1,?,?,1,1,?)`).run("sch-" + id, id, "coach", start, end, 10 - remaining, studio === "std-wan" ? "灣仔" : "銅鑼灣", studio, flash);
}
addClass("c-wan", "std-wan", "灣仔 Reformer", 2, 2);
addClass("c-cwb", "std-cwb", "銅鑼灣瑜伽", 5, 3);
addClass("c-mk", "std-mk", "旺角泰拳", 6, 4);

console.log("🧪 1. AC-1 距離排序");
const r = map.getMapPins(db, { lat: 22.2783, lng: 114.1722, radius_km: 5 });
ok(r.studios_with_classes.length === 3, "回傳 3 個場地", r.count);
const names = r.studios_with_classes.map((s) => s.studio_name);
ok(names[0].includes("WAN") && names[1].includes("CWB") && names[2].includes("MK"), "灣仔 → 銅鑼灣 → 旺角", names);
ok(r.studios_with_classes[0].distance_meters >= 400 && r.studios_with_classes[0].distance_meters <= 500, "灣仔約 450m", r.studios_with_classes[0].distance_meters);
ok(r.studios_with_classes[1].distance_meters > r.studios_with_classes[0].distance_meters, "距離遞增");

console.log("🧪 2. AC-2 Flash 觸發");
const wan = r.studios_with_classes[0].classes[0];
ok(wan.is_flash_sale === true, "2 小時內開課 → flash");
ok(wan.effective_price_cents === 12800 && wan.original_price_cents === 18000, "特惠 $128／原價 $180", wan);
ok(wan.time_to_start_minutes <= 121 && wan.time_to_start_minutes >= 118, "剩約 2 小時", wan.time_to_start_minutes);
ok(!r.studios_with_classes[1].classes[0].is_flash_sale, "5 小時後班次不觸發 flash");

console.log("🧪 3. AC-3 最後名額售出後 Pin 消失");
db.prepare("UPDATE class_schedules SET enrolled_count=max_participants WHERE id='sch-c-wan'").run();
const r2 = map.getMapPins(db, { lat: 22.2783, lng: 114.1722, radius_km: 5 });
ok(!r2.studios_with_classes.some((s) => s.studio_id === "std-wan"), "滿額後灣仔 Pin 消失");
ok(r2.studios_with_classes.length === 2, "其餘場地仍在");

console.log("🧪 4. AC-4 整數 cents／AC-5 隔離");
ok(Number.isInteger(wan.effective_price_cents) && Number.isInteger(wan.original_price_cents), "價格為整數 cents");
db.prepare("INSERT OR IGNORE INTO partner_venues (id,name,status) VALUES ('seed-sandbox-venue','Sandbox','active')").run();
db.prepare(`INSERT INTO classes (id,coach_id,title,category,duration,max_participants,price_hkd,status,booking_open,class_reference,partner_venue_id,target_audience_enum) VALUES ('c-test','coach','PROD TEST','fitness',60,8,140,'active',1,'VERIFIED_TEST_20261111','seed-sandbox-venue','office_worker')`).run();
const st = new Date(now + 2 * 3600000).toISOString().slice(0, 19).replace("T", " ");
const en = new Date(now + 3 * 3600000).toISOString().slice(0, 19).replace("T", " ");
db.prepare(`INSERT INTO class_schedules (id,class_id,coach_id,start_time,end_time,max_participants,enrolled_count,status,booking_open,studio_id,is_flash_sale_enabled,flash_price_cents) VALUES ('prodtest-sch-41','c-test','coach',?,?,8,0,'available',1,'std-wan',1,12800)`).run(st, en);
const r3 = map.getMapPins(db, { lat: 22.2783, lng: 114.1722, radius_km: 5 });
ok(!r3.studios_with_classes.some((s) => s.classes.some((c) => c.schedule_id.includes("prodtest"))), "排除 prodtest／sandbox");
const t0 = process.hrtime.bigint();
for (let i = 0; i < 20; i++) map.getMapPins(db, { lat: 22.2783, lng: 114.1722, radius_km: 5 });
const avg = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
ok(avg < 150, `平均 ${avg.toFixed(2)}ms < 150ms`, avg);

console.log("🧪 5. 前端");
const fs = require("fs");
const page = fs.readFileSync(path.join(__dirname, "../../frontend-v2/explore-map.html"), "utf8");
ok(/leaflet/.test(page) && /map-pins/.test(page) && /book-with-pass/.test(page), "explore-map 有 Leaflet＋API＋一鍵預約");
ok(/navigator\.geolocation/.test(page), "支援手機定位");
ok(/is_flash_sale/.test(page), "前端顯示 Flash 價");

console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
