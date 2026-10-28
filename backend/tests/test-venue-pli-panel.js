/**
 * ZenPass — 場地 PLI 快速錄入面板（API）tests
 * node backend/tests/test-venue-pli-panel.js
 */
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test-only-secret-value-for-zenpass-tests-32";
process.env.VENUE_PLI_GATE = "warn";
const tmp = path.join(os.tmpdir(), "zenpass-plipanel-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log("  ✅ " + m); pass++; } else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT, address TEXT, status TEXT DEFAULT 'active');
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,phone,role) VALUES ('admin','Admin','admin@x.hk','91234567','super_admin')").run();
  pre.close();

  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  const future = new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10);
  const past = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);

  const router = require("../src/routes/admin-crm");
  const pick = (p, m) => {
    const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[m]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const call = (fn, req) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    return Promise.resolve(fn({ query: {}, params: {}, body: {}, headers: {}, user: { id: "admin", role: "super_admin" }, ...req }, res)).then(() => res);
  };

  console.log("\n🧪 場地 PLI 快速錄入面板\n");

  db.prepare("INSERT INTO partner_venues (id,name,district,address,status) VALUES ('v-lck','荔枝角室內場','深水埗','長沙灣道 1 號','active')").run();
  db.prepare("INSERT INTO partner_venues (id,name,district,address,status) VALUES ('v-kln','觀塘工廈場','觀塘','鴻圖道 2 號','active')").run();
  db.prepare("INSERT INTO partner_venues (id,name,district,address,status) VALUES ('v-lcsd','康文署體育館','灣仔','','active')").run();
  db.prepare("INSERT INTO partner_venues (id,name,district,address,status) VALUES ('v-old','舊場（已停用）','油尖旺','','inactive')").run();

  console.log("📋 1. GET /admin/venues");
  const listFn = pick("/venues", "get");
  let r = await call(listFn);
  ok(r.statusCode === 200 && r.body.success === true, "回傳 200 success");
  ok((r.body.venues || []).length === 4, "回傳全部 4 個場地");
  ok(r.body.gate === "warn", "預設閘門模式 warn（env fallback）");
  ok(r.body.summary.active_commercial === 3, "使用中商業場地 3 個（含未標記 exempt）");
  ok(r.body.summary.blocking === 3, "3 個場地待處理");
  ok(r.body.summary.ready_for_enforce === false, "未齊料 → 不可 enforce");
  const lck = r.body.venues.find((v) => v.id === "v-lck");
  ok(lck && lck.pli_status === "unverified" && lck.ok === false, "場地預設 unverified 且 ok=false");

  console.log("\n📋 2. PUT /admin/venues/:id/pli");
  const pliFn = pick("/venues/:id/pli", "put");
  r = await call(pliFn, { params: { id: "v-lck" }, body: { business_reg_no: "BR-123456", pli_policy_no: "PLI-8899", pli_expiry: future, pli_status: "verified" } });
  ok(r.statusCode === 200 && r.body.pli_status === "verified", "核驗成功（verified）");
  r = await call(pliFn, { params: { id: "v-lck" }, body: { pli_status: "verified", pli_expiry: past } });
  ok(r.statusCode === 400 && r.body.code === "PLI_EXPIRY_REQUIRED", "過期保單不可標記 verified");

  r = await call(listFn);
  let v = r.body.venues.find((x) => x.id === "v-lck");
  ok(v.pli_status === "verified" && v.ok === true, "列表反映已核驗");
  ok(v.business_reg_no === "BR-123456" && v.pli_policy_no === "PLI-8899", "BR／保單號已寫入");
  ok(v.pli_expiry === future, "到期日已寫入");
  ok(r.body.summary.blocking === 2, "待處理減至 2");

  console.log("\n📋 3. 豁免場地（政府場地）");
  r = await call(pliFn, { params: { id: "v-lcsd" }, body: { pli_status: "exempt" } });
  ok(r.statusCode === 200, "可標記 exempt（無需到期日）");
  r = await call(listFn);
  ok(r.body.summary.active_commercial === 2, "exempt 不計入商業場地");

  console.log("\n📋 4. POST /admin/settings/venue-pli-gate");
  const gateFn = pick("/settings/venue-pli-gate", "post");
  r = await call(gateFn, { body: { mode: "bogus" } });
  ok(r.statusCode === 400, "無效模式 400");

  r = await call(gateFn, { body: { mode: "enforce" } });
  ok(r.statusCode === 400 && r.body.code === "VENUE_PLI_INCOMPLETE", "仍有未核驗場地 → 拒絕 enforce");
  ok((r.body.blocking || []).some((x) => x.id === "v-kln"), "回傳待處理場地名單");

  r = await call(gateFn, { body: { mode: "warn" } });
  ok(r.statusCode === 200 && r.body.gate === "warn", "可自由切回 warn");

  // 補齊最後一個場地後才可 enforce
  r = await call(pliFn, { params: { id: "v-kln" }, body: { business_reg_no: "BR-778899", pli_policy_no: "PLI-2233", pli_expiry: future, pli_status: "verified" } });
  ok(r.statusCode === 200, "第二個場地核驗成功");

  r = await call(listFn);
  ok(r.body.summary.ready_for_enforce === true, "全部核驗 → ready_for_enforce");
  ok(r.body.summary.blocking === 0, "待處理 0");

  r = await call(gateFn, { body: { mode: "enforce" } });
  ok(r.statusCode === 200 && r.body.gate === "enforce", "可切換 enforce");
  const setting = db.prepare("SELECT value FROM platform_settings WHERE key='venue.pli_gate'").get();
  ok(setting && setting.value === "enforce", "platform_settings 已寫入 enforce");
  r = await call(listFn);
  ok(r.body.gate === "enforce", "GET 反映 enforce（DB 優先於 env）");

  console.log("\n📋 5. 審計紀錄");
  const audits = db.prepare("SELECT action_type, description FROM audit_log WHERE action_type IN ('venue.pli_updated','settings.venue_pli_gate')").all();
  ok(audits.filter((a) => a.action_type === "venue.pli_updated").length >= 3, "每次 PLI 更新都有審計");
  ok(audits.some((a) => a.action_type === "settings.venue_pli_gate"), "閘門切換有審計");

  console.log("\n📋 6. 前端面板存在性");
  const html = require("fs").readFileSync(path.join(__dirname, "../../frontend-v2/admin-ops.html"), "utf8");
  ok(/data-t="venue"/.test(html) && /paneVenue/.test(html), "有「🏟️ 場地 PLI」分頁");
  ok(/id="pliEnforce"/.test(html) && /id="pliWarn"/.test(html), "有閘門切換按鈕");
  ok(/\/admin\/venues/.test(html) && /venue-pli-gate/.test(html), "前端已接線新 API");
  ok(/pli_status/.test(html) && /exempt/.test(html), "有狀態選擇（含 exempt）");
  ok(/business_reg_no/.test(html) && /pli_policy_no/.test(html) && /pli_expiry/.test(html), "有 BR／保單號／到期日輸入");

  console.log(`\n${fail === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} 通過 / ${fail} 失敗\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
