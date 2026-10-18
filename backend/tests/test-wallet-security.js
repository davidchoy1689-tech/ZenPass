/** ZenPass — 錢包提現重複風險 tests */
const fs = require("fs");
const path = require("path");

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

console.log("🧪 錢包提現安全 tests");

const src = fs.readFileSync(path.join(__dirname, "../src/routes/wallet.js"), "utf8");
ok(/code: "USE_COACH_PAYOUT"/.test(src), "wallet/withdraw 已封鎖（避免與教練出糧重複提款）");
ok(/唔會將 coach_earnings 標記 paid/.test(src), "有註明原因");
ok((src.match(/\["admin", "super_admin"\]\.includes\(/g) || []).length === 3, "admin 路由接受 super_admin");

const webDir = path.join(__dirname, "..", "..", "frontend-v2");
const hits = fs.readdirSync(webDir).filter((f) => f.endsWith(".html"))
  .filter((f) => /wallet\/withdraw/.test(fs.readFileSync(path.join(webDir, f), "utf8")));
ok(hits.length === 0, "前端冇使用已封鎖嘅 wallet/withdraw");

const ceSrc = fs.readFileSync(path.join(__dirname, "../src/routes/coach-earnings.js"), "utf8");
ok(/reservePayout\(req\.user\.id/.test(ceSrc), "教練出糧用 reservePayout（wallet + pending 同步扣）");

console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
process.exit(fail === 0 ? 0 : 1);
