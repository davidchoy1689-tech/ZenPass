// ZenPass 統一頁腳載入器
(function () {
  var placeholder = document.getElementById('zp-footer');
  if (!placeholder) return;

  // Detect path relative to page (admin/ pages need ../)
  var isInSubdir = window.location.pathname.indexOf('/admin/') !== -1;
  var basePath = isInSubdir ? '../assets/' : 'assets/';

  fetch(basePath + 'footer.html?' + new Date().getTime())
    .then(function (r) { return r.text(); })
    .then(function (html) {
      placeholder.outerHTML = html;
    })
    .catch(function () {
      // fallback
      placeholder.outerHTML =
        '<div style="background:#1a1a2e;color:rgba(255,255,255,0.4);text-align:center;padding:16px;font-size:11px;margin-top:48px">' +
        '&copy; 2026 ZenPass 禪流 · 香港康樂及體育有限公司</div>';
    });
})();
