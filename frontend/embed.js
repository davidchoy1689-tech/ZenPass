/**
 * ZenPass 禪流 — 商戶嵌入 Widget
 * 
 * 用法：商戶複製以下 code 貼到網站任何位置：
 * 
 * <div id="zenpass-widget" data-merchant-id="YOUR_MERCHANT_ID"></div>
 * <script src="https://davidchoy1689-tech.github.io/ZenPass/embed.js"></script>
 */

(function () {
  var container = document.getElementById("zenpass-widget");
  if (!container) {
    // Auto-create if script is placed directly
    container = document.createElement("div");
    container.id = "zenpass-widget";
    document.currentScript.parentNode.insertBefore(container, document.currentScript.nextSibling);
  }

  var merchantId = container.getAttribute("data-merchant-id") || "";
  var themeColor = container.getAttribute("data-theme") || "#FF6B35";
  var title = container.getAttribute("data-title") || "預約課程";

  // Styles
  var style = document.createElement("style");
  style.textContent = `
    #zenpass-widget { font-family: 'Noto Sans TC', sans-serif; max-width: 360px; margin: 0 auto; }
    #zenpass-widget * { box-sizing: border-box; }
    .zpw-header { background: ` + themeColor + `; color: white; padding: 16px; border-radius: 12px 12px 0 0; font-weight: 700; font-size: 16px; text-align: center; }
    .zpw-list { border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; overflow: hidden; }
    .zpw-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #f3f4f6; cursor: pointer; transition: background .15s; }
    .zpw-item:last-child { border-bottom: none; }
    .zpw-item:hover { background: #f9fafb; }
    .zpw-item .name { font-size: 14px; font-weight: 600; color: #1a1a2e; }
    .zpw-item .time { font-size: 12px; color: #6b7280; margin-top: 2px; }
    .zpw-item .price { font-size: 14px; font-weight: 700; color: ` + themeColor + `; }
    .zpw-error { padding: 20px; text-align: center; color: #6b7280; font-size: 13px; border: 1px solid #e5e7eb; border-radius: 12px; }
    .zpw-loading { padding: 20px; text-align: center; color: #6b7280; font-size: 13px; }
  `;
  document.head.appendChild(style);

  // Header
  var header = document.createElement("div");
  header.className = "zpw-header";
  header.textContent = title;
  container.appendChild(header);

  // List
  var list = document.createElement("div");
  list.className = "zpw-list";
  list.innerHTML = '<div class="zpw-loading">⏳ 載入中...</div>';
  container.appendChild(list);

  // Fetch data
  var api = "https://davidchoy1689-tech.github.io/ZenPass";
  if (window.location.port === "3001" || window.location.hostname === "localhost") {
    api = "";
  }

  fetch((api || "") + "/api/classes?coach_id=" + merchantId + "&limit=5")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var classes = d.classes || [];
      if (classes.length === 0) {
        list.innerHTML = '<div class="zpw-error">暫無開放預約的課程</div>';
        return;
      }
      list.innerHTML = classes.slice(0, 5).map(function (c) {
        var sched = (c.schedules || [])[0] || {};
        var time = sched.start_time || "";
        var dateStr = time ? time.substring(0, 10) + " " + time.substring(11, 16) : "";
        return '<a href="' + (api || "") + '/class-detail.html?id=' + c.id + '" target="_blank" style="text-decoration:none">' +
          '<div class="zpw-item">' +
          '<div><div class="name">' + (c.title || "課程") + '</div><div class="time">' + dateStr + '</div></div>' +
          '<div class="price">$' + (c.price_hkd || 0) + '</div>' +
          '</div></a>';
      }).join("");
    })
    .catch(function () {
      list.innerHTML = '<div class="zpw-error">暫時無法載入，請稍後再試</div>';
    });
})();
