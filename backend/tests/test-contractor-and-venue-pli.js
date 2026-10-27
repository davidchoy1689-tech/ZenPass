/**
 * ZenPass — 教練獨立合約人協議 + 場地 PLI 閘門 tests
 * node backend/tests/test-contractor-and-venue-pli.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test-only-secret-value-for-zenpass-tests-32";
process.env.VENUE_PLI_GATE = "enforce";
const tmp = path.join(os.tmpdir(), "zenpass-capli-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log("  ✅ " + m); pass++; } else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT, status TEXT DEFAULT 'active');
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  for (const [id, role, coach] of [["admin","admin",0],["coach1","coach",1]]) {
    pre.prepare("INSERT INTO users (id,name,email,phone,role,is_coach) VALUES (?,?,?,?,?,?)").run(id, id, id + "@x.hk", "91234567", role, coach);
  }
  pre.close();

  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();
  const future = new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10);
  db.exec(`CREATE TABLE IF NOT EXISTS coach_credentials (
    id TEXT PRIMARY KEY, user_id TEXT, license_type TEXT, license_no TEXT, license_url TEXT,
    license_expiry TEXT, first_aid_type TEXT, first_aid_expiry TEXT, first_aid_url TEXT,
    insurance_policy_url TEXT, insurance_expiry_date TEXT, status TEXT DEFAULT 'pending',
    reviewed_at TEXT, reviewed_by TEXT, review_note TEXT, created_at TEXT DEFAULT (datetime('now')),
    qualified_sports TEXT, is_starred INTEGER DEFAULT 0, certificate_url TEXT,
    agreement_version TEXT, agreement_ack_at TEXT
  );`);
  db.exec("ALTER TABLE partner_venues ADD COLUMN business_reg_no TEXT");
  db.exec("ALTER TABLE partner_venues ADD COLUMN pli_policy_no TEXT");
  db.exec("ALTER TABLE partner_venues ADD COLUMN pli_expiry TEXT");
  db.exec("ALTER TABLE partner_venues ADD COLUMN pli_status TEXT DEFAULT 'unverified'");
  db.exec("ALTER TABLE partner_venues ADD COLUMN venue_terms_ack_at TEXT");
  db.prepare("INSERT INTO partner_venues (id,name,district,status) VALUES ('v-unverified','工廈草地場','觀塘','active')").run();
  db.prepare("INSERT INTO partner_venues (id,name,district,status) VALUES ('v-ok','合規體育館','荔枝角','active')").run();
  db.prepare("UPDATE partner_venues SET pli_status='verified', pli_expiry=?, pli_policy_no='PL-1' WHERE id='v-ok'").run(future);
  db.prepare("UPDATE partner_venues SET pli_status='unverified' WHERE id='v-unverified'").run();

  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,partner_venue_id,max_participants) VALUES ('c-bad','coach1','工廈班','新興運動',120,150,'active','v-unverified',10)").run();
  db.prepare("INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,status,partner_venue_id,max_participants) VALUES ('c-ok','coach1','合規班','新興運動',120,150,'active','v-ok',10)").run();

  const coachRouter = require("../src/routes/coach");
  const crmRouter = require("../src/routes/admin-crm");
  const pick = (r, p, m) => {
    const layer = r.stack.find((l) => l.route && l.route.path === p && l.route.methods[m]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  const call = (fn, req) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    return Promise.resolve(fn({ query: {}, params: {}, body: {}, headers: {}, ...req }, res)).then(() => res);
  };

  console.log("\n🧪 獨立合約人協議 + 場地 PLI\n");

  console.log("📋 1. 協議內容與簽署");
  const { COACH_AGREEMENT_V1 } = require("../src/config/coach-agreement");
  ok(COACH_AGREEMENT_V1.version === "ca-v1-2026-10", "版本 ca-v1-2026-10");
  ok(COACH_AGREEMENT_V1.clauses.length >= 5, "至少 5 條條款");
  ok(COACH_AGREEMENT_V1.clauses.some((c) => /Independent Contractor/.test(c.title)), "有獨立合約人地位條款");
  ok(COACH_AGREEMENT_V1.clauses.some((c) => /Indemnification/.test(c.title)), "有彌償保證條款");

  const statusFn = pick(coachRouter, "/agreement/status", "get");
  const acceptFn = pick(coachRouter, "/agreement/accept", "post");
  const before = await call(statusFn, { user: { id: "coach1" } });
  ok(before.body.accepted === false, "未簽署 → accepted=false");
  const bad = await call(acceptFn, { user: { id: "coach1" }, body: {} });
  ok(bad.statusCode === 400 && bad.body.code === "AGREEMENT_NOT_ACCEPTED", "未勾選 → 400");
  const good = await call(acceptFn, { user: { id: "coach1" }, body: { agreed: true }, ip: "10.0.0.1" });
  ok(good.statusCode === 200 && good.body.version === COACH_AGREEMENT_V1.version, "簽署成功");
  const cc = db.prepare("SELECT * FROM coach_credentials WHERE user_id='coach1'").get();
  ok(cc && cc.agreement_version === COACH_AGREEMENT_V1.version, "DB 已記錄協議版本");
  ok(!!cc.agreement_ack_at, "已記錄簽署時間");
  const after = await call(statusFn, { user: { id: "coach1" } });
  ok(after.body.accepted === true, "簽署後 accepted=true");
  const aAudit = db.prepare("SELECT * FROM audit_log WHERE action_type='coach.agreement_accepted'").get();
  ok(!!aAudit, "已寫入 audit_log");

  console.log("📋 2. 場地 PLI 開班閘門");
  const schedFn = pick(coachRouter, "/schedules", "post");
  const t1 = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 19).replace("T", " ");
  const t2 = new Date(Date.now() + 5 * 864e5 + 7200e3).toISOString().slice(0, 19).replace("T", " ");
  const blocked = await call(schedFn, {
    user: { id: "coach1", role: "coach" },
    body: { class_id: "c-bad", start_time: t1, end_time: t2, max_participants: 10 },
  });
  ok(blocked.statusCode === 400 && blocked.body.code === "VENUE_PLI_INVALID", "未核驗 PLI → 400 VENUE_PLI_INVALID");
  const allowed = await call(schedFn, {
    user: { id: "coach1", role: "coach" },
    body: { class_id: "c-ok", start_time: t1, end_time: t2, max_participants: 10 },
  });
  ok(allowed.statusCode === 201 && Array.isArray(allowed.body.schedule_ids), "PLI 合格 → 可開班（201）");
  const noWarn = !allowed.body.pli_warning;
  ok(noWarn, "合格場地唔會出警告");

  console.log("📋 3. 管理員更新場地 PLI");
  const putPli = pick(crmRouter, "/venues/:id/pli", "put");
  const badPli = await call(putPli, {
    params: { id: "v-unverified" }, user: { id: "admin", role: "admin" },
    body: { pli_status: "verified" },
  });
  ok(badPli.statusCode === 400 && badPli.body.code === "PLI_EXPIRY_REQUIRED", "標記 verified 但冇有效到期日 → 400");
  const goodPli = await call(putPli, {
    params: { id: "v-unverified" }, user: { id: "admin", role: "admin" },
    body: { pli_status: "verified", pli_expiry: future, pli_policy_no: "PL-9", business_reg_no: "12345678" },
  });
  ok(goodPli.statusCode === 200, "更新成功");
  const v = db.prepare("SELECT * FROM partner_venues WHERE id='v-unverified'").get();
  ok(v.pli_status === "verified" && v.pli_expiry === future && v.pli_policy_no === "PL-9", "DB 已更新 PLI 資料");
  const vAudit = db.prepare("SELECT * FROM audit_log WHERE action_type='venue.pli_updated'").get();
  ok(!!vAudit, "已寫入 audit_log");
  const expiredPli = await call(putPli, {
    params: { id: "v-ok" }, user: { id: "admin", role: "admin" },
    body: { pli_status: "verified", pli_expiry: "2020-01-01" },
  });
  ok(expiredPli.statusCode === 400, "過期日期 → 拒絕標記 verified");

  console.log("📋 4. 介面與條款");
  const cd = fs.readFileSync(path.join(__dirname, "../../frontend-v2/coach-dashboard.html"), "utf8");
  ok(/ensureCoachAgreement/.test(cd) && /coach\/agreement\/accept/.test(cd), "教練工作台有協議簽署閘門");
  const terms = fs.readFileSync(path.join(__dirname, "../../frontend-v2/terms.html"), "utf8");
  ok(/獨立合約人（Independent Contractor）/.test(terms), "terms 有獨立合約人條款");
  ok(/場地責任切分/.test(terms), "terms 有場地責任切分");
  ok(/具體運動風險披露/.test(terms), "terms 有具體風險披露");
  ok(/電子存證紀錄/.test(terms), "terms 有存證紀錄說明");
  ok(!/本平台舉辦|我們舉辦|本平台主辦/.test(terms), "terms 冇「舉辦／主辦」字眼");

  console.log("\n📊 結果: " + pass + " ✅ 通過, " + fail + " ❌ 失敗\n");
  try { fs.unlinkSync(tmp); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
