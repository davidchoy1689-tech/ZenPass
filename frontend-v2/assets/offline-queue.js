/* ZenPass — 離線簽到佇列（2026-10-28）
 * 場景：工廈地庫／室內草地場訊號極差，教練簽到唔可以卡死。
 * 做法：樂觀更新 + localStorage 暫存 + 連線後自動補發（後端本身冪等）。
 * 同時支援 browser（window.ZPOfflineQueue）與 node（module.exports）以便單元測試。
 */
(function (root) {
  var KEY = "zenpass_offline_checkins";

  function createQueue(storage, opts) {
    var store = storage || (root && root.localStorage);
    var options = opts || {};

    function read() {
      try {
        var raw = store.getItem(KEY);
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        return [];
      }
    }
    function write(arr) {
      try {
        store.setItem(KEY, JSON.stringify(arr));
      } catch (e) {}
      return arr;
    }
    function add(item) {
      var arr = read();
      var id = String(item.booking_id || "");
      if (!id) return arr;
      if (arr.some(function (x) { return String(x.booking_id) === id; })) return arr;
      arr.push({
        booking_id: id,
        schedule_id: item.schedule_id ? String(item.schedule_id) : "",
        name: item.name ? String(item.name) : "",
        timestamp: item.timestamp || new Date().toISOString(),
        attempts: 0,
      });
      return write(arr);
    }
    function remove(bookingId) {
      var id = String(bookingId);
      return write(read().filter(function (x) { return String(x.booking_id) !== id; }));
    }
    function has(bookingId) {
      var id = String(bookingId);
      return read().some(function (x) { return String(x.booking_id) === id; });
    }
    function bumpAttempt(bookingId) {
      var id = String(bookingId);
      var arr = read().map(function (x) {
        if (String(x.booking_id) === id) x.attempts = (Number(x.attempts) || 0) + 1;
        return x;
      });
      return write(arr);
    }
    function clear() { return write([]); }

    /**
     * 逐筆補發
     * @param {(item)=>Promise<boolean|"retry">} send 回傳 true=成功清除、false/"retry"=保留
     */
    function flush(send) {
      var arr = read();
      var synced = 0;
      var chain = Promise.resolve();
      arr.forEach(function (item) {
        chain = chain.then(function () {
          return Promise.resolve()
            .then(function () { return send(item); })
            .then(function (ok) {
              if (ok === true) { remove(item.booking_id); synced++; }
              else bumpAttempt(item.booking_id);
            })
            .catch(function () { bumpAttempt(item.booking_id); });
        });
      });
      return chain.then(function () {
        return { synced: synced, remaining: read().length, pending: read() };
      });
    }

    return { KEY: KEY, read: read, add: add, remove: remove, has: has, clear: clear, flush: flush };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createQueue: createQueue, KEY: KEY };
  } else {
    root.ZPOfflineQueue = { createQueue: createQueue, KEY: KEY };
  }
})(typeof window !== "undefined" ? window : globalThis);
