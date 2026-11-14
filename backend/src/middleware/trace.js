/**
 * trace.js — 輕量分散式追蹤（W3C Trace Context 相容，零外部依賴）
 * ---------------------------------------------------------------------------
 * 目的：客人話「我撳咗兩次、係咪收咗兩次錢？」時，可以一條 trace_id 追到
 *       前端 → nginx → API → DB → Stripe 嘅同一次請求。
 *
 * 做法（唔上 OpenTelemetry SDK，先做 baseline）：
 *   1. 讀入站 traceparent（00-<trace_id>-<span_id>-<flags>）；冇就生成
 *   2. 回應帶 X-Request-ID / X-Trace-Id / traceparent，方便前端／客服引用
 *   3. 每個請求完成寫一行結構化 JSON：trace_id、route、status、duration_ms、
 *      idempotency_key、user_id、phone_hash（永不寫原始電話／姓名／卡號）
 *
 * 之後要接 OTel：只需把 emit() 換成 OTLP exporter，route 層唔需要改。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// 獨立寫入 logs/trace.log（唔依賴 winston 設定；log 被靜音都仲有 trace）
let traceStream = null;
function getTraceStream() {
  if (traceStream) return traceStream;
  try {
    const dir = path.join(__dirname, "..", "..", "logs");
    fs.mkdirSync(dir, { recursive: true });
    traceStream = fs.createWriteStream(path.join(dir, "trace.log"), { flags: "a" });
    traceStream.on("error", () => { traceStream = null; });
  } catch (e) {
    traceStream = null;
  }
  return traceStream;
}

const PHONE_SALT = process.env.TRACE_PHONE_SALT || process.env.JWT_SECRET || "zenpass-trace";
const HEX32 = /^[0-9a-f]{32}$/i;
const HEX16 = /^[0-9a-f]{16}$/i;

function hex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

/** 電話只留 hash 前 16 位（可對比、不可逆） */
function hashPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  return crypto.createHash("sha256").update(d + PHONE_SALT).digest("hex").slice(0, 16);
}

function parseTraceparent(v) {
  const s = String(v || "").trim();
  const m = s.match(/^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
  if (!m) return null;
  if (!HEX32.test(m[2]) || !HEX16.test(m[3])) return null;
  if (m[2] === "0".repeat(32)) return null;
  return { version: m[1], traceId: m[2].toLowerCase(), parentSpanId: m[3].toLowerCase(), flags: m[4] };
}

/** 去掉 query 內敏感值（電話等），只保留 key 名 */
function safeUrl(req) {
  const base = (req.baseUrl || "") + (req.path || "");
  const q = req.query || {};
  const keys = Object.keys(q);
  if (!keys.length) return base;
  return base + "?" + keys.map((k) => k + "=*").join("&");
}

function traceMiddleware(logger) {
  return function (req, res, next) {
    const incoming = parseTraceparent(req.headers.traceparent);
    const traceId = incoming ? incoming.traceId : hex(16);
    const spanId = hex(8);

    req.traceId = traceId;
    req.spanId = spanId;
    req.requestId = req.requestId || crypto.randomUUID();

    res.setHeader("X-Request-ID", req.requestId);
    res.setHeader("X-Trace-Id", traceId);
    res.setHeader("traceparent", `00-${traceId}-${spanId}-01`);

    const t0 = process.hrtime.bigint();

    res.on("finish", () => {
      try {
        const durMs = Number(process.hrtime.bigint() - t0) / 1e6;
        const attrs = res.locals && res.locals.traceAttrs ? res.locals.traceAttrs : {};
        const line = {
          type: "http_trace",
          trace_id: traceId,
          span_id: spanId,
          parent_span_id: incoming ? incoming.parentSpanId : undefined,
          request_id: req.requestId,
          method: req.method,
          route: safeUrl(req),
          status: res.statusCode,
          duration_ms: Math.round(durMs * 10) / 10,
          idempotency_key: req.headers["idempotency-key"] ? String(req.headers["idempotency-key"]).slice(0, 64) : undefined,
          user_id: req.user && req.user.id ? req.user.id : undefined,
          cf_ray: req.headers["cf-ray"] || undefined,
          ...attrs,
        };
        const st = getTraceStream();
        if (st) st.write(JSON.stringify(line) + "\n");
        if (logger) { try { logger.info("http_trace", line); } catch (e2) {} }
      } catch (e) { console.error("TRACE_ERR", e && e.message); }
    });

    next();
  };
}

/**
 * 由 route 補充業務屬性（例如 booking_ids、seat_count、rate_limited）
 * 只放非 PII 欄位。
 */
function annotate(res, attrs) {
  if (!res || !res.locals) return;
  res.locals.traceAttrs = Object.assign(res.locals.traceAttrs || {}, attrs || {});
}

module.exports = { traceMiddleware, annotate, hashPhone, parseTraceparent };
