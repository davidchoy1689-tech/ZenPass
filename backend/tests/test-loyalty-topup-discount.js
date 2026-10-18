/**
 * ZenPass — 會員等級增值折扣 tests
 * 驗證「銀 5% / 金、VIP 10% off 增值」真正套用（唔止文案）
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_secret_1234567890_abcdefghijklmnop";
const tmp = path.join(os.tmpdir(), "zenpass-loytopup-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,loyalty_tier) VALUES (?,?,?)").run("bronze_u", "銅", "bronze");
  pre.prepare("INSERT INTO users (id,name,loyalty_tier) VALUES (?,?,?)").run("silver_u", "銀", "silver");
  pre.prepare("INSERT INTO users (id,name,loyalty_tier) VALUES (?,?,?)").run("gold_u", "金", "gold");
  pre.prepare("INSERT INTO users (id,name,loyalty_tier) VALUES (?,?,?)").run("vip_u", "VIP", "vip");
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { getTopUpDiscount, applyTopUpDiscount } = require("../src/services/loyalty");

  console.log("🧪 會員等級增值折扣 tests");

  console.log("── 折扣百分比 ──");
  ok(getTopUpDiscount("bronze_u") === 0, "銅牌 0%");
  ok(getTopUpDiscount("silver_u") === 5, "銀牌 5%");
  ok(getTopUpDiscount("gold_u") === 10, "金牌 10%");
  ok(getTopUpDiscount("vip_u") === 10, "VIP 10%");
  ok(getTopUpDiscount("nobody") === 0, "用戶不存在 → 0%");

  console.log("── 實付金額 ──");
  const s = applyTopUpDiscount(250, "silver_u");
  ok(s.original_amount_hkd === 250 && s.payable_hkd === 237.5 && s.discount_percent === 5, "銀牌 $250 → $237.5");
  const g = applyTopUpDiscount(550, "gold_u");
  ok(g.payable_hkd === 495, "金牌 $550 → $495");
  const v = applyTopUpDiscount(1000, "vip_u");
  ok(v.payable_hkd === 900, "VIP $1000 → $900");
  const b = applyTopUpDiscount(250, "bronze_u");
  ok(b.payable_hkd === 250, "銅牌 $250 → 原價");
  const r = applyTopUpDiscount(333, "silver_u");
  ok(r.payable_hkd === 316.35, "四捨五入至仙：$333 × 95% = $316.35");
  ok(applyTopUpDiscount(250, null).payable_hkd === 250, "未登入 → 原價");

  console.log("── DB 欄位 ──");
  const cols = db.prepare("PRAGMA table_info('credit_topup_orders')").all().map(c => c.name);
  ok(cols.includes("original_amount_hkd"), "credit_topup_orders.original_amount_hkd");
  ok(cols.includes("discount_percent"), "credit_topup_orders.discount_percent");

  console.log("── 後端接線 ──");
  const root = path.join(__dirname, "..");
  const creditsSrc = fs.readFileSync(path.join(root, "src/routes/credits.js"), "utf8");
  const topupSrc = fs.readFileSync(path.join(root, "src/routes/topup.js"), "utf8");
  const initSrc = fs.readFileSync(path.join(root, "src/config/init-db.js"), "utf8");
  ok(/optionalAuth/.test(creditsSrc) && /applyTopUpDiscount/.test(creditsSrc), "增值方案按登入會員計折扣");
  ok(/payable_hkd:\s*q\.payable_hkd/.test(creditsSrc), "方案回傳會員實付價");
  ok(/original_amount_hkd,\s*discount_percent/.test(creditsSrc.replace(/\n/g, " ")), "落單記錄原價 + 折扣");
  ok(/const credits = Number\(order\.credits\)/.test(creditsSrc), "確認收款時 credits 唔會被折扣拖低");
  ok(/actual \+ 0\.01 < payable/.test(creditsSrc), "實收少於會員價 → 唔准確認（防收唔足錢）");
  ok(/applyTopUpDiscount\(bundle\.price, userId\)/.test(topupSrc), "Auto top-up 套用會員折扣");
  ok(/ALTER TABLE credit_topup_orders ADD COLUMN original_amount_hkd/.test(initSrc), "init-db 自動加欄（舊 DB 都升級）");

  console.log("── 前端顯示 ──");
  const web = path.join(root, "..", "frontend-v2");
  const buy = fs.readFileSync(path.join(web, "buy-credits.html"), "utf8");
  const auto = fs.readFileSync(path.join(web, "topup-auto.html"), "utf8");
  const admin = fs.readFileSync(path.join(web, "admin.html"), "utf8");
  ok(/payable_hkd/.test(buy), "增值頁顯示會員價");
  ok(/會員 -\$\{disc\}%/.test(buy), "增值頁標示折扣百分比");
  ok(/data-pay=/.test(buy), "選擇方案記住實付價");
  ok(/請轉賬「會員價」/.test(buy), "付款指示寫明轉賬會員價");
  ok(/discount_percent/.test(auto) && /payable_hkd/.test(auto), "Auto top-up 頁顯示會員價");
  ok(/原價 \$\{money\(o\.original_amount_hkd\)\}/.test(admin), "Admin 待確認顯示原價 → 實收");

  console.log("── 計算一致性（3 個入口）──");
  ok(/applyTopUpDiscount\(amount, userId\)/.test(creditsSrc), "手動增值用同一個報價函數");
  ok(/applyTopUpDiscount\(bundle\.price, userId\)/.test(topupSrc), "Auto top-up 用同一個報價函數");
  ok(/applyTopUpDiscount\(b\.price, req\.user\.id\)/.test(topupSrc), "設定頁 bundle 報價一致");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
