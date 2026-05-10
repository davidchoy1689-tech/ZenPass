// ZenPass 共享導航欄 + Footer
(function () {
  'use strict';

  var pageTitles = {
    'index.html': '🏠 首頁',
    'courses.html': '📚 課程列表',
    'explore.html': '🔍 探索',
    'class-detail.html': '📖 課程詳情',
    'my.html': '👤 我的',
    'my-bookings.html': '📅 我的預約',
    'membership.html': '💳 會籍方案',
    'badges.html': '🏅 勳章牆',
    'payment.html': '💰 付款',
    'rate.html': '⭐ 評價',
    'checkin.html': '📆 簽到',
    'buy-credits.html': '🪙 購買點數',
    'coach-apply.html': '🏋️ 教練申請',
    'coach-dashboard.html': '📊 教練面板',
    'points.html': '🎯 積分中心',
    'login.html': '🔐 登入',
    'share.html': '📤 分享',
    'my-membership.html': '🎫 我的會籍',
  };

  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  var title = pageTitles[currentPage] || 'ZenPass 禪流';
  var isHome = currentPage === 'index.html';

  // Create header
  var header = document.createElement('div');
  header.className = 'zen-header';
  header.innerHTML =
    (isHome ? '' : '<a class="back-btn" onclick="history.back()">←</a>') +
    '<h1>' + title + '</h1>' +
    (isHome ? '' : '<a class="home-link" href="./">🏠 首頁</a>');

  // Create footer
  var footer = document.createElement('div');
  footer.className = 'zen-footer';
  footer.innerHTML =
    '<div class="links">' +
      '<a href="./">首頁</a>' +
      '<a href="/courses.html">課程</a>' +
      '<a href="/my.html">我的</a>' +
      '<a href="/points.html">積分</a>' +
    '</div>' +
    '© ' + new Date().getFullYear() + ' ZenPass 禪流 · 香港康樂及體育有限公司';

  // Insert before first child of body, or prepend to body
  var body = document.body;
  if (body) {
    body.classList.add('zen-header-active');
    body.insertBefore(header, body.firstChild);
    body.appendChild(footer);
  }
})();
