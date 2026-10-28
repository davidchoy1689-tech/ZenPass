/**
 * 上線覆核工具：場地 PLI 開班閘門實測（跑喺 DB 副本，唔會污染生產）
 * 用法：
 *   DB_PATH=/tmp/pli-verify.db node scripts/verify-pli-gate.js           # 依副本內 gate 設定測試
 *   DB_PATH=/tmp/pli-verify.db GATE=enforce node scripts/verify-pli-gate.js  # 強制以 enforce 測試（只改副本）
 */
const path = require("path");
const Database = require(require("path").join(__dirname, "../backend/node_modules/better-sqlite3"));

process.env.JWT_SECRET = process.env.JWT_SECRET || "verify-only-secret-0123456789abcdef";
const dbPath = process.env.DB_PATH;
if (!dbPath) { console.error("需要 DB_PATH"); process.exit(1); }

(async () => {
  const db = new Database(dbPath);
  const today = new Date().toISOString().slice(0, 10);

  const gateRow = db.prepare("SELECT value FROM platform_settings WHERE key='venue.pli_gate'").get();
  const gate = process.env.GATE || (gateRow ? gateRow.value : "warn");
  if (process.env.GATE) {
    db.prepare("INSERT INTO platform_settings (key,value,description) VALUES ('venue.pli_gate',?,'verify override') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(process.env.GATE);
  }

  const unverified = db
    .prepare("SELECT id, name FROM partner_venues WHERE status='active' AND (pli_status IS NULL OR pli_status!='verified' AND pli_status!='exempt') LIMIT 1")
    .get();
  if (!unverified) { console.log(JSON.stringify({ ok: false, reason: "副本內冇 unverified 場地可測" })); process.exit(2); }

  // 揀一個真實教練嘅班，將副本內嘅場地指向 unverified（只改副本）
  const cls = db
    .prepare("SELECT id, title, coach_id, partner_venue_id FROM classes WHERE status='active' AND coach_id IS NOT NULL LIMIT 1")
    .get();
  if (!cls) { console.log(JSON.stringify({ ok: false, reason: "副本內冇 active 班" })); process.exit(2); }
  db.prepare("UPDATE classes SET partner_venue_id=? WHERE id=?").run(unverified.id, cls.id);

  const coachRouter = require(path.join(__dirname, "../backend/src/routes/coach"));
  const layer = coachRouter.stack.find((l) => l.route && l.route.path === "/schedules" && l.route.methods.post);
  if (!layer) { console.log(JSON.stringify({ ok: false, reason: "搵唔到 POST /schedules" })); process.exit(2); }
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const start = new Date(Date.now() + 3 * 864e5); start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 90 * 60000);
  const req = {
    user: { id: cls.coach_id, role: "coach" },
    body: { class_id: cls.id, start_time: start.toISOString(), end_time: end.toISOString(), recurring: "none" },
    headers: {}, params: {}, query: {},
  };
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (x) => { res.body = x; return res; };
  await handler(req, res);

  const out = {
    gate,
    tested_venue: unverified.name,
    tested_class: cls.title,
    http: res.statusCode,
    code: (res.body && res.body.code) || null,
    error: (res.body && res.body.error) || null,
    blocked: res.statusCode === 400 && res.body && res.body.code === "VENUE_PLI_INVALID",
    today,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
