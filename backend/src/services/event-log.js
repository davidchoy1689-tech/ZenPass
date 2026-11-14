/**
 * event-log.js — 業務事件日誌（結構化 JSON + 自動 correlation id）
 * ---------------------------------------------------------------------------
 * 為什麼要另一個 logger：
 *   trace.js 只記錄「一個 HTTP 請求」的頭尾；查單時真正要知的是
 *   「呢單 booking 中間發生咩事」—— idempotency 重放、限流、鎖位、付款。
 *   呢啲事件散落不同 route，必須自動帶 request_id / trace_id，唔靠人手傳。
 *
 * 做法：AsyncLocalStorage 保存每個請求 context，event() 自動 merge。
 * 輸出：backend/logs/events.log（JSONL，獨立寫入，唔受 winston 設定影響）
 *
 * Level 紀律：
 *   info  = 業務里程碑（booking_created / idem_hit / seat_held）
 *   warn  = 429、重試、idem mismatch
 *   error = 5xx、付款異常
 * 高流量 GET 可唔記；booking 寫入 / 429 / 付款永遠 100% 記錄。
 */

const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");

const als = new AsyncLocalStorage();
let stream = null;

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

/** 請求層用：包住 next()，之後所有 event() 都自動有 context */
function middleware(req, res, next) {
  const store = {
    request_id: req.requestId,
    trace_id: req.traceId,
    route: (req.baseUrl || "") + (req.path || ""),
    ip: req.ip,
  };
  als.run(store, () => next());
}

/** 補充 context（例如 booking 建立後加 booking_id） */
function set(key, value) {
  const s = als.getStore();
  if (s) s[key] = value;
}

function emit(level, msg, fields) {
  try {
    const line = Object.assign(
      { ts: new Date().toISOString(), level, msg },
      als.getStore() || {},
      fields || {},
    );
    const st = getStream();
    if (st) st.write(JSON.stringify(line) + "\n");
  } catch (e) {
    /* 日誌失敗唔可以影響業務 */
  }
}

module.exports = {
  middleware,
  set,
  info: (msg, f) => emit("info", msg, f),
  warn: (msg, f) => emit("warn", msg, f),
  error: (msg, f) => emit("error", msg, f),
  _als: als,
};
