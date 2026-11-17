#!/usr/bin/env node
/**
 * test-rate-store.js — 共享限流 store（2026-11-17）
 *
 * 覆蓋：
 *  1) 冇 REDIS_URL → 記憶體 backend，計數／超限正確
 *  2) window 過去後重新計數
 *  3) backendType() 回報 memory
 *  4) createExpressStore() 冇 Redis 時回 null（express-rate-limit 用預設 MemoryStore）
 *  5) 不影響正常請求：limit 內唔會 limited
 */
process.env.REDIS_URL = "";
let pass = 0,
  bad = 0;
const ok = (c, m, x) =>
  c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)));

const store = require("../src/middleware/rate-store");
store._resetMemory();

(async () => {
  console.log("\n[1] 記憶體 backend");
  ok(store.backendType() === "memory", "backendType() = memory");
  const a = await store.hit("k1", 1000, 3);
  ok(a.limited === false && a.count === 1 && a.backend === "memory", "第 1 次：count=1 未限", a);
  await store.hit("k1", 1000, 3);
  const c = await store.hit("k1", 1000, 3);
  ok(c.limited === false && c.count === 3, "第 3 次：count=3 剛好未超", c);
  const d = await store.hit("k1", 1000, 3);
  ok(d.limited === true && d.count === 4, "第 4 次：超限 limited=true", d);

  console.log("\n[2] 不同 key 互不影響");
  const e = await store.hit("k2", 1000, 3);
  ok(e.limited === false && e.count === 1, "k2 獨立計數", e);

  console.log("\n[3] window 過期後重置");
  await new Promise((r) => setTimeout(r, 1100));
  const f = await store.hit("k1", 1000, 3);
  ok(f.limited === false && f.count === 1, "1.1 秒後重新由 1 開始", f);

  console.log("\n[4] express-rate-limit store");
  ok(store.createExpressStore("auth") === null, "冇 REDIS_URL → 回 null（用預設 MemoryStore）");

  console.log("\n[5] 高併發計數唔會走數");
  store._resetMemory();
  await Promise.all(Array.from({ length: 20 }, () => store.hit("burst", 5000, 100)));
  const g = await store.hit("burst", 5000, 100);
  ok(g.count === 21, "20 個並發 + 1 = 21", g);

  console.log(`\n${bad ? "❌" : "✅"} rate-store 測試：${pass} 通過，${bad} 失敗`);
  process.exit(bad ? 1 : 0);
})();
