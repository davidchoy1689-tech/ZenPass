/**
 * Phase 5.1 — 自動化 FPS 批次清算（Bank Direct Clearing）
 *
 * 安全原則：
 * - 只清算 fraud_audit_status = clean 的班次收益；有 flagged 打卡的班次整筆留在待核實隊列
 * - 嚴格排除 prodtest-% / VERIFIED_TEST% / 沙盒場地
 * - 同一 payout_cycle_code 只可生成一個批次（Double-Payout Guard）
 * - 所有金額為整數 cents；批次與明細永久保留
 *
 * 銀行介面：以 adapter 抽象。FPS_BANK_PROVIDER=mock（預設）時為模擬模式，
 * 回傳 deterministic 銀行參考號；接真實銀行（HSBC/DBS/恒生 Corporate API 或
 * ISO 20022 pain.001）只需提供 adapter 憑證與 endpoint。
 */
const express = require("express");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../services/database");
const { authenticateToken, requirePermission } = require("../middleware/auth");
const { audit } = require("../services/audit");

const router = express.Router();

function fail(res, status, code, error, extra) {
  return res.status(status).json({ success: false, code, error, ...(extra || {}) });
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fps_clearing_batches (
      id TEXT PRIMARY KEY,
      payout_cycle_code TEXT NOT NULL,
      total_recipients INTEGER NOT NULL DEFAULT 0,
      total_payout_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'draft',
      bank_batch_reference TEXT,
      bank_mode TEXT DEFAULT 'simulated',
      initiated_by_user_id TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      details_json TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fps_batch_cycle ON fps_clearing_batches(payout_cycle_code);
    CREATE TABLE IF NOT EXISTS fps_clearing_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      coach_id TEXT NOT NULL,
      coach_name TEXT,
      amount_cents INTEGER NOT NULL,
      fps_id_masked TEXT,
      status TEXT DEFAULT 'processing',
      bank_tx_id TEXT,
      error_code TEXT,
      earning_ids TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fps_item_batch ON fps_clearing_items(batch_id);
  `);
  const have = db.prepare("PRAGMA table_info(coach_earnings)").all().map((c) => c.name);
  [["clearing_batch_id", "TEXT"], ["bank_tx_id", "TEXT"], ["clearing_status", "TEXT DEFAULT 'pending'"], ["held_reason", "TEXT"]].forEach(([n, t]) => {
    if (!have.includes(n)) db.exec(`ALTER TABLE coach_earnings ADD COLUMN ${n} ${t}`);
  });
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_earnings_clearing ON coach_earnings(clearing_status, payout_id)"); } catch (e) {}
}

function hktCycle(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const y = get("year"), m = get("month"), d = get("day");
  const ordinal = Math.ceil(Number(d) / 7);
  return `${y}-${m}-M${ordinal}`;
}

/** 找出有 flagged 打卡的班次 */
function flaggedSchedules(db) {
  const rows = db.prepare("SELECT DISTINCT schedule_id FROM bookings WHERE COALESCE(fraud_audit_status,'') LIKE 'flagged%' AND schedule_id IS NOT NULL").all();
  return new Set(rows.map((r) => r.schedule_id));
}

function eligibleEarnings(db, cycleCode) {
  return db.prepare(
    `SELECT l.id, l.coach_id, l.schedule_id, COALESCE(l.net_amount_cents, ROUND(l.net_amount*100)) amount_cents,
            u.name coach_name, u.bank_account, u.bank_code
       FROM coach_earnings l
       JOIN users u ON u.id = l.coach_id
       LEFT JOIN classes c ON c.id = l.class_id
      WHERE COALESCE(l.clearing_status,'pending')='pending'
        AND l.payout_id IS NULL
        AND COALESCE(l.net_amount_cents, ROUND(l.net_amount*100), 0) > 0
        AND COALESCE(l.schedule_id,'') NOT LIKE 'prodtest-%'
        AND COALESCE(c.class_reference,'') NOT LIKE 'VERIFIED_TEST%'
        AND NOT EXISTS (
          SELECT 1 FROM bookings b WHERE b.schedule_id = l.schedule_id AND COALESCE(b.fraud_audit_status,'') LIKE 'flagged%'
        )
      ORDER BY l.coach_id, l.id`,
  ).all();
}

function heldEarnings(db) {
  return db.prepare(
    `SELECT l.id, l.coach_id, l.schedule_id, COALESCE(l.net_amount_cents, ROUND(l.net_amount*100)) amount_cents
       FROM coach_earnings l
      WHERE COALESCE(l.clearing_status,'pending')='pending' AND l.payout_id IS NULL
        AND EXISTS (SELECT 1 FROM bookings b WHERE b.schedule_id=l.schedule_id AND COALESCE(b.fraud_audit_status,'') LIKE 'flagged%')`,
  ).all();
}

function bankAdapter(mode) {
  const provider = String(process.env.FPS_BANK_PROVIDER || "mock").toLowerCase();
  const hasCreds = !!(process.env.FPS_BANK_API_KEY && process.env.FPS_BANK_ENDPOINT);
  if (provider !== "mock" && !hasCreds) {
    const err = new Error("銀行 Open API 憑證未配置");
    err.code = "BANK_NOT_CONFIGURED";
    throw err;
  }
  return {
    mode: provider === "mock" ? "simulated" : provider,
    async submitBatch({ items, cycleCode, batchId }) {
      if (provider === "mock" || !hasCreds) {
        const ref = "FPSB-" + cycleCode.replace(/[^0-9A-Z]/gi, "") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
        return {
          mode: provider === "mock" ? "simulated" : provider,
          bank_batch_reference: ref,
          items: items.map((it) => ({ ...it, status: "cleared", bank_tx_id: "FPS" + crypto.createHash("sha256").update(batchId + it.coach_id).digest("hex").slice(0, 12).toUpperCase() })),
          simulated: true,
        };
      }
      // 真實銀行 adapter：此處按 ISO 20022 pain.001 或銀行 REST 實作。
      // 未提供憑證前不會執行任何真實轉賬。
      const err = new Error("真實銀行 adapter 未實作");
      err.code = "BANK_ADAPTER_NOT_IMPLEMENTED";
      throw err;
    },
  };
}

function runBatch({ cycleCode, adminId }) {
  const db = getDb();
  ensureSchema(db);
  const cycle = String(cycleCode || hktCycle());

  const existing = db.prepare("SELECT * FROM fps_clearing_batches WHERE payout_cycle_code=?").get(cycle);
  if (existing) {
    const err = new Error("此清算週期已有批次，禁止重複出糧");
    err.code = "BATCH_ALREADY_EXISTS";
    err.batch = existing;
    throw err;
  }

  const rows = eligibleEarnings(db, cycle);
  if (!rows.length) {
    const err = new Error("沒有可清算的收益分錄");
    err.code = "NO_ELIGIBLE_EARNINGS";
    throw err;
  }

  const byCoach = new Map();
  for (const r of rows) {
    if (!byCoach.has(r.coach_id)) byCoach.set(r.coach_id, { coach_id: r.coach_id, coach_name: r.coach_name, fps: r.bank_account || r.bank_code || "", amount_cents: 0, earning_ids: [] });
    const g = byCoach.get(r.coach_id);
    g.amount_cents += Number(r.amount_cents);
    g.earning_ids.push(r.id);
  }
  const groups = [...byCoach.values()];
  const totalCents = groups.reduce((s, g) => s + g.amount_cents, 0);

  const batchId = uuidv4();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO fps_clearing_batches (id, payout_cycle_code, total_recipients, total_payout_cents, status, initiated_by_user_id)
       VALUES (?,?,?,?, 'processing', ?)`,
    ).run(batchId, cycle, groups.length, totalCents, adminId);

    const itemRows = groups.map((g) => ({
      id: uuidv4(),
      batch_id: batchId,
      coach_id: g.coach_id,
      coach_name: g.coach_name,
      amount_cents: g.amount_cents,
      fps_id_masked: g.fps ? "****" + String(g.fps).slice(-4) : null,
      earning_ids: g.earning_ids,
    }));

    for (const it of itemRows) {
      db.prepare(
        `INSERT INTO fps_clearing_items (id,batch_id,coach_id,coach_name,amount_cents,fps_id_masked,status,earning_ids)
         VALUES (?,?,?,?,?,?, 'processing', ?)`,
      ).run(it.id, it.batch_id, it.coach_id, it.coach_name || "", it.amount_cents, it.fps_id_masked, JSON.stringify(it.earning_ids));
      for (const eid of it.earning_ids) {
        db.prepare("UPDATE coach_earnings SET clearing_status='processing', clearing_batch_id=? WHERE id=?").run(batchId, eid);
      }
    }

    for (const h of heldEarnings(db)) {
      db.prepare("UPDATE coach_earnings SET clearing_status='held_fraud', held_reason='flagged attendance' WHERE id=?").run(h.id);
    }

    db.exec("COMMIT");
    return { batchId, cycle, itemRows, totalCents, db };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

async function submitToBank({ batchId, cycle, itemRows }) {
  const db = getDb();
  const adapter = bankAdapter();
  const submitted = await adapter.submitBatch({ items: itemRows, cycleCode: cycle, batchId });
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const it of submitted.items) {
      db.prepare("UPDATE fps_clearing_items SET status=?, bank_tx_id=?, updated_at=datetime('now') WHERE id=?").run(it.status, it.bank_tx_id, it.id);
      const ids = itemRows.find((r) => r.id === it.id)?.earning_ids || [];
      for (const eid of ids) {
        db.prepare("UPDATE coach_earnings SET clearing_status=?, bank_tx_id=? WHERE id=?").run(it.status === "cleared" ? "cleared" : "failed", it.bank_tx_id, eid);
      }
    }
    const okAll = submitted.items.every((i) => i.status === "cleared");
    db.prepare("UPDATE fps_clearing_batches SET status=?, bank_batch_reference=?, bank_mode=?, completed_at=? WHERE id=?")
      .run(okAll ? "completed" : "partial_failure", submitted.bank_batch_reference, submitted.mode, new Date().toISOString(), batchId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return submitted;
}

// ===== POST /api/admin/clearing/run-fps-batch =====
router.post("/admin/clearing/run-fps-batch", authenticateToken, requirePermission("finance.payout.process"), async (req, res) => {
  try {
    const cycle = String(req.body?.payout_cycle_code || hktCycle());
    const excludeFlagged = req.body?.exclude_flagged_fraud !== false;
    if (!excludeFlagged) return fail(res, 400, "FRAUD_EXCLUSION_REQUIRED", "清算必須排除 flagged 打卡收益");

    const { batchId, itemRows, totalCents } = runBatch({ cycleCode: cycle, adminId: req.user.id });
    let submitted;
    try {
      submitted = await submitToBank({ batchId, cycle, itemRows });
    } catch (e) {
      const db = getDb();
      db.prepare("UPDATE fps_clearing_batches SET status='partial_failure', details_json=? WHERE id=?").run(JSON.stringify({ error: e.code || e.message }), batchId);
      return fail(res, e.code === "BANK_NOT_CONFIGURED" ? 409 : 500, e.code || "BANK_ERROR", e.message, { batch_id: batchId });
    }

    const db = getDb();
    const batch = db.prepare("SELECT * FROM fps_clearing_batches WHERE id=?").get(batchId);
    audit({
      actionType: "clearing.fps_batch_submitted",
      entityType: "fps_clearing_batch",
      entityId: batchId,
      userId: req.user.id,
      newValues: { cycle, recipients: itemRows.length, total_cents: totalCents, bank_reference: batch.bank_batch_reference, mode: submitted.mode },
      description: `FPS 批次清算 ${cycle}`,
    });

    res.status(201).json({
      success: true,
      batch_id: batchId,
      payout_cycle_code: cycle,
      total_recipients: itemRows.length,
      total_payout_cents: totalCents,
      status: batch.status,
      bank_batch_reference: batch.bank_batch_reference,
      mode: submitted.mode,
      simulated: !!submitted.simulated,
      items: itemRows.map((i) => ({ coach_id: i.coach_id, coach_name: i.coach_name, amount_cents: i.amount_cents, fps_id_masked: i.fps_id_masked, status: "cleared" })),
    });
  } catch (e) {
    if (e.code === "BATCH_ALREADY_EXISTS") {
      return fail(res, 409, e.code, e.message, { batch_id: e.batch?.id, status: e.batch?.status, bank_reference: e.batch?.bank_batch_reference });
    }
    if (e.code === "NO_ELIGIBLE_EARNINGS") return fail(res, 409, e.code, e.message);
    console.error("[CLEARING] run:", e.message);
    fail(res, 500, "SERVER_ERROR", "清算批次失敗");
  }
});

// ===== GET 批次列表 / 詳情 =====
router.get("/admin/clearing/batches", authenticateToken, requirePermission("finance.payout.view"), (req, res) => {
  const db = getDb();
  ensureSchema(db);
  const rows = db.prepare("SELECT * FROM fps_clearing_batches ORDER BY created_at DESC LIMIT 100").all();
  res.json({ success: true, batches: rows });
});

router.get("/admin/clearing/batches/:id", authenticateToken, requirePermission("finance.payout.view"), (req, res) => {
  const db = getDb();
  ensureSchema(db);
  const batch = db.prepare("SELECT * FROM fps_clearing_batches WHERE id=?").get(req.params.id);
  if (!batch) return fail(res, 404, "BATCH_NOT_FOUND", "批次不存在");
  const items = db.prepare("SELECT * FROM fps_clearing_items WHERE batch_id=? ORDER BY amount_cents DESC").all(req.params.id);
  res.json({ success: true, batch, items });
});

// ===== 銀行非同步 Webhook =====
router.post("/internal/fps-bank-webhook", (req, res) => {
  try {
    const secret = process.env.FPS_WEBHOOK_SECRET || process.env.JWT_SECRET || "";
    const sig = String(req.headers["x-fps-signature"] || "");
    const raw = JSON.stringify(req.body || {});
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(403).json({ success: false, code: "SIGNATURE_INVALID", error: "簽章無效" });
    }
    const db = getDb();
    ensureSchema(db);
    const batchRef = String(req.body?.bank_batch_reference || "");
    const results = Array.isArray(req.body?.items) ? req.body.items : [];
    const batch = db.prepare("SELECT * FROM fps_clearing_batches WHERE bank_batch_reference=?").get(batchRef);
    if (!batch) return res.status(404).json({ success: false, code: "BATCH_NOT_FOUND", error: "批次不存在" });

    for (const r of results) {
      const st = r.status === "cleared" ? "cleared" : "failed";
      const item = db.prepare("SELECT * FROM fps_clearing_items WHERE batch_id=? AND bank_tx_id=?").get(batch.id, String(r.bank_tx_id || ""));
      if (!item) continue;
      db.prepare("UPDATE fps_clearing_items SET status=?, error_code=?, updated_at=datetime('now') WHERE id=?").run(st, r.error_code || null, item.id);
      let ids = [];
      try { ids = JSON.parse(item.earning_ids || "[]"); } catch (e) {}
      for (const eid of ids) {
        db.prepare("UPDATE coach_earnings SET clearing_status=?, bank_tx_id=? WHERE id=?").run(st, r.bank_tx_id || null, eid);
      }
    }
    const left = db.prepare("SELECT COUNT(*) c FROM fps_clearing_items WHERE batch_id=? AND status='processing'").get(batch.id).c;
    const failed = db.prepare("SELECT COUNT(*) c FROM fps_clearing_items WHERE batch_id=? AND status='failed'").get(batch.id).c;
    const status = left > 0 ? "processing" : failed > 0 ? "partial_failure" : "completed";
    db.prepare("UPDATE fps_clearing_batches SET status=?, completed_at=? WHERE id=?").run(status, status === "processing" ? null : new Date().toISOString(), batch.id);

    audit({ actionType: "clearing.bank_webhook", entityType: "fps_clearing_batch", entityId: batch.id, userId: null, newValues: { status, items: results.length }, description: "銀行清算回執" });
    res.json({ success: true, status });
  } catch (e) {
    console.error("[CLEARING] webhook:", e.message);
    res.status(500).json({ success: false, error: "Webhook 處理失敗" });
  }
});

module.exports = router;
module.exports.ensureSchema = ensureSchema;
module.exports.hktCycle = hktCycle;
module.exports.runBatch = runBatch;
module.exports.eligibleEarnings = eligibleEarnings;
