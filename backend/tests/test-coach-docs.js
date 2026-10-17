/** ZenPass — 教練認證文件上載 tests */
const fs = require("fs");
const path = require("path");
let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

console.log("🧪 教練認證文件 tests");
const root = path.join(__dirname, "..");
const web = path.join(root, "..", "frontend-v2");

const init = fs.readFileSync(path.join(root, "src/config/init-db.js"), "utf8");
ok(init.includes("id_doc_url"), "coach_applications.id_doc_url");
ok(init.includes("cert_doc_url"), "coach_applications.cert_doc_url");

const coach = fs.readFileSync(path.join(root, "src/routes/coach.js"), "utf8");
ok(coach.includes("id_doc_url") && coach.includes("cert_doc_url"), "apply 接收文件 URL");
ok(/INSERT INTO coach_applications[\s\S]{0,400}id_doc_url/.test(coach), "寫入 DB");

const up = fs.readFileSync(path.join(root, "src/routes/upload.js"), "utf8");
ok(up.includes("application/pdf"), "接受 PDF（證書常用）");
ok(up.includes('upload.array("files", 10)'), "支援多檔上載");
ok(up.includes("10 * 1024 * 1024"), "上限 10MB");

const page = fs.readFileSync(path.join(web, "coach-apply.html"), "utf8");
ok(page.includes('id="f-iddoc"'), "申請表有身份證上載");
ok(page.includes('id="f-certdoc"'), "申請表有資歷上載");
ok(page.includes("uploadDocs"), "有上載邏輯");
ok(page.includes("請上載身份證明文件"), "缺文件會阻止提交");
ok(page.includes("請上載最少一份資歷"), "缺資歷會阻止提交");
ok(page.includes("id_doc_url"), "提交帶 id_doc_url");
ok(page.includes("cert_doc_url"), "提交帶 cert_doc_url");

const admin = fs.readFileSync(path.join(web, "admin.html"), "utf8");
ok(admin.includes("未上載身份證") && admin.includes("未上載資歷"), "admin 顯示缺文件警示");
ok(admin.includes("a.id_doc_url") && admin.includes("a.cert_doc_url"), "admin 可開文件");

console.log(fail ? `❌ ${fail} failed` : "✅ 教練認證文件 tests passed");
if (fail) process.exit(1);
