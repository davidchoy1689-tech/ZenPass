/**
 * ZenPass — 教練離線簽到佇列 tests
 * node backend/tests/test-offline-checkin.js
 */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log("  ✅ " + m); pass++; } else { console.log("  ❌ " + m); fail++; } };

function memStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

(async () => {
  console.log("\n🧪 離線簽到佇列\n");

  const assetUrl = pathToFileURL(path.join(__dirname, "../../frontend-v2/assets/offline-queue.js")).href;
  await import(assetUrl);
  const { createQueue, KEY } = globalThis.ZPOfflineQueue || {};
  ok(typeof createQueue === "function", "佇列模組載入（window.ZPOfflineQueue）");
  ok(KEY === "zenpass_offline_checkins", "localStorage key 正確");

  const storage = memStorage();
  const q = createQueue(storage);

  console.log("📋 1. 入隊／去重／持久化");
  q.add({ booking_id: "b1", schedule_id: "s1", name: "陳大文" });
  q.add({ booking_id: "b1", schedule_id: "s1", name: "陳大文" });
  q.add({ booking_id: "b2", schedule_id: "s1", name: "李小明" });
  ok(q.read().length === 2, "重複 booking 唔會重複入隊（2 筆）");
  ok(q.has("b1") && q.has("b2") && !q.has("b3"), "has() 判斷正確");
  ok(!!storage.getItem(KEY), "已寫入 localStorage");
  const raw = JSON.parse(storage.getItem(KEY));
  ok(raw[0].booking_id === "b1" && !!raw[0].timestamp, "每筆有 booking_id + timestamp");

  const q2 = createQueue(storage); // 模擬重新載入頁面
  ok(q2.read().length === 2, "重新載入後仍然讀到 2 筆（離線唔會跌資料）");

  console.log("📋 2. 補發（成功／失敗／例外）");
  const sent = [];
  const r1 = await q.flush(async (item) => { sent.push(item.booking_id); return item.booking_id === "b1"; });
  ok(r1.synced === 1 && r1.remaining === 1, "成功 1 筆，剩 1 筆");
  ok(q.has("b2") && !q.has("b1"), "成功者已由隊列移除");
  ok(sent.length === 2, "兩筆都有嘗試送出");

  const r2 = await q.flush(async () => { throw new Error("network"); });
  ok(r2.synced === 0 && r2.remaining === 1, "送出例外 → 保留");
  ok(Number(q.read()[0].attempts) >= 2, "已記錄嘗試次數（got " + q.read()[0].attempts + "）");

  const r3 = await q.flush(async () => true);
  ok(r3.synced === 1 && r3.remaining === 0, "網絡恢復後全部清空");
  ok(q.read().length === 0, "隊列已清空");

  console.log("📋 3. 教練端接線");
  const ui = fs.readFileSync(path.join(__dirname, "../../frontend-v2/coach-dashboard.html"), "utf8");
  ok(/assets\/offline-queue\.js/.test(ui), "已載入 offline-queue.js");
  ok(/OQ\.add\(/.test(ui), "簽到失敗會入隊");
  ok(/offlineBar\(/.test(ui), "有弱網提示條");
  ok(/addEventListener\("online"/.test(ui), "監聽 window.online 自動同步");
  ok(/visibilitychange/.test(ui), "回到前景時同步");
  ok(/setInterval\([\s\S]{0,120}30000\)/.test(ui), "每 30 秒輪詢補發");
  ok(/withTimeout\(/.test(ui) && /9000/.test(ui), "請求有 9 秒超時，唔會無限轉圈");
  ok(/離線已記錄/.test(ui), "名單顯示離線暫存狀態");
  ok(/sendCheckin/.test(ui) && /冪等/.test(ui), "補發會將重複簽到視為已同步");

  console.log("\n📊 結果: " + pass + " ✅ 通過, " + fail + " ❌ 失敗\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
