/**
 * ZenPass — 設定服務（2026-11-17）
 *
 * 單一讀寫入口，供 route 及業務 code 使用：
 *   const settings = require("../services/settings-service");
 *   settings.num(db, "booking_hold_minutes", 10)
 *   settings.bool(db, "security.bot_detection", true)
 *
 * 特性：
 *  - 值存 platform_settings（key/value 文字），冇值時用 registry default
 *  - 支援其他資料源（registry item.store）：
 *      pricing_config → 會籍定價（同後台「定價」頁共用）
 *      promo_codes    → 優惠碼欄位（code + field）
 *  - 進程內 5 秒 cache（寫入即失效；另一進程最多 5 秒後跟到）
 *  - 寫入前用 registry 做型別／範圍驗證；非法值直接拒絕（唔會寫壞 DB）
 *  - 每次改動寫 audit_log（settings.update），記錄 from → to
 */
const crypto = require("crypto");
const { ITEMS, BY_KEY, getItem, itemsByGroup, GROUPS } = require("../config/settings-registry");

const CACHE_TTL_MS = 5000;
let cache = { platform: null, pricing: null, promo: null, at: 0 };

function clearCache() {
  cache = { platform: null, pricing: null, promo: null, at: 0 };
}

function cacheFresh() {
  return cache.at && Date.now() - cache.at < CACHE_TTL_MS;
}

function loadPlatform(db) {
  const now = Date.now();
  if (cache.platform && cacheFresh()) return cache.platform;
  const map = new Map();
  try {
    const rows = db.prepare("SELECT key, value FROM platform_settings").all();
    rows.forEach((r) => map.set(r.key, r.value));
  } catch (e) {
    /* table 可能未建 */
  }
  cache.platform = map;
  cache.at = now;
  return map;
}

function loadPricing(db) {
  const now = Date.now();
  if (cache.pricing && cacheFresh()) return cache.pricing;
  const map = new Map();
  try {
    const rows = db.prepare("SELECT key, value FROM pricing_config").all();
    rows.forEach((r) => map.set(r.key, r.value));
  } catch (e) {
    /* table 可能未建 */
  }
  cache.pricing = map;
  cache.at = now;
  return map;
}

function loadPromo(db) {
  const now = Date.now();
  if (cache.promo && cacheFresh()) return cache.promo;
  const map = new Map();
  try {
    const rows = db.prepare("SELECT code, value, min_participants, active FROM promo_codes").all();
    rows.forEach((r) => map.set(String(r.code || "").toUpperCase(), r));
  } catch (e) {
    /* table 可能未建 */
  }
  cache.promo = map;
  cache.at = now;
  return map;
}

function storeOf(item) {
  return (item && item.store) || "platform";
}

/** 讀取原始值（未轉型） */
function rawOf(db, item) {
  const store = storeOf(item);
  if (store === "pricing_config") {
    const v = loadPricing(db).get(item.key);
    return v === undefined ? null : v;
  }
  if (store === "promo_codes") {
    const row = loadPromo(db).get(String(item.code || "").toUpperCase());
    if (!row) return null;
    const f = item.field || "value";
    return row[f] === undefined ? null : row[f];
  }
  const v = loadPlatform(db).get(item.key);
  return v === undefined ? null : v;
}

function parseValue(item, raw) {
  if (raw === undefined || raw === null || raw === "") return item.default;
  switch (item.type) {
    case "int":
      return Math.round(Number(raw));
    case "float":
    case "percent":
      return Number(raw);
    case "bool":
      return raw === true || raw === 1 || raw === "1" || raw === "true" || raw === "yes" || raw === "on";
    default:
      return String(raw);
  }
}

/** 讀取（已轉型） */
function get(db, key) {
  const item = getItem(key);
  if (!item) return undefined;
  return parseValue(item, rawOf(db, item));
}

function num(db, key, fallback) {
  const v = get(db, key);
  return Number.isFinite(Number(v)) ? Number(v) : fallback;
}

function bool(db, key, fallback) {
  const v = get(db, key);
  return typeof v === "boolean" ? v : fallback;
}

function str(db, key, fallback) {
  const v = get(db, key);
  return typeof v === "string" && v !== "" ? v : fallback;
}

