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
    ok(r.allow === false, role + " → 唔顯示", JSON.stringify(r));
  }

  console.log("\n🧪 2. 年齡門檻（學員）");
  const y = new Date().getFullYear();
  const r65 = await load({ id: "u", role: "user", birth_year: y - 65 }).window.ZenPassSenior._decide();
  ok(r65.allow === true && r65.eligible === true, "65 歲 → 顯示（顯眼）", JSON.stringify(r65));
  const r60 = await load({ id: "u", role: "user", birth_year: y - 60 }).window.ZenPassSenior._decide();
  ok(r60.allow === true, "剛好 60 歲 → 顯示", JSON.stringify(r60));
  const r45 = await load({ id: "u", role: "user", birth_year: y - 45 }).window.ZenPassSenior._decide();
  ok(r45.allow === false, "45 歲（未自行開啟）→ 唔顯示", JSON.stringify(r45));
  const rNo = await load({ id: "u", role: "user" }).window.ZenPassSenior._decide();
  ok(rNo.allow === false, "冇出生年份＋未自行開啟 → 唔顯示", JSON.stringify(rNo));

  console.log("\n🧪 3. 遊客 / 指定參數");
  const guest = await load(null).window.ZenPassSenior._decide();
  ok(guest.allow === false, "遊客 → 唔顯示", JSON.stringify(guest));
  const forced = await load({ id: "u", role: "user", birth_year: y - 30 }, { search: "?senior=1" }).window.ZenPassSenior._decide();
  ok(forced.allow === true, "?senior=1 → 強制顯示（派卡片）", JSON.stringify(forced));

  console.log("\n🧪 4. 自行開啟（任何年齡，普通浮標）");
  const ctxM = load({ id: "u", role: "user", birth_year: y - 45 });
  ctxM.localStorage.setItem("zp_senior_manual", "1");
  const rM = await ctxM.window.ZenPassSenior._decide();
  ok(rM.allow === true && rM.eligible === false, "45 歲自行開啟 → 可顯示（非顯眼）", JSON.stringify(rM));
  const ctxC = load({ id: "c", role: "coach", birth_year: y - 30 });
  ctxC.localStorage.setItem("zp_senior_manual", "1");
  const rC = await ctxC.window.ZenPassSenior._decide();
  ok(rC.allow === false, "教練即使手動開都唔顯示", JSON.stringify(rC));

  console.log("\n🧪 5. 前端接線");
  const css = fs.readFileSync(path.join(FE, "assets", "v2.css"), "utf8");
  ok(css.includes(".zp-senior-btn.eligible"), "有加大版樣式");
  const html = fs.readFileSync(path.join(FE, "my.html"), "utf8");
  ok(/senior-mode\.js\?v=4/.test(html), "頁面用 v=4 版本");
  ok(html.includes("ZenPassSenior") && html.includes("長者模式"), "我的頁有設定開關");

  console.log(`\n${bad === 0 ? "✅" : "❌"} ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
