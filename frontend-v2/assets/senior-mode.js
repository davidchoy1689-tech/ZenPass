/**
 * ZenPass 長者模式（Senior Mode）
 *
 * - 一鍵切換「正常模式 / 長者模式」，記住選擇（localStorage: zp_senior_mode）
 * - 只加 html.zp-senior class，樣式全部喺 v2.css，唔會改任何內容
 * - 右下角固定圓形按鈕（手機友善 48px），避免同安裝列／底部導航重疊
 * - 亦支援 ?senior=1 / ?senior=0 直接指定（派卡片、WhatsApp 連結用）
 */
(function () {
  "use strict";

  var KEY = "zp_senior_mode";

  function isOn() {
    try {
      var q = new URLSearchParams(location.search).get("senior");
      if (q === "1") { localStorage.setItem(KEY, "1"); return true; }
      if (q === "0") { localStorage.setItem(KEY, "0"); return false; }
      return localStorage.getItem(KEY) === "1";
    } catch (e) { return false; }
  }

  function apply(on) {
    document.documentElement.classList.toggle("zp-senior", !!on);
    var b = document.getElementById("zpSeniorBtn");
    if (b) {
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.innerHTML = on
        ? '<span aria-hidden="true">🙋</span><span class="zp-sr-tx">正常模式</span>'
        : '<span aria-hidden="true">👵</span><span class="zp-sr-tx">長者模式</span>';
      b.title = on ? "切換回正常字體大小" : "放大字體、加大按鈕";
    }
  }

  function toggle() {
    var next = !document.documentElement.classList.contains("zp-senior");
    try { localStorage.setItem(KEY, next ? "1" : "0"); } catch (e) {}
    apply(next);
    try {
      if (next && typeof window.toast === "function") window.toast("已開啟長者模式：字體同按鈕都會放大");
    } catch (e) {}
  }

  function mount() {
    if (document.getElementById("zpSeniorBtn")) return;
    var b = document.createElement("button");
    b.id = "zpSeniorBtn";
    b.type = "button";
    b.className = "zp-senior-btn";
    b.addEventListener("click", toggle);
    document.body.appendChild(b);
    apply(isOn());
  }

  // 先套 class（避免閃一下正常字體），按鈕等 DOM ready
  try { if (isOn()) document.documentElement.classList.add("zp-senior"); } catch (e) {}
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
