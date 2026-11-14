/* ============================================================================
 * ZenPass 禪流 · 動效控制器（Phase 7.1-Motion）
 * ----------------------------------------------------------------------------
 * 依賴：assets/zenpass-motion.css
 * 用法：<script src="assets/motion-controller.js?v=1" defer></script>
 *       window.ZenPassMotion.openSheet('#mySheet');
 *
 * 設計約束：
 *   - 零外部依賴、零 rAF 常駐迴圈（唔搶主線程）
 *   - 所有動畫只動 transform / opacity，由合成器處理
 *   - 全程尊重 prefers-reduced-motion 與 html[data-senior-calm="1"]
 *   - 唔會自動接管任何現有頁面；必須主動呼叫 API 或加 class 才生效
 *
 * 2026-11-14 · Phase 7.1-Motion
 * ==========================================================================*/
(function () {
  "use strict";

  var CALM_KEY = "zp_senior_calm";
  var FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /* ------------------------------------------------------------------------
   * 內部工具
   * ---------------------------------------------------------------------- */
  function $(target) {
    if (!target) return null;
    if (typeof target === "string") return document.querySelector(target);
    return target instanceof Element ? target : null;
  }

  function toArray(nodeList) {
    return Array.prototype.slice.call(nodeList || []);
  }

  /* ------------------------------------------------------------------------
   * 1. 無障礙狀態偵測
   * ---------------------------------------------------------------------- */
  function isReducedMotion() {
    var sysReduce = false;
    try {
      sysReduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) { /* 環境唔支援 matchMedia，當作正常 */ }

    var seniorCalm = false;
    try {
      seniorCalm = localStorage.getItem(CALM_KEY) === "1";
    } catch (e) { /* 私密模式封鎖 localStorage */ }

    if (document.documentElement.getAttribute("data-senior-calm") === "1") seniorCalm = true;

    return sysReduce || seniorCalm;
  }

  /* ------------------------------------------------------------------------
   * 2. 樂齡無動態模式開關
   * ---------------------------------------------------------------------- */
  function setSeniorCalm(on) {
    var enabled = !!on;
    document.documentElement.setAttribute("data-senior-calm", enabled ? "1" : "0");
    try {
      if (enabled) localStorage.setItem(CALM_KEY, "1");
      else localStorage.removeItem(CALM_KEY);
    } catch (e) { /* 忽略 */ }
    return enabled;
  }

  function toggleSeniorCalm() {
    return setSeniorCalm(document.documentElement.getAttribute("data-senior-calm") !== "1");
  }

  /* ------------------------------------------------------------------------
   * 3. Bottom Sheet 開關（含焦點管理、ESC、背景鎖滾動）
   * ---------------------------------------------------------------------- */
  var sheetState = window.__zpSheetState || (window.__zpSheetState = {
    lastFocus: null,
    scrollLockY: 0,
    locked: false
  });

  function lockScroll() {
    if (sheetState.locked) return;
    sheetState.scrollLockY = window.scrollY || window.pageYOffset || 0;
    var b = document.body;
    b.style.position = "fixed";
    b.style.top = -sheetState.scrollLockY + "px";
    b.style.left = "0";
    b.style.right = "0";
    b.style.width = "100%";
    sheetState.locked = true;
  }

  function unlockScroll() {
    if (!sheetState.locked) return;
    var b = document.body;
    b.style.position = "";
    b.style.top = "";
    b.style.left = "";
    b.style.right = "";
    b.style.width = "";
    sheetState.locked = false;
    window.scrollTo(0, sheetState.scrollLockY);
  }

  function isOpen(backdrop) {
    return !!backdrop && backdrop.classList.contains("is-open");
  }

  /**
   * 開啟抽屜。先移除 hidden → 強制一幀繪製 → 再加 is-open，
   * 確保 CSS transition 由 translateY(100%) 真正過渡落 0。
   */
  function openSheet(target, options) {
    var backdrop = $(target);
    if (!backdrop) return false;
    var opts = options || {};

    backdrop.classList.remove("hidden", "is-closing");
    backdrop.removeAttribute("hidden");
    void backdrop.offsetHeight; // 強制 reflow，觸發起始狀態
    backdrop.classList.add("is-open");
    backdrop.setAttribute("aria-hidden", "false");

    sheetState.lastFocus = document.activeElement;
    lockScroll();

    if (opts.focus !== false) {
      var panel = backdrop.querySelector(".zp-sheet-panel") || backdrop;
      var first = panel.querySelector(FOCUSABLE);
      if (first && typeof first.focus === "function") {
        // 等 transition 開始後才搶焦點，避免手機鍵盤彈出時畫面跳動
        setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }, 60);
      }
    }

    if (typeof opts.onOpen === "function") opts.onOpen(backdrop);
    return true;
  }

  /**
   * 關閉抽屜。無動態模式即時隱藏；否則等 200ms 退場動畫完再落 hidden。
   */
  function closeSheet(target, options) {
    var backdrop = $(target);
    if (!backdrop) return false;
    var opts = options || {};

    var finish = function () {
      backdrop.classList.remove("is-closing", "is-open");
      backdrop.classList.add("hidden");
      backdrop.setAttribute("aria-hidden", "true");
      unlockScroll();
      if (sheetState.lastFocus && typeof sheetState.lastFocus.focus === "function") {
        try { sheetState.lastFocus.focus({ preventScroll: true }); } catch (e) { /* 元素可能已移除 */ }
      }
      sheetState.lastFocus = null;
      if (typeof opts.onClose === "function") opts.onClose(backdrop);
    };

    if (isReducedMotion()) { finish(); return true; }

    backdrop.classList.remove("is-open");
    backdrop.classList.add("is-closing");
    setTimeout(finish, 205); // 200ms 退場 + 5ms 緩衝
    return true;
  }

  function toggleSheet(target, options) {
    var backdrop = $(target);
    if (!backdrop) return false;
    return isOpen(backdrop) ? closeSheet(backdrop, options) : openSheet(backdrop, options);
  }

  /* ------------------------------------------------------------------------
   * 4. 成功打勾 SVG（420ms 單次描邊）
   * ---------------------------------------------------------------------- */
  function mountSuccessCheckSVG(target) {
    var el = $(target);
    if (!el) return false;

    var reduce = isReducedMotion();

    el.innerHTML =
      '<div class="zp-success-ring">' +
        '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">' +
          '<path d="M7 16.5L13 22.5L25 10.5" stroke="#059669" stroke-width="3.5" ' +
                'stroke-linecap="round" stroke-linejoin="round" class="zp-success-check-path" />' +
        '</svg>' +
      '</div>';

    if (reduce) {
      var path = el.querySelector(".zp-success-check-path");
      if (path) {
        path.style.animation = "none";
        path.style.strokeDashoffset = "0";
      }
    }
    return true;
  }

  /* ------------------------------------------------------------------------
   * 5. 席位保留倒數進度條（scaleX，零重排）
   * ---------------------------------------------------------------------- */
  function bindHoldTimerBar(textTarget, barTarget, totalSeconds, onExpire) {
    var textEl = $(textTarget);
    var barEl = $(barTarget);
    var total = Math.max(1, Number(totalSeconds) || 1800);
    if (!textEl && !barEl) return null;

    if (barEl) {
      barEl.style.transformOrigin = "left center";
      barEl.style.willChange = "transform";
      barEl.style.transform = "scaleX(1)";
    }

    var left = total;
    var timer = null;

    function render() {
      var mm = String(Math.floor(left / 60)).padStart(2, "0");
      var ss = String(left % 60).padStart(2, "0");
      if (textEl) textEl.textContent = mm + ":" + ss;
      if (barEl) barEl.style.transform = "scaleX(" + (left / total).toFixed(4) + ")";
    }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    function start() {
      stop();
      render();
      timer = setInterval(function () {
        left = Math.max(0, left - 1);
        render();
        if (left === 0) {
          stop();
          if (typeof onExpire === "function") {
            try { onExpire(); } catch (e) { /* 回呼錯誤唔應該中斷倒數 */ }
          }
        }
      }, 1000);
    }

    function reset(seconds) {
      total = Math.max(1, Number(seconds) || total);
      left = total;
      start();
    }

    // 頁面隱藏時暫停，返回時校正，避免背景分頁計時漂移
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else if (left > 0) start();
    });

    start();
    return { stop: stop, reset: reset, getLeft: function () { return left; } };
  }

  /* ------------------------------------------------------------------------
   * 6. 自動初始化（極輕量，只做兩件事）
   * ---------------------------------------------------------------------- */
  function init() {
    // 6.1 還原樂齡無動態設定
    try {
      if (localStorage.getItem(CALM_KEY) === "1") {
        document.documentElement.setAttribute("data-senior-calm", "1");
      }
    } catch (e) { /* 忽略 */ }

    // 6.2 全域 ESC + 點擊背景關閉（事件委派，唔逐個綁）
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape" && ev.key !== "Esc") return;
      var open = document.querySelector(".zp-sheet-backdrop.is-open");
      if (open) { ev.preventDefault(); closeSheet(open); }
    }, { passive: false });

    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.classList) return;
      // 點背景（唔係 panel 內部）才關閉
      if (t.classList.contains("zp-sheet-backdrop") && t.classList.contains("is-open")) {
        closeSheet(t);
      }
    });

    // 6.3 自動為標記 [data-zp-motion-btn]／[data-zp-pressable] 的元素加上按壓回饋
    toArray(document.querySelectorAll("[data-zp-motion-btn], [data-zp-pressable]")).forEach(function (el) {
      el.classList.add("zp-motion-btn");
    });

    // 6.3b 主要 CTA 自動套用按壓回饋（只限已知主行動按鈕，唔會掃全站）
    toArray(document.querySelectorAll(".btn-primary, #payNow, .hero-btn, .success-hero-action, #final-confirm-pay-btn"))
      .forEach(function (el) { el.classList.add("zp-motion-btn"); });

    // 6.4 自動為標記 [data-zp-reveal] 的元素加上內容淡入
    toArray(document.querySelectorAll("[data-zp-reveal]")).forEach(function (el) {
      el.classList.add("zp-reveal-content");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  /* ------------------------------------------------------------------------
   * 公開 API
   * ---------------------------------------------------------------------- */
  window.ZenPassMotion = {
    isReducedMotion: isReducedMotion,
    setSeniorCalm: setSeniorCalm,
    toggleSeniorCalm: toggleSeniorCalm,
    openSheet: openSheet,
    closeSheet: closeSheet,
    toggleSheet: toggleSheet,
    isSheetOpen: function (t) { return isOpen($(t)); },
    mountSuccessCheckSVG: mountSuccessCheckSVG,
    bindHoldTimerBar: bindHoldTimerBar,
    /**
     * 付款／提交進行中：切換按鈕呼吸脈衝，並鎖點擊防重複提交。
     * setProcessing(btn, true) → setProcessing(btn, false)
     */
    setProcessing: function (target, on) {
      var el = $(target);
      if (!el) return false;
      var active = !!on;
      el.classList.toggle("zp-btn-processing", active);
      if (active) el.setAttribute("aria-busy", "true");
      else el.removeAttribute("aria-busy");
      return active;
    },
    version: "7.1-motion"
  };
})();
