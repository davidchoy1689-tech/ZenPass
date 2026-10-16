/**
 * ZenPass 禪流 — 空置時段引擎（Vacancy Engine）
 *
 * 1) 偵測即將開課但報名率偏低嘅時段（空置時段）
 * 2) 依「幾空 + 幾近」建議一個自動折扣 %（有上下限）
 * 3) 商戶一鍵將建議折扣發佈成優惠碼（重用已測試嘅 promo 兌換流程，唔改動金錢路徑）
 * 4) 推薦空置時段俾教練（通知教練會員）
 *
 * 設定存 platform_settings：venue.<venueId>.vacancy_auto
 */

const crypto = require("crypto");
const { getDb } = require("./database");

const DEFAULT_CFG = {
  enabled: false,
  fill_below: 0.5,   // 報名率低於此 = 空置
  within_days: 7,    // 只睇未來 N 日內
  min_discount: 0.1, // 最少減 10%
  max_discount: 0.3, // 最多減 30%
};

function _key(venueId) {
  return `venue.${venueId}.vacancy_auto`;
}

function _ensureSettings(db) {
  db.prepare(
    "CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT, description TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))",
  ).run();
}

function getVacancyConfig(venueId) {
  try {
    const db = getDb();
    _ensureSettings(db);
    const row = db.prepare("SELECT value FROM platform_settings WHERE key = ?").get(_key(venueId));
    if (row && row.value) return Object.assign({}, DEFAULT_CFG, JSON.parse(row.value));
  } catch (e) {
    /* ignore */
  }
  return Object.assign({}, DEFAULT_CFG);
}

function setVacancyConfig(venueId, cfg) {
  const db = getDb();
  _ensureSettings(db);
  const clamp = (n, lo, hi, d) => {
    n = Number(n);
    if (!isFinite(n)) n = d;
    return Math.min(Math.max(n, lo), hi);
  };
  const clean = {
    enabled: !!(cfg && cfg.enabled),
    fill_below: clamp(cfg && cfg.fill_below, 0.05, 1, DEFAULT_CFG.fill_below),
    within_days: Math.round(clamp(cfg && cfg.within_days, 1, 60, DEFAULT_CFG.within_days)),
    min_discount: clamp(cfg && cfg.min_discount, 0, 0.9, DEFAULT_CFG.min_discount),
    max_discount: clamp(cfg && cfg.max_discount, 0, 0.9, DEFAULT_CFG.max_discount),
  };
  if (clean.max_discount < clean.min_discount) clean.max_discount = clean.min_discount;
  const exists = db.prepare("SELECT key FROM platform_settings WHERE key = ?").get(_key(venueId));
  if (exists)
    db.prepare("UPDATE platform_settings SET value = ?, updated_at = datetime('now') WHERE key = ?").run(
      JSON.stringify(clean),
      _key(venueId),
    );
  else
    db.prepare("INSERT INTO platform_settings (key, value, description) VALUES (?, ?, ?)").run(
      _key(venueId),
      JSON.stringify(clean),
      "空置時段自動減價設定",
    );
  return clean;
}

/**
 * 依空置程度 + 距開課時間建議折扣（0-1）
 */
function suggestDiscount(fillRate, hoursUntil, cfg) {
  const c = Object.assign({}, DEFAULT_CFG, cfg || {});
  const emptiness = Math.min(Math.max(1 - (Number(fillRate) || 0), 0), 1);
  let pct = c.min_discount + (c.max_discount - c.min_discount) * emptiness;
  if (hoursUntil <= 48) pct += 0.05; // 臨近
  if (hoursUntil <= 12) pct += 0.05; // 非常近
  pct = Math.min(c.max_discount, Math.max(c.min_discount, pct));
  return Math.round(pct * 100) / 100;
}

/**
 * 列出空置時段
 * @param {object} opts { venueId, withinDays, fillBelow, limit }
 */
