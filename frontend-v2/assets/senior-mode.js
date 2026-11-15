/**
 * ZenPass 長者模式（Senior Mode）
 *
 * 顯示規則（2026-11-15 David 指示）
 *  - 只限 60 歲或以上嘅學員帳號，先會見到右下角浮標
 *  - 教練、平台職員／管理員、場地、機構帳號 → 一律唔顯示
 *  - 未登入（遊客）→ 唔顯示（除非用 ?senior=1 明確指定，方便派卡片）
 *  - 家長／成人帳號（未滿 60）→ 唔顯示
 *
 * 其他
 *  - 記住選擇（localStorage: zp_senior_mode）
 *  - 只加 html.zp-senior class，樣式全部喺 v2.css
 *  - ?senior=1 / ?senior=0 可直接指定（派卡片、WhatsApp 連結用）
 */
(function () {
  "use strict";

  var KEY = "zp_senior_mode";
  var MANUAL = "zp_senior_manual";
  var HIDE_ROLES = [
    "coach",
    "admin",
    "super_admin",
    "platform_manager",
    "platform_staff",
    "auditor",
    "partner_owner",
    "partner_admin",
    "partner_staff",
    "org_admin",
  ];

  function readUser() {
    try { return JSON.parse(localStorage.getItem("zenpass_user") || "null"); } catch (e) { return null; }
  }

  function forcedOn() {
    try { return new URLSearchParams(location.search).get("senior") === "1"; } catch (e) { return false; }
  }
  function forcedOff() {
    try { return new URLSearchParams(location.search).get("senior") === "0"; } catch (e) { return false; }
  }

  function isOn() {
    try {
      if (forcedOn()) { localStorage.setItem(KEY, "1"); return true; }
      if (forcedOff()) { localStorage.setItem(KEY, "0"); return false; }
      return localStorage.getItem(KEY) === "1";
    } catch (e) { return false; }
  }

  function apply(on) {
    document.documentElement.classList.toggle("zp-senior", !!on);
    var b = document.getElementById("zpSeniorBtn");
    if (b) {
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.innerHTML = on
        ? '<span aria-hidden="true">🙋</span><span class="zp-sr-tx">一般模式</span>'
        : '<span aria-hidden="true">👵</span><span class="zp-sr-tx">長者模式</span>';
      b.title = on ? "切換回一般字體大小" : "放大字體、加大按鈕";
    }
  }

  function toggle() {
    var next = !document.documentElement.classList.contains("zp-senior");
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
      localStorage.setItem(MANUAL, next ? "1" : "0"); // 用家自己決定 → 記住
    } catch (e) {}
    apply(next);
    try {
      if (next && typeof window.toast === "function") window.toast("已開啟長者模式：字體同按鈕都會放大");
    } catch (e) {}
  }

  /** 由 birth_year 計年齡；冇資料回 null */
  function ageOf(u) {
    var y = u && Number(u.birth_year);
    if (!y || y < 1900 || y > new Date().getFullYear()) return null;
    return new Date().getFullYear() - y;
  }

  /** 需要時向伺服器拎最新資料（含 birth_year） */
  function fetchMe() {
    return fetch("/api/auth/me", { credentials: "include" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d && d.user ? d.user : null; })
      .catch(function () { return null; });
  }

  function manualOn() {
    try { return localStorage.getItem(MANUAL) === "1"; } catch (e) { return false; }
  }

  /** 回傳 { allow, eligible }：allow=可唔可以開；eligible=60+（顯示顯眼浮標） */
  function decide() {
    var u = readUser();
    var role = (u && u.role) || "";

    // 教練／職員／場地／機構 → 永遠唔顯示、唔自動開
    if (HIDE_ROLES.indexOf(role) >= 0) return Promise.resolve({ allow: false, eligible: false });

    // 用家自己喺「我的 → 長者模式」開過 → 尊重選擇（普通樣式浮標，方便隨時關）
    if (manualOn() || forcedOn()) return Promise.resolve({ allow: true, eligible: false });

    if (!u || !u.id) return Promise.resolve({ allow: false, eligible: false });

    var age = ageOf(u);
    if (age != null) return Promise.resolve({ allow: age >= 60, eligible: age >= 60 });

    return fetchMe().then(function (fresh) {
      if (fresh) {
        try {
          var merged = Object.assign({}, u, fresh);
          localStorage.setItem("zenpass_user", JSON.stringify(merged));
        } catch (e) {}
        if (HIDE_ROLES.indexOf(String(fresh.role || "")) >= 0) return { allow: false, eligible: false };
        var a2 = ageOf(fresh);
        return { allow: a2 != null && a2 >= 60, eligible: a2 != null && a2 >= 60 };
      }
      return { allow: false, eligible: false };
    });
  }

  function mount(eligible) {
    if (document.getElementById("zpSeniorBtn")) return;
    var b = document.createElement("button");
    b.id = "zpSeniorBtn";
    b.type = "button";
    b.className = "zp-senior-btn" + (eligible ? " eligible" : "");
    b.addEventListener("click", toggle);
    document.body.appendChild(b);
    apply(isOn());
  }

  function setManual(on) {
    try {
      localStorage.setItem(MANUAL, on ? "1" : "0");
      localStorage.setItem(KEY, on ? "1" : "0");
    } catch (e) {}
    apply(!!on);
    if (on && !document.getElementById("zpSeniorBtn")) mount(false);
  }

  window.ZenPassSenior = {
    toggle: toggle,
    set: setManual,
    _decide: decide,
    isOn: function () { return document.documentElement.classList.contains("zp-senior"); },
  };

  // 先套 class（避免閃一下正常字體）
  try { if (isOn()) document.documentElement.classList.add("zp-senior"); } catch (e) {}

  function boot() {
    decide().then(function (res) {
      if (!res || !res.allow) {
        // 唔合資格：收埋按鈕；自動開啟嘅亦一併關閉（手動開嘅唔會走到呢步）
        document.documentElement.classList.remove("zp-senior");
        try { localStorage.removeItem(KEY); } catch (e) {}
        return;
      }
      mount(!!res.eligible);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
