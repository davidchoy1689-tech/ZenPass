#!/usr/bin/env node
/**
 * test-settings-extended.js — 系統參數中心「第二批」擴充（2026-11-18）
 *
 * 覆蓋：
 *  1) 新增分組／參數註冊表完整性（會籍、優惠退款、天氣）
 *  2) 會籍價格／Credits 寫入 pricing_config，getMembershipPlans 即時反映
 *  3) SILVER2 折扣／最低同行人數寫入 promo_codes，validatePromo 即時反映
 *  4) 退款 SLA 參數 + /api/platform/config 接線
 *  5) 天氣界線可調：evaluateWeather / buildPolicy / weather-watch 接線
 *  6) describe 標記預設／自訂、multiline 文案
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

const TMP = path.join(os.tmpdir(), "zenpass-settings-ext-" + Date.now() + ".db");
process.env.DB_PATH = TMP;
process.env.JWT_SECRET = "***" + "x".repeat(40);

let pass = 0,
  bad = 0;
const ok = (c, m, x) =>
  c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)));

const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");
initDatabase();
try {
  updateDatabase();
} catch (e) {}
try {
  require("../src/services/migrate-schema").runMigrations();
} catch (e) {
  console.error("migrate-schema:", e.message);
}

const Database = require("better-sqlite3");
const db = new Database(TMP);
db.pragma("foreign_keys = ON");

const registry = require("../src/config/settings-registry");
const settings = require("../src/services/settings-service");

console.log("\n[1] 註冊表：新分組／參數");
const groupIds = registry.GROUPS.map((g) => g.id);
["membership", "promo", "weather"].forEach((g) => ok(groupIds.includes(g), "有分組 " + g));
const membership = registry.ITEMS.filter((i) => i.group === "membership");
ok(membership.length === 8, "會籍計劃 4 級 × 2 項（價格＋Credits）", membership.length);
const planItems = membership.filter((i) => i.store === "pricing_config");
ok(planItems.length === 8, "會籍參數全部指向 pricing_config");
const silver = registry.ITEMS.filter((i) => i.store === "promo_codes");
ok(silver.length === 2 && silver.every((i) => i.code === "SILVER2"), "SILVER2 參數指向 promo_codes");
ok(registry.ITEMS.some((i) => i.key === "refund.sla_minutes"), "有退款 SLA 參數");
ok(registry.ITEMS.some((i) => i.key === "weather.lead_minutes"), "有停課界線參數");
ok(registry.ITEMS.some((i) => i.key === "weather.compensation_text" && i.multiline), "有補償文案（多行）");
const badStore = registry.ITEMS.filter((i) => i.store && !["pricing_config", "promo_codes"].includes(i.store));
ok(badStore.length === 0, "store 只用支援嘅資料源", badStore.map((x) => x.key));

console.log("\n[2] 會籍價格 → pricing_config → getMembershipPlans");
const { getMembershipPlans } = require("../src/routes/memberships");
ok(getMembershipPlans().lite.price_hkd === 299, "預設 lite = $299");
settings.setMany(db, { plan_lite_price: 399, plan_lite_credits: 40 }, { actorId: "admin1" });
ok(
  db.prepare("SELECT value FROM pricing_config WHERE key='plan_lite_price'").get().value === "399",
  "pricing_config 已寫入 399",
);
const plans = getMembershipPlans();
ok(plans.lite.price_hkd === 399 && plans.lite.credits_granted === 40, "getMembershipPlans 即時反映（399 / 40）", plans.lite);
settings.resetToDefaults(db, ["plan_lite_price", "plan_lite_credits"], { actorId: "admin1" });
ok(getMembershipPlans().lite.price_hkd === 299, "還原預設 → 回落 $299");
const dp = settings.describe(db).groups.flatMap((g) => g.items).find((i) => i.key === "plan_lite_price");
ok(dp.is_default === true, "describe 標記會籍價格為預設");

console.log("\n[3] SILVER2 折扣 → promo_codes → validatePromo");
const { randomUUID } = require("crypto");
db.prepare(
  `INSERT INTO promo_codes (id, code, type, value, min_participants, per_user_limit, active, description)
   VALUES (?, 'SILVER2', 'fixed_discount', 40, 2, 1, 1, '二人同行優惠')`,
).run(randomUUID());
const { validatePromo } = require("../src/services/promo");
const p1 = validatePromo(db, { code: "SILVER2", basePrice: 140, quantity: 2, subtotal: 280 });
ok(p1.ok && p1.discount === 40 && p1.final_price === 100, "預設：每人 $140 − $40（整單只折一次）", p1);
settings.setMany(db, { "promo.silver2_value": 60 }, { actorId: "admin1" });
ok(
  db.prepare("SELECT value FROM promo_codes WHERE code='SILVER2'").get().value === 60,
  "promo_codes.value 已更新 60",
);
const p2 = validatePromo(db, { code: "SILVER2", basePrice: 140, quantity: 2, subtotal: 280 });
ok(p2.ok && p2.discount === 60 && p2.final_price === 80, "改 $60 後即時生效", p2);
settings.setMany(db, { "promo.silver2_min_participants": 3 }, { actorId: "admin1" });
const p3 = validatePromo(db, { code: "SILVER2", basePrice: 140, quantity: 2, subtotal: 280 });
ok(!p3.ok && /3 人/.test(p3.error), "最少同行改 3 人 → 2 人被拒", p3);
const p4 = validatePromo(db, { code: "SILVER2", basePrice: 140, quantity: 3, subtotal: 420 });
ok(p4.ok, "3 人同行 → 可用", p4);
settings.resetToDefaults(db, ["promo.silver2_value", "promo.silver2_min_participants"], { actorId: "admin1" });
const row = db.prepare("SELECT value, min_participants FROM promo_codes WHERE code='SILVER2'").get();
ok(row.value === 40 && row.min_participants === 2, "還原預設（40 / 2）", row);

console.log("\n[4] 退款 SLA 參數 + 接線");
ok(settings.num(db, "refund.sla_minutes", -1) === 15, "預設 15 分鐘");
settings.setMany(db, { "refund.sla_minutes": 25 }, { actorId: "admin1" });
ok(settings.num(db, "refund.sla_minutes", -1) === 25, "可改 25 分鐘");
const src = (f) => fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8");
const platformJs = src("routes/platform.js");
ok(platformJs.includes("/config") && platformJs.includes("refund.sla_minutes"), "/api/platform/config 回傳退款 SLA");
const bookingHtml = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "booking.html"), "utf8");
ok(bookingHtml.includes("/api/platform/config") && bookingHtml.includes("sla-min"), "預約頁讀取 SLA 並更新文字");

console.log("\n[5] 天氣界線可調");
const { evaluateWeather, buildPolicy, formatLead } = require("../src/config/weather-policy");
ok(settings.num(db, "weather.lead_minutes", -1) === 120, "預設界線 120 分鐘");
ok(formatLead(120) === "2 小時" && formatLead(90) === "90 分鐘", "formatLead 格式", [formatLead(120), formatLead(90)]);
const w1 = evaluateWeather({ warningActive: false, liftedAt: "10:00", classStart: "11:30" });
ok(w1.cancel === true && w1.leadMinutes === 120, "除下距開課 90 分鐘（<120）→ 取消", w1);
settings.setMany(db, { "weather.lead_minutes": 60 }, { actorId: "admin1" });
const lead = settings.num(db, "weather.lead_minutes", 120);
const w2 = evaluateWeather({ warningActive: false, liftedAt: "10:00", classStart: "11:30", leadMinutes: lead });
ok(w2.cancel === false && w2.leadMinutes === 60, "界線改 60 分鐘 → 同一情況照常", w2);
ok(!/2 小時/.test(w2.reason) && /1 小時/.test(w2.reason), "判斷原因文字跟界線", w2.reason);
const pol = buildPolicy(90, "");
ok(pol.cutoffs.leadMinutes === 90 && pol.rules.every((r) => !/2 小時/.test(r.text)), "buildPolicy 文字換成 90 分鐘", pol.rules);
ok(pol.clauses.every((c) => !/2 小時/.test(c.p)), "條款內文同步換算");
const pol2 = buildPolicy(120, "自訂補償：全退或改期");
ok(pol2.compensation === "自訂補償：全退或改期", "補償文案可自訂");
ok(platformJs.includes("buildPolicy"), "公開天氣 API 用 buildPolicy");
const watchJs = src("services/weather-watch.js");
ok(watchJs.includes("weather.lead_minutes") && watchJs.includes("formatLead"), "天氣監察跟設定界線");

console.log("\n[6] describe 整合");
const d = settings.describe(db);
ok(d.groups.some((g) => g.id === "membership"), "describe 有會籍分組");
const comp = d.groups.flatMap((g) => g.items).find((i) => i.key === "weather.compensation_text");
ok(comp && comp.multiline === true, "補償文案標記 multiline（前端出 textarea）");
const promoItem = d.groups.flatMap((g) => g.items).find((i) => i.key === "promo.silver2_value");
ok(promoItem && promoItem.value === 40 && promoItem.is_default === true, "SILVER2 顯示預設值");
ok(d.item_count === registry.ITEMS.length, "describe 回傳全部 " + registry.ITEMS.length + " 項");

console.log("\n[7] 金錢表零改動");
ok(db.prepare("SELECT COUNT(*) c FROM wallet_transactions").get().c === 0, "wallet_transactions 維持 0");
ok(db.prepare("SELECT COUNT(*) c FROM coach_earnings").get().c === 0, "coach_earnings 維持 0");

db.close();
console.log(`\n${bad ? "❌" : "✅"} 系統參數（第二批）：${pass} 通過，${bad} 失敗`);
process.exit(bad ? 1 : 0);