/** 驗證並轉成 DB 儲存字串 */
function validate(item, raw) {
  const fail = (msg) => ({ ok: false, error: msg });
  if (item.type === "bool") {
    if (typeof raw === "boolean") return { ok: true, value: raw ? "1" : "0" };
    if (["0", "1", "true", "false", "yes", "no", "on", "off"].includes(String(raw).toLowerCase())) {
      return { ok: true, value: parseValue(item, raw) ? "1" : "0" };
    }
    return fail("必須係開／關");
  }
  if (item.type === "int") {
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return fail("必須係整數");
    if (item.min != null && n < item.min) return fail(`不可小於 ${item.min}`);
    if (item.max != null && n > item.max) return fail(`不可大於 ${item.max}`);
    return { ok: true, value: String(n) };
  }
  if (item.type === "float" || item.type === "percent") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fail("必須係數字");
    if (item.min != null && n < item.min) return fail(`不可小於 ${item.min}`);
    if (item.max != null && n > item.max) return fail(`不可大於 ${item.max}`);
    return { ok: true, value: String(n) };
  }
  if (item.type === "enum") {
    const s = String(raw);
    if (!(item.options || []).includes(s)) return fail(`只可以係：${(item.options || []).join(" / ")}`);
    return { ok: true, value: s };
  }
  if (item.type === "list") {
    const s = String(raw)
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
      .join(",");
    if (item.maxLen && s.length > item.maxLen) return fail("長度超出上限");
    return { ok: true, value: s };
  }
  // string
  const s = String(raw).trim();
  if (item.maxLen && s.length > item.maxLen) return fail(`不可超過 ${item.maxLen} 字`);
  return { ok: true, value: s };
}

function writeAudit(db, { key, from, to, actorId }) {
  try {
    db.prepare(
      `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, old_values, new_values, description, created_at)
       VALUES (?,?,?,?,?,?,?,?,datetime('now'))`,
    ).run(
      crypto.randomUUID(),
      "settings.update",
      "platform_settings",
      key,
      actorId || null,
      JSON.stringify({ value: from == null ? null : from }),
      JSON.stringify({ value: to }),
      `更新系統參數 ${key}：${from == null ? "(預設)" : from} → ${to}`,
    );
  } catch (e) {
    console.error("[SETTINGS] audit failed:", e.message);
  }
}

