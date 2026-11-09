#!/usr/bin/env node
/** test-coach-import.js — 學生名單智能解析、匯入去重、魔法連結認領 */
const os = require("os"), path = require("path"), crypto = require("crypto");
process.env.JWT_SECRET = "***".repeat(48);
process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-import-" + Date.now() + ".db");
const initDatabase = require("../src/config/init-db"), updateDatabase = require("../src/config/update-db");
let pass = 0, bad = 0;
const ok = (c, m, x) => { c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : x)); };
initDatabase(); updateDatabase();
const { getDb } = require("../src/services/database");
const db = getDb();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('coach1','c1@t.hk','蔡教練','coach')").run();
db.prepare("INSERT INTO users (id,email,name,role) VALUES ('coach2','c2@t.hk','李教練','coach')").run();

const handlerOf = (router, method, p) => {
  const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]);
  return l ? l.route.stack[l.route.stack.length - 1].handle : null;
};
const call = (h, { body = {}, user = null, params = {}, query = {} }) => new Promise((resolve) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); } };
  try { h({ body, user, params, query, headers: {}, ip: "127.0.0.1" }, res); } catch (e) { resolve({ statusCode: 500, body: { error: e.message } }); }
});

(async () => {
  const router = require("../src/routes/student-import");
  const { parseLine } = router;
  console.log("🧪 1. 智能解析");
  const a = parseLine("1. 陳大文 98765432 膝痛");
  ok(a && a.name === "陳大文" && a.phone === "98765432" && /膝痛/.test(a.notes), "編號＋中文名＋備註", JSON.stringify(a));
  const b = parseLine("+852 9876-5432 Mary");
  ok(b && b.phone === "98765432" && /Mary/i.test(b.name), "+852 破折號 正規化", JSON.stringify(b));
  const c = parseLine("陳婆婆 98765432 膝蓋術後");
  ok(c && c.name === "陳婆婆" && c.phone === "98765432" && /膝蓋術後/.test(c.notes), "中文備註自動分離", JSON.stringify(c));
  const d = parseLine("李淑芬 9123 4567");
  ok(d && d.name === "李淑芬" && d.phone === "91234567", "電話中間有空格", JSON.stringify(d));
  const e = parseLine("冇電話嘅一行");
  ok(e && e.error, "冇電話 → 錯誤行");

  console.log("🧪 2. 匯入（raw_text）");
  const imp = handlerOf(router, "post", "/coach/students/import-batch");
  const r1 = await call(imp, { user: { id: "coach1", role: "coach" }, body: { raw_text: "陳大文 98765432 膝痛\n李淑芬 91234567\n亂打一行\nMary 61234567 血壓高" } });
  ok(r1.statusCode === 200 && r1.body.created === 3, "3 位成功、1 行失敗", JSON.stringify({ c: r1.body.created, f: r1.body.failed }));
  ok(r1.body.invites.every((i) => /^[a-f0-9]{64}$/.test(i.token)), "token 64 位 hex");
  const inv = db.prepare("SELECT * FROM student_onboarding_invites WHERE coach_id='coach1' AND phone='98765432'").get();
  ok(inv && inv.status === "pending" && inv.initial_pass_quota === 1, "DB 已建立 pending 邀請");

  console.log("🧪 3. 去重 Upsert");
  const r2 = await call(imp, { user: { id: "coach1", role: "coach" }, body: { items: [{ name: "陳大文", phone: "98765432", notes: "膝痛（更新）", pass_quota: 2 }] } });
  ok(r2.statusCode === 200 && r2.body.updated === 1 && r2.body.created === 0, "同教練同電話 → 更新，不重複", JSON.stringify({ c: r2.body.created, u: r2.body.updated }));
  const inv2 = db.prepare("SELECT * FROM student_onboarding_invites WHERE coach_id='coach1' AND phone='98765432'").get();
  ok(inv2.notes.includes("更新") && inv2.initial_pass_quota === 2, "備註與堂數已更新");
  const count = db.prepare("SELECT COUNT(*) c FROM student_onboarding_invites WHERE coach_id='coach1' AND phone='98765432'").get().c;
  ok(count === 1, "冇重複記錄");
  const other = await call(imp, { user: { id: "coach2", role: "coach" }, body: { items: [{ name: "陳大文", phone: "98765432", notes: "" }] } });
  ok(other.body.created === 1, "另一位教練可獨立建立（教練+電話為鍵）");

  console.log("🧪 4. 認領連結");
  const claim = handlerOf(router, "get", "/student/onboarding/claim");
  const complete = handlerOf(router, "post", "/student/onboarding/complete");
  const tok = inv2.token;
  const c1 = await call(claim, { query: { token: tok } });
  ok(c1.statusCode === 200 && c1.body.coach_name === "蔡教練", "顯示教練姓名", c1.body.coach_name);
  ok(c1.body.student_name === "陳大文" && c1.body.quota === 2, "顯示學員與贈堂");
  const badTok = await call(claim, { query: { token: "abc" } });
  ok(badTok.statusCode === 400, "格式錯 → 400");

  console.log("🧪 5. 認領完成（原子）");
  const done = await call(complete, { body: { token: tok } });
  ok(done.statusCode === 200 && done.body.success, "認領成功", done.body.error);
  ok(done.body.user.phone === "98765432", "建立／綁定學員帳戶");
  const after = db.prepare("SELECT status, claimed_by_user_id FROM student_onboarding_invites WHERE token=?").get(tok);
  ok(after.status === "claimed" && after.claimed_by_user_id === done.body.user.id, "邀請標記已認領");
  const p = db.prepare("SELECT * FROM user_passes WHERE user_id=?").get(done.body.user.id);
  ok(p && p.remaining_credits === 2 && p.status === "active", "已發 2 堂迎新 Pass", p && p.remaining_credits);
  const again = await call(complete, { body: { token: tok } });
  ok(again.statusCode === 409, "重複認領 → 409");

  console.log("🧪 6. 過期");
  db.prepare("UPDATE student_onboarding_invites SET created_at=datetime('now','-40 days') WHERE phone='91234567' AND coach_id='coach1'").run();
  const old = db.prepare("SELECT token FROM student_onboarding_invites WHERE phone='91234567' AND coach_id='coach1'").get();
  const ce = await call(claim, { query: { token: old.token } });
  ok(ce.body.status === "expired", "超過 30 日 → expired");
  const de = await call(complete, { body: { token: old.token } });
  ok(de.statusCode === 410, "過期認領 → 410");

  console.log("🧪 7. 教練清單");
  const list = handlerOf(router, "get", "/coach/students/invites");
  const l1 = await call(list, { user: { id: "coach1", role: "coach" } });
  ok(l1.body.invites.every((x) => x.coach_id === undefined), "只回自己（不含其他教練）", l1.body.invites.length);
  ok(l1.body.stats.claimed >= 1 && l1.body.stats.rate >= 0, "有啟用率統計");

  console.log("🧪 8. 前端存在");
  const fs = require("fs");
  const base = path.join(__dirname, "../../frontend-v2");
  const impPage = fs.readFileSync(path.join(base, "coach-students-import.html"), "utf8");
  const welcome = fs.readFileSync(path.join(base, "welcome.html"), "utf8");
  ok(/coach\/students\/import-batch/.test(impPage), "教練頁接匯入 API");
  ok(/智能解析/.test(impPage) && /welcome\.html\?token=/.test(impPage), "有解析＋迎新連結");
  ok(/student\/onboarding\/claim/.test(welcome) && /student\/onboarding\/complete/.test(welcome), "welcome 接認領 API");
  ok(/zenpass_token/.test(welcome), "認領後自動登入");

  console.log(`\n${bad === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
})();
