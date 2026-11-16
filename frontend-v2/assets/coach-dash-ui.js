/**
 * coach-dash-ui.js — 教練後台美化層 UI helpers（2026-11-17）
 *
 * 只提供「顯示層」工具：抽屜開關、Tab 高亮、課堂卡 HTML、空狀態。
 * 業務邏輯（名單／掃描核銷／開班／對賬）繼續用頁面本身嘅 API script。
 *
 * 用法：
 *   CoachDashUI.openSheet("點名名冊", html);
 *   CoachDashUI.sessionCard({ title, starts_at, venue_name, booked, capacity, price_label, status });
 *   CoachDashUI.bindPanelActions(el, { roster: fn, scan: fn });
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var PILL = {
    open: ["ok", "🟢 已開班"],
    live: ["live", "🔵 進行中"],
    in_progress: ["live", "🔵 進行中"],
    completed: ["", "✅ 已完成"],
    done: ["", "✅ 已完成"],
    cancelled: ["warn", "⚪ 已取消"],
  };

  var CoachDashUI = {
    esc: esc,

    openSheet: function (title, html) {
      var t = $("shTitle"), b = $("shBody") || $("shContent"), mask = $("shMask"), sheet = $("shSheet");
      if (t) t.textContent = title;
      if (b) b.innerHTML = html;
      if (mask) mask.classList.add("on");
      if (sheet) sheet.classList.add("on");
      document.body.style.overflow = "hidden";
    },

    closeSheet: function () {
      var mask = $("shMask"), sheet = $("shSheet");
      if (mask) mask.classList.remove("on");
      if (sheet) sheet.classList.remove("on");
      document.body.style.overflow = "";
    },

    /** 高亮 tab（只影響樣式，唔會觸發載入） */
    setTab: function (key) {
      var bar = $("tabs");
      if (!bar) return;
      Array.prototype.forEach.call(bar.querySelectorAll("[data-f],[data-tab]"), function (b) {
        var k = b.getAttribute("data-f") || b.getAttribute("data-tab");
        b.classList.toggle("on", k === key);
      });
    },

    /**
     * 課堂卡 HTML
     * @param {Object} s { title, starts_at, venue_name, booked, capacity, price_label, status }
     */
    sessionCard: function (s) {
      s = s || {};
      var filled = Number(s.booked != null ? s.booked : s.filled || 0);
      var cap = Math.max(1, Number(s.capacity != null ? s.capacity : s.max_participants || 0) || 1);
      var pct = Math.max(0, Math.min(100, Math.round((filled / cap) * 100)));
      var hot = pct >= 80;
      var st = String(s.status || "open");
      var pill = PILL[st] || ["", st];
      return '' +
        '<div class="cls">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">' +
            '<div style="min-width:0">' +
              '<div style="font-weight:900;font-size:15px;line-height:1.35">' + esc(s.title || "課堂") + "</div>" +
              '<div style="font-size:12.5px;color:#64748b;margin-top:4px;line-height:1.55">' +
                "🕒 " + esc(s.starts_at || "") + "<br>📍 " + esc(s.venue_name || "場地待定") +
              "</div>" +
            "</div>" +
            '<span class="cd-pill ' + pill[0] + '">' + esc(pill[1]) + "</span>" +
          "</div>" +
          '<div class="bar' + (hot ? " hot" : "") + '"><i style="width:' + pct + '%"></i></div>' +
          '<div style="font-size:12px;color:#64748b;font-weight:700">' +
            "👥 " + filled + "/" + cap + " 人" + (s.price_label ? " · " + esc(s.price_label) : "") +
          "</div>" +
          '<div class="acts2">' +
            '<button class="btn btn-primary" data-act="roster" data-id="' + esc(s.id || "") + '">📋 名單／點名</button>' +
            '<button class="btn btn-secondary" data-act="scan" data-id="' + esc(s.id || "") + '">📷 掃描核銷</button>' +
            '<button class="btn btn-secondary" data-act="detail" data-id="' + esc(s.id || "") + '">詳情</button>' +
          "</div>" +
        "</div>";
    },

    empty: function (title, sub) {
      return '<div class="cd-empty"><div class="ico">📋</div><b>' + esc(title || "暫無資料") + "</b>" + esc(sub || "") + "</div>";
    },

    bindPanelActions: function (root, handlers) {
      if (!root) return;
      Array.prototype.forEach.call(root.querySelectorAll("[data-act]"), function (btn) {
        btn.onclick = function () {
          var act = btn.getAttribute("data-act");
          if (handlers && typeof handlers[act] === "function") handlers[act](btn.getAttribute("data-id"), btn);
        };
      });
    },
  };

  window.CoachDashUI = CoachDashUI;

  // 抽屜關閉（若頁面本身已有 handler，重複綁定無害）
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && (t.id === "shClose" || t.id === "shMask")) CoachDashUI.closeSheet();
  });
})();
