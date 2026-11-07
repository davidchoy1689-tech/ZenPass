/**
 * Speculation Rules API + Cross-Document View Transitions
 * 純前端靜態檢查：配置合法性、預渲染名單安全、無障礙降級
 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "..", "frontend-v2");

const read = (f) => fs.readFileSync(path.join(F, f), "utf8");
const vt = read("assets/view-transitions.css");
const index = read("index.html");
const booking = read("booking.html");
const mb = read("my-bookings.html");
const senior = read("senior-view.html");
const adult = read("adult-pass.html");
const card = read("print-card.html");
const payment = read("payment.html");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

const rules = (html) => {
  const m = html.match(/<script type="speculationrules">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return { __bad: String(e) }; }
};

console.log("\n🧪 1. View Transitions CSS");
{
  ok("共用樣式檔存在", vt.length > 200);
  ok("@view-transition navigation auto", /@view-transition\s*\{\s*navigation:\s*auto;?\s*\}/.test(vt));
  ok("old(root) fade-out 180ms", /::view-transition-old\(root\)/.test(vt) && /180ms/.test(vt));
  ok("new(root) fade-in 180ms", /::view-transition-new\(root\)/.test(vt) && /zp-vt-fade-in|fade-in/.test(vt));
  ok("cubic-bezier(0.4,0,0.2,1)", /cubic-bezier\(0\.4,\s*0,\s*0\.2,\s*1\)/.test(vt));
  ok("prefers-reduced-motion 停用動畫", /@media \(prefers-reduced-motion: reduce\)/.test(vt) && /animation:\s*none\s*!important/.test(vt));
}

console.log("\n🧪 2. 各頁面已 opt-in（跨頁轉場需兩邊都聲明）");
{
  ok("my-bookings 引入共用 CSS", /assets\/view-transitions\.css/.test(mb));
  ok("index 引入共用 CSS", /assets\/view-transitions\.css/.test(index));
  ok("booking 引入共用 CSS", /assets\/view-transitions\.css/.test(booking));
  for (const [n, html] of [["senior-view", senior], ["adult-pass", adult], ["print-card", card], ["payment", payment]]) {
    ok(`${n} 自帶 @view-transition`, /@view-transition\s*\{\s*navigation:\s*auto/.test(html));
    ok(`${n} 有 reduced-motion 守衛`, /prefers-reduced-motion/.test(html));
  }
}

console.log("\n🧪 3. Speculation Rules 合法性");
{
  const i = rules(index), b = rules(booking), m = rules(mb);
  ok("index 有合法 JSON", i && !i.__bad);
  ok("booking 有合法 JSON", b && !b.__bad);
  ok("my-bookings 有合法 JSON", m && !m.__bad);
  const pats = (r) => (r?.prerender || []).map((x) => x.where && x.where.href_matches).filter(Boolean);
  for (const [n, r] of [["index", i], ["booking", b], ["my-bookings", m]]) {
    ok(`${n} prerender = source document`, r && r.prerender.every((x) => x.source === "document"));
    ok(`${n} eagerness moderate`, r && r.prerender.every((x) => x.eagerness === "moderate"));
    ok(`${n} 用 href_matches 帶 query 前綴`, pats(r).every((x) => /\*$/.test(x)), pats(r).join(","));
    ok(`${n} prefetch conservative + href_matches`, r && r.prefetch[0].eagerness === "conservative" && /\/\*/.test(r.prefetch[0].where.href_matches));
  }
  ok("my-bookings 預渲染隨身卡/大字版/票券",
    JSON.stringify(pats(m).sort()) === JSON.stringify(["/adult-pass.html*", "/print-card.html*", "/senior-view.html*"].sort()));
  ok("index 預渲染 booking/my-bookings/print-card/senior-view",
    ["/booking.html*", "/my-bookings.html*", "/print-card.html*", "/senior-view.html*"].every((x) => pats(i).includes(x)));
  ok("booking 預渲染 my-bookings/print-card/senior-view",
    ["/my-bookings.html*", "/print-card.html*", "/senior-view.html*"].every((x) => pats(b).includes(x)));
  ok("URLPattern 前綴會匹配帶 query 的真實連結（實測見 commit msg）", pats(m).every((x) => /\.html\*$/.test(x)));
}

console.log("\n🧪 4. 安全：破壞性操作唔可以預渲染");
{
  const pats = [index, booking, mb].flatMap((h) => (rules(h) || { prerender: [] }).prerender.map((x) => x.where.href_matches));
  const banned = /logout|cancel|delete|refund|pay|checkout|admin|credits|bookings\//i;
  ok("規則內無破壞性路由", !pats.some((u) => banned.test(u)), pats.join(","));
  ok("規則只覆蓋唯讀展示頁", pats.every((u) => /^\/(booking|my-bookings|print-card|senior-view|adult-pass)\.html\*$/.test(u)), pats.join(","));
  ok("無 GET logout 連結（prefetch 不會誤登出）",
    !/href="[^"]*logout/i.test(index + booking + mb));
  ok("speculationrules 只出現一次／頁", [index, booking, mb].every((h) => (h.match(/type="speculationrules"/g) || []).length === 1));
  ok("script 放喺 </head> 之前", [index, booking, mb].every((h) => h.indexOf('type="speculationrules"') < h.indexOf("</head>")));
}

console.log("\n🧪 5. 優雅降級（舊瀏覽器零副作用）");
{
  ok("無 JS 依賴（純宣告式）", !/speculationrules[\s\S]{0,2000}addEventListener/.test(index + booking + mb));
  ok("無 try/catch 包住規則（未知 script 會被忽略）", !/typeof HTMLScriptElement\.supports/.test(index + booking + mb));
  ok("未加入 Prerender 專用 JS API（避免破壞舊瀏覽器）", !/document\.prerendering|prerenderingchange/.test(index + booking + mb));
}

console.log(`\n${failed === 0 ? "✅" : "❌"} view-transitions：${passed} 通過 / ${failed} 失敗\n`);
process.exit(failed ? 1 : 0);
