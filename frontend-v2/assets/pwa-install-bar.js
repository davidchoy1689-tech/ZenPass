/**
 * pwa-install-bar.js — 安裝提示「埋單」邏輯（2026-11-16）
 *
 * 原則：安裝係增值；預約成交優先。
 *  - 交易路徑（booking/checkout/pay/success/admin）永不顯示
 *  - 已安裝（standalone / iOS 主畫面）永不顯示
 *  - 用戶永久關閉（zp_hide_install_bar）或本 session 稍後（zp_install_later）不顯示
 *  - 需有參與度：停留 ≥12 秒 或 已離開 Hero
 *  - 頻率：7 日內最多 3 次
 *  - 延遲 12 秒先出；iOS 出 3 步教學 sheet
 */
(function () {
  var BLOCK = /booking|checkout|pay|success|admin|coach|login/i;
  var DELAY_MS = 12000;
  var MAX_PER_WEEK = 3;
  var KEY_HIDE = "zp_hide_install_bar";
  var KEY_LATER = "zp_install_later";
  var KEY_SEEN = "zp_install_seen";


  function track(event, meta) {
    try {
      fetch("/api/analytics/event", {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: event, meta: meta || {}, path: location.pathname }),
      }).catch(function () {});
    } catch (e) {}
  }

  function isStandalone() {
    try {
      return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    } catch (e) { return false; }
  }
  function blockedPath() { return BLOCK.test(location.pathname || ""); }
  function hidePermanently() { try { localStorage.setItem(KEY_HIDE, "1"); } catch (e) {} }
  function laterThisSession() { try { sessionStorage.setItem(KEY_LATER, "1"); } catch (e) {} }

  function seen() {
    try { return JSON.parse(localStorage.getItem(KEY_SEEN) || "null") || { count: 0, firstAt: 0, lastAt: 0 }; }
    catch (e) { return { count: 0, firstAt: 0, lastAt: 0 }; }
  }
  function bumpSeen() {
    var s = seen();
    var now = Date.now();
    if (!s.firstAt || now - s.firstAt > 7 * 864e5) { s = { count: 0, firstAt: now, lastAt: 0 }; }
    s.count += 1; s.lastAt = now;
    try { localStorage.setItem(KEY_SEEN, JSON.stringify(s)); } catch (e) {}
  }

  function eligible() {
    if (isStandalone() || blockedPath()) return false;
    if (document.body && document.body.classList.contains("page-booking")) return false;
    try {
      if (localStorage.getItem(KEY_HIDE) === "1") return false;
      if (sessionStorage.getItem(KEY_LATER) === "1") return false;
    } catch (e) {}
    if (seen().count >= MAX_PER_WEEK) return false;
    return true;
  }

  function engaged() {
    if (location.search.indexOf("homescreen") >= 0) return true; // 強制（派卡／測試）
    return window.__zpEngaged === true;
  }

  function markEngaged() { window.__zpEngaged = true; }

  /* 參與度：停留 12 秒 或 滾動離開 Hero */
  setTimeout(markEngaged, DELAY_MS);
  window.addEventListener("scroll", function () {
    if (window.scrollY > (window.innerHeight || 600) * 0.6) markEngaged();
  }, { passive: true });

  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; }

  var deferred = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; });
  window.addEventListener("appinstalled", function () { remove(); });

  var barEl = null;
  function remove() { if (barEl && barEl.parentNode) barEl.parentNode.removeChild(barEl); barEl = null; }

  function mount() {
    if (barEl) return;
    barEl = document.createElement("div");
    barEl.setAttribute("data-zp-install-bar", "1");
    barEl.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:55;display:flex;gap:10px;align-items:center;" +
      "padding:12px 14px calc(12px + env(safe-area-inset-bottom));background:#0f172a;color:#fff;" +
      "font-size:13px;box-shadow:0 -8px 24px rgba(15,23,42,.28)";
    barEl.innerHTML =
      '<div style="flex:1;line-height:1.4">將 ZenPass 加到主畫面<br><span style="opacity:.75;font-size:11.5px">下次一撳即約，簽到更方便</span></div>' +
      '<button data-go style="border:0;border-radius:999px;padding:10px 16px;font-weight:800;background:#34d399;color:#04140f">安裝</button>' +
      '<button data-later aria-label="稍後" style="border:1px solid rgba(255,255,255,.25);background:transparent;color:#cbd5e1;border-radius:10px;padding:8px 10px">稍後</button>' +
      '<button data-close aria-label="唔再顯示" style="border:0;background:transparent;color:#94a3b8;font-size:18px;padding:4px 6px">✕</button>';

    barEl.querySelector("[data-go]").onclick = function () {
      track("install_bar_click");
      if (deferred) {
        deferred.prompt();
        deferred.userChoice.then(function (r) {
          if (r && r.outcome === "accepted") { track("install_accepted"); remove(); }
          deferred = null;
        }).catch(function () {});
      } else if (isIOS()) {
        track("install_how_to_ios");
        iosSheet();
      } else {
        alert("請用瀏覽器選單 ➜ 安裝應用程式 / 加到主畫面");
      }
    };
    barEl.querySelector("[data-later]").onclick = function () { track("install_bar_dismiss_session"); laterThisSession(); remove(); };
    barEl.querySelector("[data-close]").onclick = function () { track("install_bar_dismiss_permanent"); hidePermanently(); remove(); };

    document.body.appendChild(barEl);
    bumpSeen();
    track("install_bar_impression");
  }

  function iosSheet() {
    var ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;background:rgba(2,6,23,.72);z-index:70;display:grid;place-items:end center;padding:16px";
    ov.innerHTML =
      '<div style="width:100%;max-width:420px;background:#fff;color:#0f172a;border-radius:18px;padding:18px 16px 22px">' +
      '<b style="font-size:16px">加到 iPhone 主畫面</b>' +
      '<ol style="margin:10px 0 0 18px;padding:0;font-size:14px;line-height:1.9">' +
      "<li>撳底部 <b>分享</b> 圖示（方框＋箭嘴）</li>" +
      "<li>揀 <b>「加入主畫面」</b></li>" +
      "<li>撳右上角 <b>「加入」</b></li></ol>" +
      '<button style="width:100%;margin-top:14px;padding:12px;border:0;border-radius:12px;background:#0f766e;color:#fff;font-weight:800">明白</button></div>';
    ov.querySelector("button").onclick = function () { ov.remove(); };
    document.body.appendChild(ov);
  }

  function maybeShow() {
    if (!eligible()) return;
    if (!engaged()) { setTimeout(maybeShow, 4000); return; }
    mount();
  }
  setTimeout(maybeShow, DELAY_MS + 500);

  window.ZPInstall = { eligible: eligible, show: function () { mount(); }, hide: remove, seen: seen };
})();
