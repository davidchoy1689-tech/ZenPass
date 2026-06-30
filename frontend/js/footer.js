/**
 * ZenPass 統一頁腳 footer.js
 * Injected via DOMContentLoaded — one consistent footer across all pages.
 * Usage: <script src="js/footer.js"></script> (place before </body>)
 */
(function () {
  'use strict';

  // ---- Footer CSS (injected once) ----
  var footerCss =
    '.zp-footer-grad{background:linear-gradient(135deg,#1a1a2e 0%,#2d2d44 50%,#c94420 100%)}' +
    '.zp-footer-grad .zp-footer-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;max-width:400px;margin:0 auto;padding:40px 16px 0}' +
    '@media(min-width:768px){.zp-footer-grad .zp-footer-grid{grid-template-columns:2fr 1fr 1fr 1fr;gap:24px;max-width:720px}}' +
    '.zp-footer-grad .zp-footer-section-title{color:rgba(255,255,255,0.92);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px}' +
    '.zp-footer-grad ul{list-style:none;padding:0;margin:0}' +
    '.zp-footer-grad li{margin-bottom:6px}' +
    '.zp-footer-link{color:rgba(255,255,255,0.95);text-decoration:none;transition:color 0.2s;font-size:13px}' +
    '.zp-footer-link:hover{color:#fff}' +
    '.zp-back-to-top{position:fixed;bottom:80px;right:16px;width:44px;height:44px;border-radius:50%;background:#c94420;color:#fff;border:none;font-size:20px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,0.2);z-index:999;opacity:0;transform:translateY(20px);transition:opacity 0.3s,transform 0.3s;pointer-events:none;display:flex;align-items:center;justify-content:center}' +
    '.zp-back-to-top.visible{opacity:1;transform:translateY(0);pointer-events:auto}' +
    '.zp-back-to-top:hover{background:#aa3218}' +
    'html.dark .zp-footer-grad{background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#aa3218 100%)}' +
    'html.dark .zp-footer-grad .zp-footer-section-title{color:rgba(255,255,255,0.5)}' +
    'html.dark .zp-footer-link{color:rgba(255,255,255,0.6)}' +
    'html.dark .zp-back-to-top{background:var(--orange-600-bg,#c94420)}' +
    'html.dark .zp-back-to-top:hover{background:var(--orange-700,#aa3218)}';

  // ---- Footer HTML ----
  var footerHTML =
    '<footer class="zp-footer-grad">' +
      '<div class="zp-footer-grid">' +
        '<div style="grid-column:span 2">' +
          '<div style="color:#fff;font-weight:700;font-size:15px;margin-bottom:8px">🧘 ZenPass 禪流</div>' +
          '<div style="font-size:12px;line-height:1.7;color:rgba(255,255,255,0.6)">一個Pass，通行全城運動體驗。<br>由 香港康樂及體育有限公司 營運<br>專注新興運動推廣・運動連結社區</div>' +
          '<div style="margin-top:12px">' +
            '<a href="https://wa.me/85290335538" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:20px;background:rgba(255,255,255,0.1);color:#fff;font-size:12px;font-weight:600;text-decoration:none;transition:all 0.2s" onmouseover="this.style.background=\'rgba(255,255,255,0.2)\'" onmouseout="this.style.background=\'rgba(255,255,255,0.1)\'">💬 WhatsApp 即時查詢</a>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<div class="zp-footer-section-title">探索</div>' +
          '<ul>' +
            '<li><a href="explore.html" class="zp-footer-link">探索課程</a></li>' +
            '<li><a href="coaches.html" class="zp-footer-link">星級教練</a></li>' +
            '<li><a href="membership.html" class="zp-footer-link">會籍方案</a></li>' +
            '<li><a href="coach-apply.html" class="zp-footer-link">成為教練</a></li>' +
            '<li><a href="partner-apply.html" class="zp-footer-link">場地加盟</a></li>' +
            '<li><a href="corporate-guide.html" class="zp-footer-link">企業計劃</a></li>' +
          '</ul>' +
        '</div>' +
        '<div>' +
          '<div class="zp-footer-section-title">支援</div>' +
          '<ul>' +
            '<li><a href="faq.html" class="zp-footer-link">常見問題</a></li>' +
            '<li><a href="my-bookings.html" class="zp-footer-link">我的預約</a></li>' +
            '<li><a href="wallet.html" class="zp-footer-link">錢包/退款</a></li>' +
            '<li><a href="privacy.html" class="zp-footer-link">私隱政策</a></li>' +
            '<li><a href="terms.html" class="zp-footer-link">服務條款</a></li>' +
            '<li><a href="about.html" class="zp-footer-link">關於我們</a></li>' +
            '<li><a href="sitemap.xml" class="zp-footer-link">網站地圖</a></li>' +
          '</ul>' +
        '</div>' +
        '<div>' +
          '<div class="zp-footer-section-title">聯絡我們</div>' +
          '<ul>' +
            '<li style="margin-bottom:4px">📧 <a href="mailto:info@hklfcl.com" style="color:rgba(255,255,255,0.8);text-decoration:none">info@hklfcl.com</a></li>' +
            '<li style="margin-bottom:4px">📞 <a href="tel:+85290335538" style="color:rgba(255,255,255,0.8);text-decoration:none">9033 5538</a></li>' +
            '<li style="margin-bottom:4px">📍 觀塘鴻圖道 51 號 Two Sky Parc 2806</li>' +
            '<li style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.5)">🕐 營業時間：<br>週一至五 10:00–19:00<br>週六 10:00–17:00<br>週日休息</li>' +
          '</ul>' +
          '<div style="display:flex;gap:10px;margin-top:12px">' +
            '<a href="https://www.instagram.com/zenpass_hk" style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,0.1);font-size:15px;text-decoration:none;transition:all 0.2s" onmouseover="this.style.background=\'rgba(255,255,255,0.2)\'" onmouseout="this.style.background=\'rgba(255,255,255,0.1)\'">📸</a>' +
            '<a href="https://www.facebook.com/zenpass.hk" style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,0.1);font-size:15px;text-decoration:none;transition:all 0.2s" onmouseover="this.style.background=\'rgba(255,255,255,0.2)\'" onmouseout="this.style.background=\'rgba(255,255,255,0.1)\'">👍</a>' +
            '<a href="https://wa.me/85290335538" style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,0.1);font-size:15px;text-decoration:none;transition:all 0.2s" onmouseover="this.style.background=\'rgba(255,255,255,0.2)\'" onmouseout="this.style.background=\'rgba(255,255,255,0.1)\'">💬</a>' +
            '<a href="https://hklfcl.com" style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,0.1);font-size:15px;text-decoration:none;transition:all 0.2s" onmouseover="this.style.background=\'rgba(255,255,255,0.2)\'" onmouseout="this.style.background=\'rgba(255,255,255,0.1)\'">🏛️</a>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div style="max-width:600px;margin:24px auto 0;padding:16px 20px 0;border-top:1px solid rgba(255,255,255,0.1);text-align:center;font-size:11px;color:rgba(255,255,255,0.35);line-height:1.8">' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:12px">' +
          '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;background:rgba(255,255,255,0.08);font-size:11px;color:rgba(255,255,255,0.5)">🔒 SSL 安全加密</span>' +
          '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;background:rgba(255,255,255,0.08);font-size:11px;color:rgba(255,255,255,0.5)">💳 Stripe 安全支付</span>' +
          '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;background:rgba(255,255,255,0.08);font-size:11px;color:rgba(255,255,255,0.5)">🏛️ 商界展關懷</span>' +
        '</div>' +
        '© 2026 ZenPass 禪流 · 香港康樂及體育有限公司 · All rights reserved.<br>' +
        '<a href="privacy.html" style="color:rgba(255,255,255,0.4);text-decoration:underline">私隱政策</a> · ' +
        '<a href="terms.html" style="color:rgba(255,255,255,0.4);text-decoration:underline">服務條款</a> · ' +
        '<a href="sitemap.xml" style="color:rgba(255,255,255,0.4);text-decoration:underline">網站地圖</a>' +
      '</div>' +
    '</footer>' +
    '<button class="zp-back-to-top" id="zpBackToTop" onclick="window.scrollTo({top:0,behavior:\'smooth\'})" aria-label="返回頂部">↑</button>';

  // ---- Inject once on DOM ready ----
  function initFooter() {
    // Avoid double-injection
    if (document.getElementById('zp-footer-injected')) return;

    // CSS
    var styleEl = document.createElement('style');
    styleEl.id = 'zp-footer-style';
    styleEl.textContent = footerCss;
    document.head.appendChild(styleEl);

    // Footer HTML
    var wrapper = document.createElement('div');
    wrapper.id = 'zp-footer-injected';
    wrapper.innerHTML = footerHTML;
    document.body.appendChild(wrapper);

    // Back-to-top scroll listener
    var btn = document.getElementById('zpBackToTop');
    if (btn) {
      var ticking = false;
      window.addEventListener('scroll', function () {
        if (!ticking) {
          window.requestAnimationFrame(function () {
            if (window.scrollY > 300) {
              btn.classList.add('visible');
            } else {
              btn.classList.remove('visible');
            }
            ticking = false;
          });
          ticking = true;
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFooter);
  } else {
    initFooter();
  }
})();