/** 批量更新（全部先驗證，任何一個錯就全部唔寫） */
function setMany(db, updates, { actorId } = {}) {
  const entries = Object.entries(updates || {});
  if (!entries.length) {
    const e = new Error("沒有需要更新的參數");
    e.status = 400;
    e.code = "NO_UPDATES";
    throw e;
  }
  const prepared = [];
  const errors = [];
  for (const [key, raw] of entries) {
    const item = getItem(key);
    if (!item) {
      errors.push({ key, error: "未註冊的參數" });
      continue;
    }
    const v = validate(item, raw);
    if (!v.ok) {
      errors.push({ key, error: v.error });
      continue;
    }
    prepared.push({ item, key, value: v.value });
  }
  if (errors.length) {
    const e = new Error("參數驗證失敗");
    e.status = 400;
    e.code = "INVALID_SETTING";
    e.details = errors;
    throw e;
  }

  const changes = [];
  const run = db.transaction(() => {
    for (const p of prepared) {
      const store = storeOf(p.item);
      const prevRaw = rawOf(db, p.item);
      const typedNow = parseValue(p.item, p.value);
      const isBackToDefault = String(typedNow) === String(p.item.default);
      if (String(prevRaw == null ? p.item.default : parseValue(p.item, prevRaw)) === String(typedNow)) continue;

      if (store === "pricing_config") {
        db.prepare(
          `INSERT INTO pricing_config (key, value, label, category, updated_at)
           VALUES (?, ?, ?, 'membership', datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        ).run(p.item.key, String(typedNow), p.item.label || p.item.key);
      } else if (store === "promo_codes") {
        const code = String(p.item.code || "").toUpperCase();
        const field = p.item.field || "value";
        if (!["value", "min_participants", "active"].includes(field)) {
          throw Object.assign(new Error("不支援的優惠碼欄位：" + field), { status: 400, code: "INVALID_SETTING" });
        }
        const exists = db.prepare("SELECT id FROM promo_codes WHERE code = ?").get(code);
        if (exists) {
          db.prepare(`UPDATE promo_codes SET ${field} = ? WHERE code = ?`).run(Number(typedNow), code);
        } else {
          db.prepare(
            `INSERT INTO promo_codes (id, code, type, value, min_participants, per_user_limit, active, description, created_at)
             VALUES (?, ?, 'fixed_discount', ?, ?, 1, 1, ?, datetime('now'))`,
          ).run(
            crypto.randomUUID(),
            code,
            field === "value" ? Number(typedNow) : 40,
            field === "min_participants" ? Number(typedNow) : 2,
            "由後台系統參數建立",
          );
        }
      } else {
        const exists = db.prepare("SELECT key FROM platform_settings WHERE key = ?").get(p.key);
        if (exists && isBackToDefault) {
          // 改返預設值 → 直接刪除 override，令設定保持「預設」狀態
          db.prepare("DELETE FROM platform_settings WHERE key = ?").run(p.key);
        } else if (exists) {
          db.prepare("UPDATE platform_settings SET value = ?, updated_at = datetime('now') WHERE key = ?").run(
            p.value,
            p.key,
          );
        } else {
          db.prepare(
            "INSERT INTO platform_settings (key, value, description) VALUES (?, ?, ?)",
          ).run(p.key, p.value, p.item.desc || "");
        }
      }
      writeAudit(db, {
        key: p.key,
        from: prevRaw == null ? p.item.default : parseValue(p.item, prevRaw),
        to: typedNow,
        actorId,
      });
      changes.push({ key: p.key, from: prevRaw, to: store === "platform" ? p.value : typedNow });
    }
  });
  run();
  clearCache();
  return { changes, values: getAll(db) };
}

/** 還原預設（刪除 DB override，回落 registry default） */
function resetToDefaults(db, keys, { actorId } = {}) {
  const list = (keys || []).filter((k) => getItem(k));
  if (!list.length) {
    const e = new Error("沒有指定可還原的參數");
    e.status = 400;
    e.code = "NO_KEYS";
    throw e;
  }
  const run = db.transaction(() => {
    for (const key of list) {
      const item = getItem(key);
      const store = storeOf(item);
      const prevRaw = rawOf(db, item);
      if (prevRaw == null) continue;
      if (store === "pricing_config") {
        // 保留 pricing_config 列（後台「定價」頁靠佢顯示），只寫返預設值
        db.prepare("UPDATE pricing_config SET value = ?, updated_at = datetime('now') WHERE key = ?").run(
          String(item.default),
          item.key,
        );
      } else if (store === "promo_codes") {
        const code = String(item.code || "").toUpperCase();
        const field = item.field || "value";
        if (["value", "min_participants", "active"].includes(field)) {
          db.prepare(`UPDATE promo_codes SET ${field} = ? WHERE code = ?`).run(Number(item.default), code);
        }
      } else {
        db.prepare("DELETE FROM platform_settings WHERE key = ?").run(key);
      }
      writeAudit(db, {
        key,
        from: parseValue(item, prevRaw),
        to: parseValue(item, null),
        actorId,
      });
    }
  });
  run();
  clearCache();
  return { values: getAll(db) };
}

/** 現時有效值（含預設） */
function getAll(db) {
  const out = {};
  for (const item of ITEMS) {
    out[item.key] = parseValue(item, rawOf(db, item));
  }
  return out;
}

/** 後台顯示用：分組 + 每個參數的 value/default/is_default/updated_at */
function describe(db) {
  let meta = new Map();
  try {
    meta = new Map(
      db
        .prepare("SELECT key, updated_at FROM platform_settings")
        .all()
        .map((r) => [r.key, r.updated_at]),
    );
  } catch (e) {}
  const groups = itemsByGroup().map((g) => ({
    ...g,
    items: g.items.map((it) => {
      const raw = rawOf(db, it);
      const typed = parseValue(it, raw);
      const isDefault = raw == null || String(typed) === String(it.default);
      return {
        key: it.key,
        label: it.label,
        type: it.type,
        default: it.default,
        min: it.min ?? null,
        max: it.max ?? null,
        options: it.options || null,
        unit: it.unit || "",
        desc: it.desc || "",
        access: it.access || "ops",
        restart: !!it.restart,
        wired: !!it.wired,
        multiline: !!it.multiline,
        value: typed,
        raw,
        is_default: isDefault,
        updated_at: meta.get(it.key) || null,
      };
    }),
  }));
  return { groups, group_count: GROUPS.length, item_count: ITEMS.length };
}

module.exports = {
  get,
  num,
  bool,
  str,
  getAll,
  describe,
  setMany,
  resetToDefaults,
  validate,
  clearCache,
  getItem,
  BY_KEY,
};