function listVacantSchedules(opts) {
  opts = opts || {};
  const db = getDb();
  const cfg = opts.venueId ? getVacancyConfig(opts.venueId) : Object.assign({}, DEFAULT_CFG);
  const withinDays = Math.round(Math.min(Math.max(Number(opts.withinDays) || cfg.within_days, 1), 60));
  const fillBelow = Number(opts.fillBelow) || cfg.fill_below;
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);

  let sql = `SELECT cs.id AS schedule_id, cs.class_id, cs.start_time, cs.end_time,
                    cs.enrolled_count, cs.max_participants, cs.status,
                    c.title, c.category, c.credits_cost, c.price_hkd, c.coach_id,
                    c.partner_id, c.partner_venue_id, c.venue_name
             FROM class_schedules cs
             JOIN classes c ON cs.class_id = c.id
             WHERE cs.status = 'available' AND c.status = 'active'
               AND datetime(cs.start_time) > datetime('now')
               AND datetime(cs.start_time) <= datetime('now', '+' || ? || ' days')`;
  const params = [withinDays];

  if (opts.venueId) {
    sql += " AND (c.partner_id = ? OR c.partner_venue_id = ? OR c.venue_name = ?)";
    params.push(opts.venueId, opts.venueId, opts.venueName || "\u0000");
  }
  sql += " ORDER BY cs.start_time ASC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  const now = Date.now();
  const out = [];
  for (const r of rows) {
    const cap = Number(r.max_participants) || 0;
    const enrolled = Number(r.enrolled_count) || 0;
    const fill = cap > 0 ? enrolled / cap : 0;
    if (fill >= fillBelow) continue;
    const start = new Date(r.start_time);
    const hoursUntil = (start.getTime() - now) / 3600000;
    if (isNaN(hoursUntil) || hoursUntil <= 0) continue;
    const d = suggestDiscount(fill, hoursUntil, cfg);
    const credits = Number(r.credits_cost) || 0;
    const price = Number(r.price_hkd) || 0;
    out.push({
      schedule_id: r.schedule_id,
      class_id: r.class_id,
      title: r.title,
      category: r.category,
      coach_id: r.coach_id,
      start_time: r.start_time,
      end_time: r.end_time,
      seats_left: Math.max(cap - enrolled, 0),
      max_participants: cap,
      enrolled_count: enrolled,
      fill_rate: Math.round(fill * 100),
      hours_until: Math.round(hoursUntil),
      discount_pct: Math.round(d * 100),
      original_credits: credits,
      discounted_credits: Math.max(1, Math.round(credits * (1 - d))),
      original_price: price,
      suggested_price: Math.round(price * (1 - d) * 100) / 100,
    });
  }

  const totals = {
    count: out.length,
    seats_left: out.reduce((a, x) => a + x.seats_left, 0),
    avg_discount: out.length ? Math.round(out.reduce((a, x) => a + x.discount_pct, 0) / out.length) : 0,
  };
  return { config: cfg, within_days: withinDays, fill_below: fillBelow, slots: out, totals };
}

