/**
 * event-log.js — 業務事件日誌（AsyncLocalStorage + 自動 correlation）
 * ---------------------------------------------------------------------------
 * 設計目標：
 *   - 每個請求一條 context（request_id / trace_id / route / ip / user_id）
 *   - event.* 自動 merge context，業務碼唔使手傳
 *   - webhook / cron 冇 HTTP middleware 時，用 run(ctx, fn) 開新 context
 *   - 內建 redact() 做最後防線（入口仍須先 hash 電話）
 *
 * 輸出：backend/logs/events.log（JSONL，logrotate 管）
 * 為什麼唔用 winston：console transport 會吞 `logger.info(msg, meta)`，實測冇 output。
 *
 * Level 紀律：
 *   info  = 業務里程碑（booking_created / idem_hit）
 *   warn  = 429、重試、idem_mismatch
 *   error = 5xx、付款異常
 * booking 寫入 / 429 / 付款 一律 100% 記錄，唔抽樣。
 */

const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");

const als = new AsyncLocalStorage();
let stream = null;

const SERVICE = process.env.SERVICE_NAME || "zenpass-api";
const LEVEL_NUM = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = process.env.LOG_LEVEL || "info";

function shouldLog(level) {
  return (LEVEL_NUM[level] || 20) >= (LEVEL_NUM[MIN_LEVEL] || 20);
}

function getStream() {
  if (stream) return stream;
  try {
    const dir = path.join(__dirname, "..", "..", "logs");
    fs.mkdirSync(dir, { recursive: true });
    stream = fs.createWriteStream(path.join(dir, "events.log"), { flags: "a" });
    stream.on("error", () => { stream = null; });
  } catch (e) {
    stream = null;
  }
  return stream;
}

/**
 * 最後防線：欄位名似密碼／個資 → 遮蔽。
 * 例外：*_hash / *hash 保留（hash 本身唔係 PII）。
 */
const SENSITIVE = /(password|token|authorization|cookie|secret|card_number|phone|email|name)/i;
function redact(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/_?hash$/i.test(k) || /_ids?$/i.test(k) || k === "booking_ids") {
      out[k] = v;
    } else if (SENSITIVE.test(k)) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !(v instanceof Error)) {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function baseFields() {
  const c = als.getStore() || {};
  return {
    ts: new Date().toISOString(),
    service: SERVICE,
    request_id: c.request_id,
    trace_id: c.trace_id,
    span_id: c.span_id,
    cf_ray: c.cf_ray,
    user_id: c.user_id,
    route: c.route,
    ip: c.ip,
  };
}

function emit(level, msg, fields) {
  if (!shouldLog(level)) return;
  try {
    const line = Object.assign(baseFields(), { level, msg }, redact(fields || {}));
    for (const k of Object.keys(line)) if (line[k] === undefined) delete line[k];
    const st = getStream();
    if (st) st.write(JSON.stringify(line) + "\n");
  } catch (e) {
    /* 日誌失敗唔可以影響業務 */
  }
}

/** Express 用：包住 next()，之後所有 event 自動有 context */
function middleware(req, res, next) {
  const ctx = {
    request_id: req.requestId,
    trace_id: req.traceId,
    route: (req.baseUrl || "") + (req.path || ""),
    ip: req.ip,
    user_id: req.user && req.user.id,
    cf_ray: typeof req.headers["cf-ray"] === "string" ? req.headers["cf-ray"] : undefined,
  };
  als.run(ctx, () => next());
}

/** webhook / cron / 背景工作：自己開 context */
function run(ctx, fn) {
  return als.run(Object.assign({}, ctx || {}), fn);
}

/** 補充／更新目前 context（例如 booking 建立後加 booking_id） */
function assign(fields) {
  const s = als.getStore();
  if (s && fields) Object.assign(s, fields);
}

function getContext() {
  return Object.assign({}, als.getStore() || {});
}

/**
 * 區段計時：startTimer("stripe") 回傳 stop()，結果寫入 context.timings
 * 之後 trace.log 會出現 stripe_ms / booking_write_ms 等欄位（零依賴）。
 */
function startTimer(name) {
  const t0 = process.hrtime.bigint();
  return function stop() {
    try {
      const st = als.getStore();
      if (!st) return;
      st.timings = st.timings || {};
      st.timings[name + "_ms"] = Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100;
    } catch (e) {}
  };
}

module.exports = {
  middleware,
  run,
  assign,
  set: assign,
  getContext,
  startTimer,
  info: (msg, f) => emit("info", msg, f),
  warn: (msg, f) => emit("warn", msg, f),
  error: (msg, f) => emit("error", msg, f),
  debug: (msg, f) => emit("debug", msg, f),
  _als: als,
  _redact: redact,
};
