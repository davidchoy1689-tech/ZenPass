/**
 * ZenPass 禪流 — 訪客預約多維限流（Guest Booking Guard）
 * ---------------------------------------------------------------------------
 * 目的：POST /api/guest/book 係「免登入 + 會鎖名額」嘅高成本端點，
 *       單靠 IP 限流擋唔住「換 IP 刷同一電話」或「同 IP 換電話」。
 *
 * 三維鑰匙（任何一維超標即 429，fail-closed）：
 *   1) IP        → 5 / 10 分鐘、15 / 小時
 *   2) 電話       → 3 / 小時、5 / 日
 *   3) 時段組合   → 3 / 10 分鐘（同一班次連環重試）
 *
 * 回應契約（同前端 UI 對齊）：
 *   429 { error:"rate_limited", message, retry_after_sec, code:"GUEST_BOOKING_RATE_LIMIT" }
 *   標頭 Retry-After: <秒>
 *
 * 儲存：進程內 Map（單一 pm2 instance 足夠）。重啟會清零，屬可接受取捨；
 *       若日後多實例，換 Redis 只需改 store 兩條函數。
 *
 * 2026-11-14 · T1 / P0-3
 */

const WINDOWS = {
  ipShort: { limit: 5, sec: 10 * 60 },
  ipLong: { limit: 15, sec: 60 * 60 },
  phoneHour: { limit: 3, sec: 60 * 60 },
  phoneDay: { limit: 5, sec: 24 * 60 * 60 },
  sessionShort: { limit: 3, sec: 10 * 60 },
};

const store = new Map(); // key -> { count, resetAt }

function prune(now) {
  if (store.size < 500) return;
  for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
}

/**
 * 消耗一次配額。回傳 { ok, retryAfterSec }。
 * 只喺「通過」時才計數，避免被拒請求無限延長封鎖。
 */
function hit(key, limit, windowSec) {
  const now = Date.now();
  prune(now);
  const rec = store.get(key);
  if (!rec || rec.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { ok: true, retryAfterSec: 0 };
  }
  if (rec.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((rec.resetAt - now) / 1000)) };
  }
  rec.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

function normPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  return d.length > 8 ? d.slice(-8) : d;
}

function clientIp(req) {
  const fwd = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
}

function sessionKeyOf(body) {
  const classId = String(body.classId || body.class_id || "");
  const ids = (Array.isArray(body.scheduleIds) ? body.scheduleIds : [body.scheduleId])
    .filter(Boolean)
    .map(String)
    .sort()
    .join(",");
  return classId + "|" + ids;
}

function guard(req, res, next) {
  if (String(process.env.GUEST_GUARD_DISABLED || "") === "1") return next();
  const body = req.body || {};
  const ip = clientIp(req);
  const phone = normPhone(body.phone);
  const sess = sessionKeyOf(body);

  const checks = [
    ["ip", "guest_create:ip:" + ip, WINDOWS.ipShort, "同一個網絡提交太頻繁"],
    ["ip", "guest_create:ip1h:" + ip, WINDOWS.ipLong, "同一個網絡今日提交次數過多"],
  ];
  if (phone) {
    checks.push(["phone", "guest_create:phone:" + phone, WINDOWS.phoneHour, "此電話號碼提交次數過多"]);
    checks.push(["phone", "guest_create:phone24:" + phone, WINDOWS.phoneDay, "此電話號碼今日提交次數過多"]);
  }
  if (sess.trim() !== "|") {
    checks.push(["session", "guest_create:sess:" + sess, WINDOWS.sessionShort, "此班次提交太頻繁"]);
  }

  let block = null;
  const passed = [];
  for (const [dim, key, rule, msg] of checks) {
    const r = hit(key, rule.limit, rule.sec);
    if (!r.ok) { block = { r, msg, dim }; break; }
    passed.push(key);
  }

  if (block) {
    // 回滾已消耗嘅配額，唔好因為一次被拒而連累其他維度
    for (const key of passed) {
      const rec = store.get(key);
      if (rec && rec.count > 0) rec.count -= 1;
    }
    const r = block.r;
    res.set("Retry-After", String(r.retryAfterSec));
    return res.status(429).json({
      success: false,
      error: "rate_limited",
      message: block.msg + "，請 " + r.retryAfterSec + " 秒後再試",
      retry_after_sec: r.retryAfterSec,
      code: "GUEST_BOOKING_RATE_LIMIT",
    });
  }

  next();
}

function _resetAll() { store.clear(); }
function _stats() { return store.size; }

module.exports = { guard, _resetAll, _stats, WINDOWS, normPhone, sessionKeyOf };
