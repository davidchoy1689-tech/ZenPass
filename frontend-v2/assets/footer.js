/**
 * ZenPass 統一頁腳 footer.js (v2)
 * 由 DOMContentLoaded 自動注入，全站一致。
 * 用法：<script src="assets/footer.js" defer></script>（放 </body> 之前）
 * 可用 <body data-no-footer> 或頁面加 class="no-footer" 停用。
 */
(function () {
  'use strict';

  var css =
    '.zp-footer{background:linear-gradient(135deg,#1a1a2e 0%,#2d2d44 50%,#c94420 100%);color:#fff;margin-top:32px;padding-bottom:calc(72px + env(safe-area-inset-bottom))}' +
    '.zp-footer-inner{max-width:760px;margin:0 auto;padding:32px 18px 8px}' +
    '.zp-footer-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}' +
    '@media(min-width:768px){.zp-footer-grid{grid-template-columns:2fr 1fr 1fr 1.2fr}}' +
    '.zp-footer-brand{color:#fff;font-weight:700;font-size:15px;margin-bottom:8px}' +
    '.zp-footer-desc{font-size:12px;line-height:1.7;color:rgba(255,255,255,.66)}' +
    '.zp-footer-title{color:rgba(255,255,255,.55);font-size:11px;font-weight:700;letter-spacing:.06em;margin-bottom:10px}' +
    '.zp-footer ul{list-style:none;padding:0;margin:0}' +
    '.zp-footer li{margin-bottom:7px;font-size:13px;color:rgba(255,255,255,.8)}' +
    '.zp-footer a.zp-link{color:rgba(255,255,255,.8);text-decoration:none}' +
    '.zp-footer a.zp-link:hover{color:#fff}' +
    '.zp-footer-social{display:flex;gap:8px;margin-top:12px}' +
    '.zp-footer-social a{width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,.12);text-decoration:none;font-size:14px}' +
    '.zp-footer-copy{border-top:1px solid rgba(255,255,255,.12);margin-top:18px;padding:14px 18px 22px;text-align:center;font-size:11px;color:rgba(255,255,255,.5)}' +
    '.zp-back-top{position:fixed;right:16px;bottom:88px;width:42px;height:42px;border-radius:50%;background:#c94420;color:#fff;border:none;font-size:18px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.25);z-index:800;opacity:0;transform:translateY(16px);transition:.3s;pointer-events:none}' +
    '.zp-back-top.on{opacity:1;transform:none;pointer-events:auto}';

  var html =
    '<div class="zp-footer-inner">' +
      '<div class="zp-footer-grid">' +
        '<div>' +
          '<div class="zp-footer-brand">🧘 ZenPass 禪流</div>' +
          '<div class="zp-footer-desc">一個Pass，通行全城運動體驗。<br>由 香港康樂及體育有限公司 營運<br>專注新興運動推廣・運動連結社區</div>' +
          '<div class="zp-footer-social">' +
            '<a href="https://wa.me/85290335538" title="WhatsApp">💬</a>' +
            '<a href="https://www.instagram.com/zenpass_hk" title="Instagram">📸</a>' +
            '<a href="https://www.facebook.com/zenpass.hk" title="Facebook">👍</a>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<div class="zp-footer-title">探索</div>' +
          '<ul>' +
            '<li><a class="zp-link" href="/explore.html">探索課程</a></li>' +
            '<li><a class="zp-link" href="/coaches.html">星級教練</a></li>' +
            '<li><a class="zp-link" href="/membership.html">會籍方案</a></li>' +
            '<li><a class="zp-link" href="/partner.html">教練／場地加盟</a></li>' +
            '<li><a class="zp-link" href="/coach-apply.html">申請成為教練</a></li>' +
            '<li><a class="zp-link" href="/partner-apply.html">場地登記（即開通）</a></li>' +
            '<li><a class="zp-link" href="/corporate.html">企業計劃</a></li>' +
          '</ul>' +
        '</div>' +
        '<div>' +
          '<div class="zp-footer-title">支援</div>' +
          '<ul>' +
            '<li><a class="zp-link" href="/faq.html">常見問題</a></li>' +
            '<li><a class="zp-link" href="/my-bookings.html">我的預約</a></li>' +
            '<li><a class="zp-link" href="/wallet.html">錢包／退款</a></li>' +
            '<li><a class="zp-link" href="/privacy.html">私隱政策</a></li>' +
            '<li><a class="zp-link" href="/terms.html">服務條款</a></li>' +
            '<li><a class="zp-link" href="/about.html">關於我們</a></li>' +
          '</ul>' +
        '</div>' +
        '<div>' +
          '<div class="zp-footer-title">聯絡我們</div>' +
          '<ul>' +
            '<li>📧 support@zenpass.hk</li>' +
            '<li>📞 2387 0724</li>' +
            '<li>📍 香港九龍觀塘</li>' +
          '</ul>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="zp-footer-copy">© ' + new Date().getFullYear() + ' 香港康樂及體育有限公司 · ZenPass 禪流<br>一個Pass，通行全城運動體驗</div>' +
    '<button class="zp-back-top" id="zpBackTop" aria-label="回到頂部">↑</button>';

  function inject() {
    if (document.querySelector('.zp-footer')) return;
    if (document.body && document.body.hasAttribute('data-no-footer')) return;
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    var f = document.createElement('footer');
    f.className = 'zp-footer';
    f.innerHTML = html;
    document.body.appendChild(f);
    var btn = document.getElementById('zpBackTop');
    if (btn) {
      window.addEventListener('scroll', function () {
        btn.classList.toggle('on', window.scrollY > 400);
      }, { passive: true });
      btn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
