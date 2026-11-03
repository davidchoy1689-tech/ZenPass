/**
 * ZenPass 上線前 4 項覆核（唯讀；唔會改生產 DB）
 *
 * 用法（喺 VPS 專案根目錄）：
 *   node scripts/launch-verify.cjs
 *   DB_PATH=/var/www/zenpass/backend/data/zenpass.db node scripts/launch-verify.cjs
 *
 * 輸出：終端摘要 + /tmp/zenpass-launch-verify.json
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const Database = require(path.join(__dirname, "../backend/node_modules/better-sqlite3"));

const ROOT = path.join(__dirname, "..");
const DB = process.env.DB_PATH || path.join(ROOT, "backend/data/zenpass.db");
const SITE = process.env.SITE || "https://zenpass.hk";
const OUT = process.env.OUT || "/tmp/zenpass-launch-verify.json";

const report = { generated_at: new Date().toISOString(), db: DB, site: SITE, checks: [] };
function add(id, title, pass, detail) {
  report.checks.push({ id, title, pass: !!pass, detail });
  const mark = pass ? "✅" : "❌";
  console.log(`${mark} ${title}`);
  if (detail) console.log("   " + (typeof detail === "string" ? detail : JSON.stringify(detail)));
}

(async () => {
  if (!fs.existsSync(DB)) {
    console.log("❌ 搵唔到 DB：" + DB);
    process.exit(2);
  }
  const db = new Database(DB, { readonly: true });
  const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name));
  const vc = cols("partner_venues");
  const uc = cols("users");

  /* ---------- 1. 場地 PLI 資料核驗 ---------- */
  let gate = "warn";
  try {
    const g = db.prepare("SELECT value FROM platform_settings WHERE key='venue.pli_gate'").get();
    if (g && g.value) gate = g.value;
  } catch (e) { /* 舊 DB 冇 platform_settings */ }

  const pick = (name, alias) => (vc.has(name) ? name : alias);
  const venues = db
    .prepare(
      `SELECT id, name, district, status,
              ${pick("business_reg_no", "NULL")} AS business_reg_no,
              ${pick("pli_policy_no", "NULL")} AS pli_policy_no,
              ${pick("pli_expiry", "NULL")} AS pli_expiry,
              ${pick("pli_status", "NULL")} AS pli_status,
              (SELECT COUNT(*) FROM classes c
                WHERE c.partner_venue_id = partner_venues.id
                  AND c.status NOT IN ('cancelled','deleted')) AS class_count
         FROM partner_venues
        WHERE status = 'active'
        ORDER BY name`,
    )
    .all();

  const today = new Date().toISOString().slice(0, 10);
  const rows = venues.map((v) => {
    const okStatus = v.pli_status === "verified" || v.pli_status === "exempt";
    const complete = !!(v.business_reg_no && v.pli_policy_no && v.pli_expiry);
    const expired = !!(v.pli_expiry && v.pli_expiry < today);
    return {
      name: v.name,
      district: v.district,
      pli_status: v.pli_status || "(空)",
      business_reg_no: v.business_reg_no || "",
      pli_policy_no: v.pli_policy_no || "",
      pli_expiry: v.pli_expiry || "",
      in_use: Number(v.class_count || 0) > 0,
      class_count: Number(v.class_count || 0),
      complete,
      expired,
      // 同 backend venuePliRows 一致：exempt（政府／康文署場地）唔需要保單號
      ok: v.pli_status === "exempt" || (v.pli_status === "verified" && complete && !expired),
    };
  });
  const inUse = rows.filter((r) => r.in_use);
  const badInUse = inUse.filter((r) => !r.ok);
  const verifiedCount = rows.filter((r) => r.pli_status === "verified").length;
  add(
    "pli_data",
    `場地 PLI 資料完整度（gate=${gate}）`,
    gate === "enforce" && badInUse.length === 0,
    `${rows.length} 個 active 場地｜有班使用中 ${inUse.length}｜verified ${verifiedCount}` +
      (badInUse.length
        ? "\n   ⚠️ 有班但未齊料：" + badInUse.map((b) => `${b.name}(${b.pli_status})`).join("、")
        : "\n   ✓ 所有有班場地已核驗") +
      (gate !== "enforce" ? "\n   ⚠️ 閘門仍係 " + gate + "，未切 enforce" : ""),
  );
  report.pli = { gate, total: rows.length, in_use: inUse.length, verified: verifiedCount, rows };

  /* ---------- 2. Enforce 閘門實測（DB 副本）---------- */
  try {
    const tmp = path.join(os.tmpdir(), `pli-verify-${Date.now()}.db`);
    fs.copyFileSync(DB, tmp);
    const raw = execFileSync(
      process.execPath,
      [path.join(ROOT, "scripts/verify-pli-gate.cjs")],
      { env: { ...process.env, DB_PATH: tmp, GATE: "enforce" }, encoding: "utf8", timeout: 30000 },
    );
    let result = null;
    try { result = JSON.parse(raw.trim()); } catch (e) {
      const m = raw.match(/\{[\s\S]*\}/);
      try { result = m ? JSON.parse(m[0]) : { raw }; } catch (e2) { result = { raw }; }
    }
    add(
      "pli_enforce",
      "Enforce 閘門實測（未核驗場地開班應被擋）",
      !!result.blocked,
      result.blocked
        ? `HTTP ${result.http} ${result.code} — 已正確阻擋「${result.tested_venue}」`
        : `未阻擋：HTTP ${result.http || "?"} ${result.code || result.error || result.reason || ""}`,
    );
    report.pli_enforce = result;
    try { fs.unlinkSync(tmp); } catch (e) {}
  } catch (e) {
    add("pli_enforce", "Enforce 閘門實測", false, "執行失敗：" + (e.message || e));
  }

  /* ---------- 3. 管理員 2FA ---------- */
  if (uc.has("totp_enabled")) {
    const admins = db
      .prepare(
        `SELECT email, role, totp_enabled, totp_enrolled_at, totp_backup_codes
           FROM users
          WHERE role IN ('super_admin','admin','platform_manager','platform_staff')
          ORDER BY role, email`,
      )
      .all()
      .map((u) => {
        let left = 0;
        try { left = JSON.parse(u.totp_backup_codes || "[]").length; } catch (e) { left = 0; }
        return {
          email: u.email,
          role: u.role,
          enabled: Number(u.totp_enabled) === 1,
          enrolled_at: u.totp_enrolled_at || "",
          backup_codes_left: left,
        };
      });
    const supers = admins.filter((a) => a.role === "super_admin");
    const allSuperOn = supers.length > 0 && supers.every((a) => a.enabled && a.backup_codes_left > 0);
    add(
      "two_factor",
      "管理員 2FA（super_admin 全開 + 有備援碼）",
      allSuperOn,
      admins.map((a) => `${a.email}：${a.enabled ? "已開" : "未開"}${a.enabled ? `（備援碼 ${a.backup_codes_left} 組）` : ""}`).join("\n   "),
    );
    report.two_factor = admins;
  } else {
    add("two_factor", "管理員 2FA", false, "users 表未有 totp_enabled 欄（2FA 未部署）");
  }

  /* ---------- 4. 證書存證 + 首頁線上檢查 ---------- */
  let certOk = false;
  try {
    const svc = require(path.join(ROOT, "backend/src/services/certificate-service"));
    const certs = db.prepare("SELECT id, code, student_name, coach_id, issued_at, verify_hash FROM certificates").all();
    const unsealed = certs.filter((c) => !c.verify_hash).length;
    const broken = certs.filter((c) => c.verify_hash && svc.certHash(c) !== c.verify_hash).length;
    certOk = broken === 0 && unsealed === 0;
    add("cert_integrity", "證書存證完整性（重算 SHA-256）", certOk, `共 ${certs.length} 張｜未封存 ${unsealed}｜對唔上 ${broken}`);
    report.certificates = { total: certs.length, unsealed, broken };
  } catch (e) {
    add("cert_integrity", "證書存證完整性", false, "執行失敗：" + (e.message || e));
  }

  try {
    const h = await fetch(SITE + "/api/health").then((r) => r.json());
    const html = await fetch(SITE + "/index.html").then((r) => r.text());
    const feat = await fetch(SITE + "/api/classes/featured?limit=4").then((r) => r.json());
    const live = (feat.classes || []).length;
    const checks = {
      health: !!h.success,
      cta: html.includes("立即查看即開班次"),
      h1: html.includes("全港新興運動 × 樂齡強肌伸展體驗平台"),
      daytime: html.includes("平日日間"),
      live_cards: live > 0,
    };
    const pass = checks.health && checks.cta && checks.h1 && checks.daytime;
    add("site", "首頁線上內容與 API", pass, checks);
    report.site_checks = checks;
  } catch (e) {
    add("site", "首頁線上內容與 API", false, "連線失敗：" + (e.message || e));
  }

  db.close();

  const failed = report.checks.filter((c) => !c.pass);
  report.summary = { total: report.checks.length, passed: report.checks.length - failed.length, failed: failed.length };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\n📋 ${report.summary.passed}/${report.summary.total} 項通過｜報告：${OUT}`);
  process.exit(failed.length ? 1 : 0);
})();
