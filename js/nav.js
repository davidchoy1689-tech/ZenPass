/**
 * nav.js — Unified Navigation Module
 * Injects: sticky bottom tab bar, top page header, hamburger sidebar overlay
 * Handles: active tab highlighting, auth-aware account link, dark mode toggle
 * Include via: <script src="js/nav.js"></script> at end of <body>
 *
 * Page config (set BEFORE nav.js):
 *   window.ZENPASS_PAGE_CONFIG = {
 *     title: '探索課程',       // Page title (omit/no title = skip header injection)
 *     showBack: true,          // Show ← back button
 *     backUrl: '',             // Custom back URL (default history.back)
 *     showAuth: true,          // Show login/register buttons
 *     showTheme: true,         // Show dark mode toggle
 *     hideHamburger: false,    // Hide hamburger menu button
 *   };
 */
(function () {
  'use strict';

  // ─── Config ─────────────────────────────────────────────────────
  const PAGES = {
    home:    { href: 'index.html',                icon: '🏠', label: '首頁' },
    explore: { href: 'explore.html',              icon: '🔍', label: '探索' },
    coaches: { href: 'coaches.html',              icon: '👥', label: '教練' },
    wishlist:{ href: 'wishlist.html',             icon: '❤️', label: '收藏' },
    my:      { href: 'my.html',                   icon: '📅', label: '我的' },
    account: { href: 'login.html',                icon: '👤', label: '帳戶' },
  };

  // WISHLIST_PAGE flag — set true on wishlist.html to avoid 404 loop
  // Checking URL path is more reliable than relying on a global flag
  window._isWishlistPage = window.location.pathname.indexOf('wishlist') > -1;

  const SIDEBAR_LINKS = [
    { href: 'explore.html',        icon: '🔍', label: '探索課程' },
    { href: 'coaches.html',        icon: '👥', label: '教練' },
    { href: 'wishlist.html',       icon: '❤️', label: '收藏課程', id: 'sidebarWishlist' },
    { href: 'membership-tailwind.html', icon: '⭐', label: '會員計劃' },
    { href: 'my-bookings.html',    icon: '📅', label: '我的預約' },
    { href: 'login.html',          icon: '👤', label: '登入 / 註冊', id: 'sidebarAccount' },
  ];

  /** Get page config from global variable */
  function getPageConfig() {
    return window.ZENPASS_PAGE_CONFIG || {};
  }

  // ─── Helpers ────────────────────────────────────────────────────
  function currentPage() {
    const path = window.location.pathname.split('/').pop() || 'index.html';
    return path.toLowerCase();
  }

  function activeNav() {
    const page = currentPage();
    for (const [key, val] of Object.entries(PAGES)) {
      if (val.href === page) return key;
    }
    // Wishlist page
    if (page === 'wishlist.html' || page.indexOf('wishlist') !== -1) return 'wishlist';
    // Special cases for sub-pages that map to "my"
    var myPages = ['my-bookings.html','my-membership.html','wallet.html','notifications.html','checkin.html','points.html','buy-credits.html','profile.html','referral.html','badges.html','payment.html'];
    if (myPages.indexOf(page) !== -1) return 'my';
    return null;
  }

  function isLoggedIn() {
    // Dual mode: localStorage token (legacy) or cookie session (new)
    return !!localStorage.getItem('zenpass_token') 
      || !!localStorage.getItem('token')
      || !!sessionStorage.getItem('zenpass_token');
  }

  function isMobile() {
    return window.innerWidth < 768;
  }

  // ─── Top Page Header ────────────────────────────────────────────
  function buildPageHeader() {
    var config = getPageConfig();
    if (!config.title) return; // No config → skip header

    // Remove any existing page-header (duplicate safety)
    document.querySelectorAll('.page-header').forEach(function (el) { el.remove(); });

    var header = document.createElement('header');
    header.className = 'page-header';

    // Left side: back button + title
    var left = document.createElement('div');
    left.className = 'header-left';

    if (config.showBack !== false) {
      var backBtn = document.createElement('button');
      backBtn.className = 'back-btn';
      backBtn.setAttribute('aria-label', '返回');
      backBtn.innerHTML = '←';
      backBtn.onclick = function () {
        if (config.backUrl) {
          window.location.href = config.backUrl;
        } else if (document.referrer && document.referrer.indexOf(window.location.host) !== -1) {
          history.back();
        } else {
          window.location.href = 'index.html';
        }
      };
      left.appendChild(backBtn);
    }

    var title = document.createElement('h1');
    title.textContent = config.title;
    left.appendChild(title);

    header.appendChild(left);

    // Right side: hamburger + theme toggle + auth
    var right = document.createElement('div');
    right.className = 'header-right';

    // Hamburger button (mobile)
    if (!config.hideHamburger) {
      var hamBtn = document.createElement('button');
      hamBtn.className = 'hamburger-btn';
      hamBtn.setAttribute('aria-label', '開啟選單');
      hamBtn.innerHTML = '☰';
      hamBtn.onclick = function (e) {
        e.stopPropagation();
        openSidebar();
      };
      right.appendChild(hamBtn);
    }

    // Dark mode toggle
    if (config.showTheme !== false) {
      var themeBtn = document.createElement('button');
      themeBtn.className = 'icon-btn';
      themeBtn.id = 'themeToggle';
      themeBtn.setAttribute('aria-label', '切換深色模式');
      themeBtn.innerHTML = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
      themeBtn.onclick = function () {
        toggleDarkMode();
        themeBtn.innerHTML = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
      };
      right.appendChild(themeBtn);
    }

    // Auth buttons
    if (config.showAuth !== false) {
      var authContainer = document.createElement('div');
      authContainer.className = 'auth-buttons';
      authContainer.id = 'auth-buttons';
      if (isLoggedIn()) {
        var profileLink = document.createElement('a');
        profileLink.href = 'my.html';
        profileLink.className = 'btn-solid-sm';
        profileLink.textContent = '👤 我的';
        authContainer.appendChild(profileLink);
      } else {
        var loginLink = document.createElement('a');
        loginLink.href = 'login.html';
        loginLink.className = 'btn-ghost-sm';
        loginLink.textContent = '登入';
        authContainer.appendChild(loginLink);
        var regLink = document.createElement('a');
        regLink.href = 'signup.html';
        regLink.className = 'btn-solid-sm';
        regLink.textContent = '註冊';
        authContainer.appendChild(regLink);
      }
      right.appendChild(authContainer);
    }

    header.appendChild(right);
    document.body.insertBefore(header, document.body.firstChild);
  }

  // ─── Bottom Tab Bar ─────────────────────────────────────────────
  function buildBottomNav() {
    // Remove ALL existing bottom-nav elements (inline from HTML)
    document.querySelectorAll('.bottom-nav').forEach(function (el) {
      el.remove();
    });

    var nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', '底部導航');

    var active = activeNav();
    for (var key in PAGES) {
      if (!PAGES.hasOwnProperty(key)) continue;
      var page = PAGES[key];
      var a = document.createElement('a');
      a.href = page.href;
      a.className = 'nav-item' + (active === key ? ' active' : '');
      a.dataset.nav = key;
      if (key === 'account') a.id = 'navAccount';
      a.innerHTML = '<span class="nav-icon">' + page.icon + '</span><span class="nav-label">' + page.label + '</span>';
      if (key === 'wishlist') {
        var badge = document.createElement('span');
        badge.className = 'wishlist-badge';
        badge.id = 'wishlistBadge';
        badge.style.display = 'none';
        badge.style.cssText = 'position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:0 4px;line-height:1';
        a.style.position = 'relative';
        a.appendChild(badge);
      }
      nav.appendChild(a);
    }

    document.body.appendChild(nav);

    // Fetch wishlist count after nav is built
    fetchWishlistCount();
  }

  /** Fetch wishlist count and update badge */
  function fetchWishlistCount() {
    if (!isLoggedIn()) return;
    var badge = document.getElementById('wishlistBadge');
    if (!badge) return;
    fetch((window.API_BASE || '/api') + '/wishlist/count', {
      headers: getAuthHeaders()
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.count > 0) {
        badge.textContent = data.count > 99 ? '99+' : data.count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    })
    .catch(function() { /* silent */ });
  }

  /** Helper: get auth headers from localStorage (dual mode, cookie auto-sends) */
  function getAuthHeaders() {
    var token = localStorage.getItem('zenpass_token') || localStorage.getItem('token');
    if (!token) return {};
    return { 'Authorization': 'Bearer ' + token };
  }

  // ─── Update Account Tab (auth-aware) ────────────────────────────
  /** Cache the user's loyalty tier (fetched once) */
  var _tierIconCache = null;

  function fetchLoyaltyTierIcon(callback) {
    if (_tierIconCache) {
      if (callback) callback(_tierIconCache);
      return;
    }
    if (!isLoggedIn()) {
      if (callback) callback(null);
      return;
    }
    var token = localStorage.getItem('zenpass_token') || localStorage.getItem('token');
    if (!token) {
      if (callback) callback(null);
      return;
    }
    var API_BASE = window.API_BASE || '/api';
    fetch(API_BASE + '/loyalty/my', {
      headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && data.current_tier_info && data.current_tier_info.icon) {
        _tierIconCache = data.current_tier_info.icon;
        if (callback) callback(_tierIconCache);
      } else {
        _tierIconCache = '🥉';
        if (callback) callback(_tierIconCache);
      }
    })
    .catch(function() {
      _tierIconCache = null;
      if (callback) callback(null);
    });
  }

  function updateAccountTab() {
    var link = document.getElementById('navAccount');
    if (!link) return;
    if (isLoggedIn()) {
      link.href = 'my.html';
      link.querySelector('.nav-label').textContent = '帳戶';
      // Optionally add tier icon
      var iconSpan = link.querySelector('.nav-icon');
      if (iconSpan) {
        fetchLoyaltyTierIcon(function(tierIcon) {
          if (tierIcon) {
            iconSpan.textContent = tierIcon;
          }
        });
      }
    } else {
      link.href = 'login.html';
      link.querySelector('.nav-label').textContent = '登入';
    }
  }

  function updateSidebarAccount() {
    var link = document.getElementById('sidebarAccount');
    if (!link) return;
    if (isLoggedIn()) {
      link.href = 'my.html';
      link.innerHTML = '👤 我的帳戶';
      // Add tier badge
      fetchLoyaltyTierIcon(function(tierIcon) {
        if (tierIcon) {
          var tierBadge = document.createElement('span');
          tierBadge.className = 'tier-nav-badge';
          tierBadge.textContent = tierIcon;
          tierBadge.style.cssText = 'margin-left:4px;font-size:14px;';
          link.appendChild(tierBadge);
        }
      });
    } else {
      link.href = 'login.html';
      link.innerHTML = '👤 登入 / 註冊';
    }
  }

  // ─── Hamburger Sidebar ─────────────────────────────────────────
  function buildSidebar() {
    if (document.getElementById('sidebar-menu')) return;

    // Overlay
    var overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    overlay.className = 'sidebar-overlay';
    overlay.onclick = closeSidebar;

    // Sidebar
    var sidebar = document.createElement('div');
    sidebar.id = 'sidebar-menu';
    sidebar.className = 'sidebar-menu';

    // Header
    var sHeader = document.createElement('div');
    sHeader.className = 'sidebar-header';
    sHeader.innerHTML = '<span class="sidebar-logo">ZenPass</span>' +
      '<button class="sidebar-close" onclick="closeSidebar()" aria-label="關閉選單">✕</button>';
    sidebar.appendChild(sHeader);

    // Links
    var links = document.createElement('div');
    links.className = 'sidebar-links';
    for (var si = 0; si < SIDEBAR_LINKS.length; si++) {
      var item = SIDEBAR_LINKS[si];
      var a = document.createElement('a');
      a.href = item.href;
      a.className = 'sidebar-link';
      a.innerHTML = item.icon + ' ' + item.label;
      if (item.id) a.id = item.id;
      a.onclick = closeSidebar;
      links.appendChild(a);
    }
    sidebar.appendChild(links);

    // Version/credits footer
    var footer = document.createElement('div');
    footer.className = 'sidebar-footer';
    footer.textContent = 'ZenPass v1.0';
    sidebar.appendChild(footer);

    document.body.appendChild(overlay);
    document.body.appendChild(sidebar);
  }

  // ─── Hamburger Button (legacy — for pages WITHOUT page-header) ──
  function addLegacyHamburgerButton() {
    if (document.querySelector('.hamburger-btn')) return;

    var btn = document.createElement('button');
    btn.className = 'hamburger-btn';
    btn.setAttribute('aria-label', '開啟選單');
    btn.innerHTML = '☰';
    btn.onclick = function (e) {
      e.stopPropagation();
      openSidebar();
    };

    // Find best place: hero-top (index.html), .header, or floating
    var hero = document.querySelector('.hero-top');
    if (hero) {
      btn.classList.add('hero-hamburger');
      hero.style.display = 'flex';
      hero.style.alignItems = 'center';
      hero.appendChild(btn);
      return;
    }

    var header = document.querySelector('.header, .zen-header');
    if (header) {
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.appendChild(btn);
      return;
    }

    // Fallback
    btn.style.position = 'fixed';
    btn.style.top = '12px';
    btn.style.right = '12px';
    btn.style.zIndex = '9999';
    document.body.appendChild(btn);
  }

  // ─── Global Functions ──────────────────────────────────────────
  window.openSidebar = function () {
    var overlay = document.getElementById('sidebar-overlay');
    var sidebar = document.getElementById('sidebar-menu');
    if (!overlay || !sidebar) return;
    overlay.classList.add('active');
    sidebar.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  window.closeSidebar = function () {
    var overlay = document.getElementById('sidebar-overlay');
    var sidebar = document.getElementById('sidebar-menu');
    if (!overlay || !sidebar) return;
    overlay.classList.remove('active');
    sidebar.classList.remove('active');
    document.body.style.overflow = '';
  };

  window.toggleDarkMode = function () {
    document.documentElement.classList.toggle('dark');
    var isDark = document.documentElement.classList.contains('dark');
    var els = document.querySelectorAll('#themeToggle, #darkModeToggle');
    for (var i = 0; i < els.length; i++) {
      els[i].innerHTML = isDark ? '☀️' : '🌙';
    }
    localStorage.setItem('zenpass_dark', isDark ? '1' : '0');
  };

  // ─── Highlight active nav on load ──────────────────────────────
  function highlightActive() {
    var active = activeNav();
    if (!active) return;
    var items = document.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      if (el.dataset.nav === active) el.classList.add('active');
      else el.classList.remove('active');
    }
  }

  // ─── Unified Loading/Empty/Error State Helpers ────────────────
  window.showState = function (containerId, state, options) {
    var container = document.getElementById(containerId);
    if (!container) return;
    options = options || {};
    // Remove any existing state overlay
    var existing = container.querySelector('.state-overlay');
    if (existing) existing.remove();
    container.style.position = container.style.position || 'relative';

    if (state === 'loading') {
      var spinner = document.createElement('div');
      spinner.className = 'state-overlay zen-flex-center';
      spinner.style.cssText = 'position:absolute;inset:0;background:rgba(255,255,255,0.65);backdrop-filter:blur(2px);z-index:5;border-radius:12px;flex-direction:column;gap:12px;min-height:200px';
      spinner.innerHTML = '<div class="loading-spinner"></div><div style="color:var(--dark-700);font-size:13px;font-weight:500">' + (options.message || '載入中...') + '</div>';
      container.appendChild(spinner);
    } else if (state === 'empty') {
      var emptyEl = document.createElement('div');
      emptyEl.className = 'state-overlay zen-empty';
      emptyEl.style.cssText = 'position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px';
      emptyEl.innerHTML = '<div class="empty-icon">' + (options.icon || '📭') + '</div>' +
        '<div class="empty-title">' + (options.title || '暫無資料') + '</div>' +
        (options.message ? '<div class="empty-desc">' + options.message + '</div>' : '') +
        (options.action ? '<button onclick="' + options.action.fn + '" class="zen-btn zen-btn-primary zen-btn-small zen-mt-sm">' + options.action.label + '</button>' : '');
      container.appendChild(emptyEl);
    } else if (state === 'error') {
      var errorEl = document.createElement('div');
      errorEl.className = 'state-overlay';
      errorEl.style.cssText = 'position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;text-align:center';
      errorEl.innerHTML = '<div style="font-size:40px;margin-bottom:12px">❌</div>' +
        '<div style="font-size:16px;font-weight:600;margin-bottom:6px;color:var(--red-500)">' + (options.title || '載入失敗') + '</div>' +
        '<div style="font-size:13px;color:var(--dark-700);margin-bottom:16px;max-width:280px">' + (options.message || '請稍後再試') + '</div>' +
        (options.retryFn ? '<button onclick="(' + options.retryFn.toString() + ')()" class="zen-btn zen-btn-primary zen-btn-small">🔄 重新載入</button>' : '');
      container.appendChild(errorEl);
    } else if (state === 'data') {
      // Just remove overlay — data is already rendered
    }
  };

  window.showLoading = function (containerId) {
    showState(containerId, 'loading');
  };

  window.showEmpty = function (containerId, message, icon) {
    showState(containerId, 'empty', { message: message, icon: icon || '📭', title: '暫無資料' });
  };

  window.showError = function (containerId, message, retryFn) {
    showState(containerId, 'error', { message: message, title: '載入失敗', retryFn: retryFn });
  };

  window.hideState = function (containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var existing = container.querySelector('.state-overlay');
    if (existing) existing.remove();
  };

  // ─── Init ──────────────────────────────────────────────────────
  function init() {
    // Only inject nav for public-facing pages, not admin
    var page = currentPage();
    if (page.indexOf('admin') === 0 || page === 'admin.html') return;
    if (page === 'crm.html' || page === 'pos.html') return;
    if (page === 'report.html') return;

    buildSidebar();

    // Page header (config-driven)
    buildPageHeader();

    // Breadcrumbs (auto-inject after header)
    renderBreadcrumbs();

    // Bottom nav
    buildBottomNav();
    updateAccountTab();
    updateSidebarAccount();
    highlightActive();
    updateAuthHeader();

    // Legacy hamburger for pages without page-header
    var config = getPageConfig();
    if (!config.title) {
      addLegacyHamburgerButton();
    }

    // Re-run after dynamic content loads
    window.addEventListener('load', function () {
      updateAccountTab();
      updateSidebarAccount();
      highlightActive();
    });

    // Handle login state changes (e.g., after login/logout)
    window.addEventListener('storage', function (e) {
      if (e.key === 'zenpass_token' || e.key === 'token' || e.key === 'zenpass_user') {
        updateAccountTab();
        updateSidebarAccount();
        updateAuthHeader();
      }
    });

    // Check for cookie-based session (no localStorage token)
    if (typeof checkCookieSession === 'function') {
      checkCookieSession().then(function(loggedIn) {
        if (loggedIn) {
          updateAccountTab();
          updateSidebarAccount();
          updateAuthHeader();
        }
      }).catch(function() {});
    }

    // On resize
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (!isMobile()) {
          var sidebar = document.getElementById('sidebar-menu');
          if (sidebar && sidebar.classList.contains('active')) {
            closeSidebar();
          }
        }
      }, 250);
    });
  }

  // ─── Breadcrumbs ───────────────────────────────────────────────
  // Page title map for breadcrumb display
  const PAGE_NAMES = {
    'index.html': '首頁',
    'explore.html': '探索課程',
    'coaches.html': '教練',
    'class-detail.html': '課程詳情',
    'my.html': '我的帳戶',
    'my-bookings.html': '我的預約',
    'my-membership.html': '我的會籍',
    'profile.html': '編輯個人資料',
    'wallet.html': '錢包',
    'payment.html': '付款',
    'buy-credits.html': '購買 Credits',
    'notifications.html': '通知',
    'checkin.html': '簽到',
    'membership-tailwind.html': '會員計劃',
    'membership.html': '會籍方案',
    'badges.html': '勳章',
    'points.html': '積分中心',
    'referral.html': '推薦朋友',
    'faq.html': '常見問題',
    'about.html': '關於我們',
    'privacy.html': '私隱政策',
    'terms.html': '服務條款',
    'venues.html': '場地',
    'coach.html': '教練詳情',
    'coach-profile.html': '教練檔案',
    'coach-dashboard.html': '教練 Dashboard',
    'coach-apply.html': '成為教練',
    'partner-apply.html': '場地加盟',
    'partner-dashboard.html': '合作夥伴',
    'guides.html': '使用指南',
    'corporate-guide.html': '企業計劃',
    'corporate-hr.html': '企業 HR',
    'rate.html': '評價',
    'share.html': '分享',
  };

  /**
   * renderBreadcrumbs — inject breadcrumb trail at top of content area
   * Excludes: index, login, signup, onboarding, password-reset, verify-email
   * Call after nav.js loads on pages with ZENPASS_PAGE_CONFIG.title set
   */
  window.renderBreadcrumbs = function (extraTrail) {
    var page = currentPage();
    var skipPages = ['index.html','login.html','signup.html','onboarding.html','password-reset.html','verify-email.html','app-waitlist.html'];
    if (skipPages.indexOf(page) !== -1) return;

    // Remove existing breadcrumbs
    document.querySelectorAll('.zp-breadcrumbs').forEach(function(el) { el.remove(); });

    var crumbs = [];
    // Root: always link to index
    crumbs.push({ label: '🏠 首頁', href: 'index.html' });

    // Map sub-pages to parent sections
    var mySubPages = ['my-bookings.html','my-membership.html','wallet.html','payment.html','buy-credits.html','notifications.html','checkin.html','badges.html','points.html','referral.html','profile.html'];
    if (mySubPages.indexOf(page) !== -1) {
      crumbs.push({ label: '我的帳戶', href: 'my.html' });
    } else if (page === 'class-detail.html' || page === 'rate.html') {
      crumbs.push({ label: '探索課程', href: 'explore.html' });
    } else if (page === 'coach-profile.html' || page === 'coach.html') {
      crumbs.push({ label: '教練', href: 'coaches.html' });
    } else if (page === 'coach-dashboard.html') {
      crumbs.push({ label: '教練 Dashboard', href: 'coach-dashboard.html' });
    } else if (page === 'coach-apply.html') {
      crumbs.push({ label: '成為教練', href: 'coach-apply.html' });
    } else if (page === 'partner-apply.html' || page === 'partner-dashboard.html') {
      crumbs.push({ label: '合作夥伴', href: 'partners.html' });
    } else if (['about.html','faq.html','privacy.html','terms.html','guides.html'].indexOf(page) !== -1) {
      // No parent section for info pages, just root
    }

    // Current page
    var pageName = PAGE_NAMES[page] || page.replace('.html','').replace(/-/g,' ');
    crumbs.push({ label: pageName, href: null });

    // Extra trail (optional, for dynamic pages like class-detail)
    if (extraTrail && Array.isArray(extraTrail)) {
      // Insert extra items before the last crumb
      crumbs.pop(); // Remove current page
      extraTrail.forEach(function(item) { crumbs.push(item); });
      crumbs.push({ label: pageName, href: null });
    }

    // Build HTML
    var el = document.createElement('div');
    el.className = 'zp-breadcrumbs';
    el.style.cssText = 'padding:12px 24px 0;max-width:1024px;margin:0 auto;font-size:12px;opacity:0.7;display:flex;align-items:center;flex-wrap:wrap;gap:4px;';

    crumbs.forEach(function(crumb, idx) {
      if (idx > 0) {
        var sep = document.createElement('span');
        sep.textContent = '›';
        sep.style.cssText = 'margin:0 4px;color:var(--dark-700);font-size:14px;';
        el.appendChild(sep);
      }
      if (crumb.href) {
        var a = document.createElement('a');
        a.href = crumb.href;
        a.textContent = crumb.label;
        a.style.cssText = 'color:var(--orange-700);text-decoration:none;white-space:nowrap;';
        a.onmouseover = function() { this.style.textDecoration = 'underline'; };
        a.onmouseout = function() { this.style.textDecoration = 'none'; };
        el.appendChild(a);
      } else {
        var span = document.createElement('span');
        span.textContent = crumb.label;
        span.style.cssText = 'color:var(--dark-700);white-space:nowrap;';
        el.appendChild(span);
      }
    });

    // Insert at the top of the content, after page-header if present
    var header = document.querySelector('.page-header');
    if (header) {
      header.parentNode.insertBefore(el, header.nextSibling);
    } else {
      var content = document.querySelector('.max-w-5xl, .max-w-lg, .max-w-4xl, .container, main, .content');
      if (content) {
        content.parentNode.insertBefore(el, content);
      } else {
        document.body.insertBefore(el, document.body.firstChild);
      }
    }
  };

  // ─── Update auth buttons in header (on login state change) ─────
  function updateAuthHeader() {
    var authContainer = document.getElementById('auth-buttons');
    if (!authContainer) return;
    if (isLoggedIn()) {
      authContainer.innerHTML = '<a href="my.html" class="btn-solid-sm">👤 我的</a>';
    } else {
      authContainer.innerHTML = '<a href="login.html" class="btn-ghost-sm">登入</a><a href="signup.html" class="btn-solid-sm">註冊</a>';
    }
  }

  // ─── Lazy Load Images ──────────────────────────────────────────
  function initLazyImages() {
    if (!window.IntersectionObserver) {
      document.querySelectorAll('[data-bg]').forEach(function(el) {
        if (el.dataset.bg) { el.style.backgroundImage = el.dataset.bg; }
      });
      return;
    }

    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var el = entry.target;
          if (el.dataset.bg) {
            el.style.backgroundImage = el.dataset.bg;
            el.removeAttribute('data-bg');
          }
          observer.unobserve(el);
        }
      });
    }, { rootMargin: '200px', threshold: 0.01 });

    document.querySelectorAll('.modern-card-img .bg-img, .class-card-img-wrap, [class*="card-img"] .bg-img, [class*="hero-bg"]').forEach(function(el) {
      var bg = el.style.backgroundImage;
      if (bg && bg !== 'none' && !el.classList.contains('hero-bg-layer') && !el.classList.contains('hero-bg-workout')) {
        el.dataset.bg = bg;
        var rect = el.getBoundingClientRect();
        if (rect.top > window.innerHeight || rect.top + rect.height > window.innerHeight) {
          el.style.backgroundImage = 'none';
          observer.observe(el);
        }
      }
    });

    var mutationObserver = new MutationObserver(function() {
      document.querySelectorAll('.modern-card-img .bg-img[data-bg], [class*="card-img"] .bg-img[data-bg]').forEach(function(el) {
        if (el.dataset.bg && !el.style.backgroundImage || el.style.backgroundImage === 'none') {
          observer.observe(el);
        }
      });
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Run after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      init();
      setTimeout(initLazyImages, 500);
    });
  } else {
    init();
    setTimeout(initLazyImages, 500);
  }
})();
