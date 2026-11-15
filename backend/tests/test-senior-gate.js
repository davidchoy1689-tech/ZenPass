/**
 * 長者模式浮標：只限 60+ 學員，角色一律隱藏
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FE = path.join(__dirname, "..", "..", "frontend-v2");
const src = fs.readFileSync(path.join(FE, "assets", "senior-mode.js"), "utf8");

let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };

function load(user, opts = {}) {
  const ctx = {
    window: {},
    console,
    localStorage: {
      _d: { zenpass_user: user ? JSON.stringify(user) : null },
      getItem(k) { return this._d[k] || null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    },
    location: { search: opts.search || "", pathname: "/my.html" },
    document: {
      readyState: "complete",
      documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
      addEventListener() {},
      getElementById: () => null,
      createElement: () => ({ addEventListener() {}, setAttribute() {}, style: {} }),
      body: { appendChild() {} },
    },
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    URLSearchParams, Object, Promise, JSON, String, Number, Date,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

(async () => {
  console.log("\n🧪 1. 角色一律隱藏");
  for (const role of ["coach", "admin", "super_admin", "platform_manager", "partner_owner", "org_admin"]) {
    const r = await load({ id: "x", role, birth_year: 1950 }).window.ZenPassSenior._decide();
    ok(r === false, role + " → 唔顯示", String(r));
  }

  console.log("\n🧪 2. 年齡門檻（學員）");
  const y = new Date().getFullYear();
  const r65 = await load({ id: "u", role: "user", birth_year: y - 65 }).window.ZenPassSenior._decide();
  ok(r65 === true, "65 歲 → 顯示", String(r65));
  const r60 = await load({ id: "u", role: "user", birth_year: y - 60 }).window.ZenPassSenior._decide();
  ok(r60 === true, "剛好 60 歲 → 顯示", String(r60));
  const r45 = await load({ id: "u", role: "user", birth_year: y - 45 }).window.ZenPassSenior._decide();
  ok(r45 === false, "45 歲（家長／成人）→ 唔顯示", String(r45));
  const rNo = await load({ id: "u", role: "user" }).window.ZenPassSenior._decide();
  ok(rNo === false, "冇出生年份 → 唔顯示", String(rNo));

  console.log("\n🧪 3. 遊客 / 指定參數");
  const guest = await load(null).window.ZenPassSenior._decide();
  ok(guest === false, "遊客 → 唔顯示", String(guest));
  const forced = await load({ id: "u", role: "user", birth_year: y - 30 }, { search: "?senior=1" }).window.ZenPassSenior._decide();
  ok(forced === true, "?senior=1 → 強制顯示（派卡片）", String(forced));

  console.log("\n🧪 4. 前端接線");
  const css = fs.readFileSync(path.join(FE, "assets", "v2.css"), "utf8");
  ok(css.includes(".zp-senior-btn.eligible"), "有加大版樣式");
  const html = fs.readFileSync(path.join(FE, "my.html"), "utf8");
  ok(/senior-mode\.js\?v=3/.test(html), "頁面用 v=3 版本");

  console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
