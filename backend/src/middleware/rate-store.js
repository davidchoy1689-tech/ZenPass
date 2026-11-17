/**
 * ZenPass — 共享 Rate Limit Store（2026-11-17）
 *
 * 目的：把「進程內記憶體」限流升級成「多進程／多機共享」限流。
 *
 * 設計
 *  - 有 REDIS_URL 且安裝 ioredis → 用 Redis sliding window（sorted set），
 *    PM2 多實例／日後多機都共用同一份計數。
 *  - 冇 Redis（或 Redis 出錯）→ 自動回落記憶體 sliding window，功能不變。
 *  - 所有 API 都是 async；middleware 用 `await hit(...)`。
 *
 * 不變的紅線：限流只影響流量，不寫任何金錢紀錄。
 */
const memoryBuckets = new Map(); // key -> number[]（timestamps，升序）

const MEM_CLEAN_LIMIT = 5000;
let lastMemClean = 0;

function memBump(key, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  let arr = memoryBuckets.get(key);
  if (!arr) {
    arr = [];
    memoryBuckets.set(key, arr);
  }
  while (arr.length && arr[0] <= cutoff) arr.shift();
  arr.push(now);
  // 偶爾清理死 key，避免長期累積
  if (now - lastMemClean > 60_000 || memoryBuckets.size > MEM_CLEAN_LIMIT) {
    lastMemClean = now;
    for (const [k, v] of memoryBuckets) {
      if (!v.length || v[v.length - 1] <= cutoff) memoryBuckets.delete(k);
    }
  }
  return { count: arr.length, reset_at: arr[0] + windowMs, backend: "memory" };
}

// ===== Redis（可選依賴；冇裝／冇設定就唔會用到）=====
let redisClient = null;
let redisBroken = false;
let redisWarned = false;

function getRedis() {
  if (redisBroken) return null;
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  let Redis;
  try {
    Redis = require("ioredis");
  } catch (e) {
    redisBroken = true;
    if (!redisWarned) {
      console.warn("[RATE] REDIS_URL 已設定但未安裝 ioredis，回落記憶體限流");
      redisWarned = true;
    }
    return null;
  }
  try {
    redisClient = new Redis(url, {
      connectTimeout: 1500,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    redisClient.on("error", (err) => {
      if (!redisWarned) {
        console.warn("[RATE] Redis 連線異常，暫時回落記憶體限流：", err.message);
        redisWarned = true;
      }
    });
    redisClient.on("ready", () => {
      redisWarned = false;
      console.log("[RATE] Redis rate-limit store ready");
    });
  } catch (e) {
    redisBroken = true;
    redisClient = null;
    return null;
  }
  return redisClient;
}

async function redisBump(key, windowMs) {
  const r = getRedis();
  if (!r) return null;
  const now = Date.now();
  const k = "rl:" + key;
  const member = now + ":" + Math.random().toString(36).slice(2, 8);
  try {
    const res = await r
      .multi()
      .zremrangebyscore(k, 0, now - windowMs)
      .zadd(k, now, member)
      .zcard(k)
      .pexpire(k, windowMs + 2000)
      .exec();
    const count = Number(res && res[2] && res[2][1]);
    if (!Number.isFinite(count)) return null;
    return { count, reset_at: now + windowMs, backend: "redis" };
  } catch (e) {
    return null; // 任何 Redis 問題 → 回落記憶體
  }
}

/** 計一次數（唔判斷有冇超限） */
async function bump(key, windowMs) {
  const fromRedis = await redisBump(key, windowMs);
  if (fromRedis) return fromRedis;
  return memBump(key, windowMs);
}

/** 計數 + 判斷是否超限 */
async function hit(key, windowMs, limit) {
  const out = await bump(key, windowMs);
  return {
    limited: out.count > limit,
    count: out.count,
    max: limit,
    reset_at: out.reset_at,
    backend: out.backend,
  };
}

/**
 * express-rate-limit v7 兼容 Store（只有 Redis 可用時才啟用，
 * 否則回傳 null 讓 express-rate-limit 用預設 MemoryStore）
 */
function createExpressStore(prefix) {
  if (!process.env.REDIS_URL) return null;
  if (!getRedis()) return null;
  return {
    localKeys: false,
    prefix: prefix || "xrl",
    init(options) {
      this.windowMs = options.windowMs;
    },
    async increment(key) {
      const out = await bump(`${this.prefix}:${key}`, this.windowMs);
      return { totalHits: out.count, resetTime: new Date(out.reset_at) };
    },
    async decrement() {
      /* sliding window：唔支援精準扣減，唔影響正確性（只會保守少少） */
    },
    async resetKey(key) {
      const r = getRedis();
      if (r) {
        try {
          await r.del("rl:" + prefix + ":" + key);
        } catch (e) {}
      }
      memoryBuckets.delete(`${prefix}:${key}`);
    },
  };
}

/** 診斷用：現時用緊邊個 backend */
function backendType() {
  if (process.env.REDIS_URL && getRedis()) return "redis";
  if (process.env.REDIS_URL) return "memory(redis-unavailable)";
  return "memory";
}

function _resetMemory() {
  memoryBuckets.clear();
}

module.exports = { hit, bump, createExpressStore, backendType, _resetMemory };