/** 發佈空置時段自動優惠碼（重用 promo 兌換流程） */
function publishVacancyPromo(venueId, body) {
  body = body || {};
  const db = getDb();
  const classId = body.class_id;
  if (!classId) return { ok: false, error: "缺少課程" };

  const cls = db
    .prepare(
      "SELECT id, title, credits_cost, price_hkd, max_participants FROM classes WHERE id = ? AND (partner_id = ? OR partner_venue_id = ? OR venue_name = ?)",
    )
    .get(classId, venueId, venueId, body.venue_name || "\u0000");
  if (!cls) return { ok: false, error: "課程不存在或唔屬於你" };

  // 折扣：優先用手動指定，否則用最新空置時段建議值
  let discountPct = body.discount_pct != null ? Number(body.discount_pct) : null;
  const cfg = getVacancyConfig(venueId);
  let validTo = null;
  if (discountPct == null) {
    const v = listVacantSchedules({ venueId, venueName: body.venue_name, withinDays: cfg.within_days });
    const mine = v.slots.filter((s) => s.class_id === classId);
    if (!mine.length) return { ok: false, error: "此課程暫時冇空置時段" };
    discountPct = mine[0].discount_pct;
    validTo = mine[mine.length - 1].end_time;
  }
  discountPct = Math.min(Math.max(Number(discountPct) || 0, 5), 90);

  const seatLeft = Number(body.max_uses) || (function () {
    const v = listVacantSchedules({ venueId, venueName: body.venue_name, withinDays: cfg.within_days });
    const mine = v.slots.filter((s) => s.class_id === classId);
    return mine.reduce((a, s) => a + s.seats_left, 0) || cls.max_participants || 15;
  })();

  const days = Math.round(Math.min(Math.max(Number(body.valid_days) || cfg.within_days, 1), 60));
  const validFrom = new Date().toISOString();
  const code = ("V" + (body.prefix || "") + crypto.randomBytes(3).toString("hex")).toUpperCase().slice(0, 12);

  const promo = require("./promo");
  void promo; // 折扣計算沿用 promo 服務（percent 類型）
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO promo_codes (id, code, type, value, class_id, max_uses, used_count, per_user_limit, valid_from, valid_to, active, description)
     VALUES (?, ?, 'percent', ?, ?, ?, 0, ?, ?, ?, 1, ?)`,
  ).run(id, code, discountPct, classId, seatLeft, Number(body.per_user_limit) || 1, validFrom, validTo || new Date(Date.now() + days * 86400000).toISOString(), "空置時段自動優惠 (auto vacancy)");

  return {
    ok: true,
    promo: { id, code, type: "percent", value: discountPct, class_id: classId, max_uses: seatLeft, valid_to: validTo },
    message: `已為「${cls.title}」發佈 ${discountPct}% 空置優惠碼：${code}`,
  };
}

/** 推薦空置時段俾教練（通知場地教練會員） */
function recommendedCoaches(venueId) {
  const db = getDb();
  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT DISTINCT u.id, u.name, u.email
         FROM partner_members pm JOIN users u ON pm.user_id = u.id
         WHERE pm.partner_id = ? AND pm.status = 'active' AND pm.role = 'coach'`,
      )
      .all(venueId);
  } catch (e) {
    rows = [];
  }
  if (rows.length === 0) {
    // 冇教練會員 → 用商戶負責人作 fallback（至少通知到）
    try {
      rows = db
        .prepare("SELECT id, name, email FROM users WHERE (partner_id = ? OR id IN (SELECT user_id FROM partner_venues WHERE id = ?)) LIMIT 5")
        .all(venueId, venueId);
    } catch (e) {
      rows = [];
    }
  }
  return rows;
}

/** 列出已啟用空置減價嘅場地（供每日提示用） */
function listEnabledVenues() {
  const db = getDb();
  _ensureSettings(db);
  const rows = db.prepare("SELECT key, value FROM platform_settings WHERE key LIKE 'venue.%.vacancy_auto'").all();
  const out = [];
  for (const r of rows) {
    try {
      const cfg = JSON.parse(r.value);
      if (!cfg || !cfg.enabled) continue;
      const vid = r.key.slice("venue.".length, r.key.length - ".vacancy_auto".length);
      const v = db
        .prepare("SELECT id, name, owner_id, user_id, email FROM partner_venues WHERE id = ? AND status = 'active'")
        .get(vid);
      if (v) out.push({ venue: v, config: Object.assign({}, DEFAULT_CFG, cfg) });
    } catch (e) {
      /* skip */
    }
  }
  return out;
}

module.exports = {
  DEFAULT_CFG,
  getVacancyConfig,
  setVacancyConfig,
  suggestDiscount,
  listVacantSchedules,
  publishVacancyPromo,
  recommendedCoaches,
  listEnabledVenues,
};
