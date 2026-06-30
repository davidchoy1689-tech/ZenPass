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
    my:      { href: 'my.html',                   icon: '📅', label: '我的' },
    account: { href: 'login.html',                icon: '👤', label: '帳戶' },
  };

  const SIDEBAR_LINKS = [
    { href: 'explore.html',        icon: '🔍', label: '探索課程' },
    { href: 'coaches.html',        icon: '👥', label: '教練' },
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
    // Special cases for sub-pages that map to "my"
    var myPages = ['my-bookings.html','my-membership.html','wallet.html','notifications.html','checkin.html','points.html','buy-credits.html','profile.html','referral.html','badges.html','payment.html'];
    if (myPages.indexOf(page) !== -1) return 'my';
    return null;
  }

  function isLoggedIn() {
    return !!localStorage.getItem('zenpass_token') || !!localStorage.getItem('token');
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
        regLink.href = 'register.html';
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
      nav.appendChild(a);
    }

    document.body.appendChild(nav);
  }

  // ─── Update Account Tab (auth-aware) ────────────────────────────
  function updateAccountTab() {
    var link = document.getElementById('navAccount');
    if (!link) return;
    if (isLoggedIn()) {
      link.href = 'my.html';
      link.querySelector('.nav-label').textContent = '帳戶';
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
      if (e.key === 'zenpass_token' || e.key === 'token') {
        updateAccountTab();
        updateSidebarAccount();
        updateAuthHeader();
      }
    });

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

  // ─── Update auth buttons in header (on login state change) ─────
  function updateAuthHeader() {
    var authContainer = document.getElementById('auth-buttons');
    if (!authContainer) return;
    if (isLoggedIn()) {
      authContainer.innerHTML = '<a href="my.html" class="btn-solid-sm">👤 我的</a>';
    } else {
      authContainer.innerHTML = '<a href="login.html" class="btn-ghost-sm">登入</a><a href="register.html" class="btn-solid-sm">註冊</a>';
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
