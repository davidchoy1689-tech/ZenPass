/** ZenPass — 平台角色 + 保險責任（Uber 模式）tests */
const fs = require("fs");
const path = require("path");
let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

console.log("🧪 保險責任 / 平台角色 tests");
const root = path.join(__dirname, "..");
const web = path.join(root, "..", "frontend-v2");

const init = fs.readFileSync(path.join(root, "src/config/init-db.js"), "utf8");
ok(init.includes("insurance_declared"), "coach_applications / partner_venues 有 insurance_declared");
ok(init.includes("insurance_expiry"), "有保險到期日欄位");

const coach = fs.readFileSync(path.join(root, "src/routes/coach.js"), "utf8");
ok(coach.includes("insurance_declared"), "教練申請接收保險聲明");

const partner = fs.readFileSync(path.join(root, "src/services/partner-service.js"), "utf8");
ok(partner.includes("insurance_declared"), "場地申請接收保險聲明");
ok(/insurance_declared \? 1 : 0, insurance_doc_url/.test(partner), "場地寫入 DB");

const cp = fs.readFileSync(path.join(web, "coach-apply.html"), "utf8");
ok(cp.includes('id="f-ins"'), "教練表單有保險聲明 checkbox");
ok(cp.includes("免責聲明及風險確認"), "教練表單為免責聲明（非強制保險）");
ok(cp.includes("自行決定"), "明確講保險由教練自行決定");
ok(cp.includes("請先閱讀並勾選免責聲明"), "未勾免責聲明唔可以提交");
ok(cp.includes('id="f-ins-doc"') && !/id="f-ins-doc"[^>]*required/.test(cp), "保單上載為可選（非必填）");

const pp = fs.readFileSync(path.join(web, "partner-apply.html"), "utf8");
ok(pp.includes('id="p-ins"'), "場地表單有保險聲明");
ok(pp.includes("請先閱讀並勾選免責聲明"), "場地未勾免責聲明唔可以提交");

const terms = fs.readFileSync(path.join(web, "terms.html"), "utf8");
ok(terms.includes("配對（轉介）"), "條款寫明只提供配對");
ok(terms.includes("叫車平台"), "條款用 Uber 模式比喻");
ok(terms.includes("保險及風險承擔"), "有保險責任專章");
ok(terms.includes("自行決定"), "條款寫明保險自行決定（非強制）");
ok(terms.includes("不代任何一方投保"), "寫明平台不投保");

const detail = fs.readFileSync(path.join(web, "detail.html"), "utf8");
ok(detail.includes("ZenPass 僅提供配對"), "課程頁有平台聲明");
ok(detail.includes("保險及服務風險由教練及場地自行負責"), "課程頁寫明保險責任誰屬");

console.log(fail ? `❌ ${fail} failed` : "✅ 保險責任 tests passed");
if (fail) process.exit(1);
