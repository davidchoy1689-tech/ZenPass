/**
 * nav.js — Unified Navigation Module
 * Injects: sticky bottom tab bar, hamburger sidebar overlay
 * Handles: active tab highlighting, auth-aware account link
 * Include via: <script src="js/nav.js"></script> at end of <body>
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
    const myPages = ['my-bookings.html','my-membership.html','wallet.html','notifications.html','checkin.html','points.html','buy-credits.html','profile.html','referral.html','badges.html','payment.html'];
    if (myPages.includes(page)) return 'my';
    return null;
  }

  function isLoggedIn() {
    return !!localStorage.getItem('token');
  }

  function isMobile() {
    return window.innerWidth < 768;
  }

  function isTabletOrBelow() {
    return window.innerWidth < 1024;
  }

  // ─── Bottom Tab Bar ─────────────────────────────────────────────
  function buildBottomNav() {
    if (document.querySelector('.bottom-nav')) return; // already exists

    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', '底部導航');

    const active = activeNav();
    for (const [key, page] of Object.entries(PAGES)) {
      const a = document.createElement('a');
      a.href = page.href;
      a.className = 'nav-item' + (active === key ? ' active' : '');
      a.dataset.nav = key;
      if (key === 'account') a.id = 'navAccount';
      a.innerHTML = `<span class="nav-icon">${page.icon}</span><span class="nav-label">${page.label}</span>`;
      nav.appendChild(a);
    }

    document.body.appendChild(nav);
  }

  // ─── Update Account Tab (auth-aware) ────────────────────────────
  function updateAccountTab() {
    const link = document.getElementById('navAccount');
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
    const link = document.getElementById('sidebarAccount');
    if (!link) return;
    if (isLoggedIn()) {
      link.href = 'my.html';
      link.textContent = '👤 我的帳戶';
    } else {
      link.href = 'login.html';
      link.textContent = '👤 登入 / 註冊';
    }
  }

  // ─── Hamburger Sidebar ─────────────────────────────────────────
  function buildSidebar() {
    if (document.getElementById('sidebar-menu')) return;

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    overlay.className = 'sidebar-overlay';
    overlay.onclick = closeSidebar;

    // Sidebar
    const sidebar = document.createElement('div');
    sidebar.id = 'sidebar-menu';
    sidebar.className = 'sidebar-menu';

    // Header
    const header = document.createElement('div');
    header.className = 'sidebar-header';
    header.innerHTML = '<span class="sidebar-logo">ZenPass</span>' +
      '<button class="sidebar-close" onclick="closeSidebar()" aria-label="關閉選單">✕</button>';
    sidebar.appendChild(header);

    // Links
    const links = document.createElement('div');
    links.className = 'sidebar-links';
    for (const item of SIDEBAR_LINKS) {
      const a = document.createElement('a');
      a.href = item.href;
      a.className = 'sidebar-link';
      a.innerHTML = `${item.icon} ${item.label}`;
      if (item.id) a.id = item.id;
      a.onclick = closeSidebar;
      links.appendChild(a);
    }
    sidebar.appendChild(links);

    // Version/credits footer
    const footer = document.createElement('div');
    footer.className = 'sidebar-footer';
    footer.textContent = 'ZenPass v1.0';
    sidebar.appendChild(footer);

    document.body.appendChild(overlay);
    document.body.appendChild(sidebar);
  }

  // ─── Hamburger Button ──────────────────────────────────────────
  function addHamburgerButton() {
    if (document.querySelector('.hamburger-btn')) return;

    // Try to find a good spot: existing headers, hero-tops, etc.
    // Prefer placing inside existing header structures
    const header = document.querySelector('.hero-top, .header, .zen-header, [class*="header"]');
    
    const btn = document.createElement('button');
    btn.className = 'hamburger-btn';
    btn.setAttribute('aria-label', '開啟選單');
    btn.innerHTML = '☰';
    btn.onclick = function (e) {
      e.stopPropagation();
      openSidebar();
    };

    if (header && isMobile()) {
      // Insert into existing header (right side)
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.appendChild(btn);
    } else {
      // Floating button as fallback
      btn.style.position = 'fixed';
      btn.style.top = '12px';
      btn.style.right = '12px';
      btn.style.zIndex = '9999';
      document.body.appendChild(btn);
    }
  }

  // ─── Inject Hamburger Into Hero Section (index.html specific) ──
  function addHeroHamburger() {
    const hero = document.querySelector('.hero-top');
    if (!hero) return;
    if (hero.querySelector('.hamburger-btn')) return;
    if (!isMobile()) return;

    const btn = document.createElement('button');
    btn.className = 'hamburger-btn hero-hamburger';
    btn.setAttribute('aria-label', '開啟選單');
    btn.innerHTML = '☰';
    btn.onclick = function (e) {
      e.stopPropagation();
      openSidebar();
    };
    hero.appendChild(btn);
  }

  // ─── Global Functions (used by onclick) ────────────────────────
  window.openSidebar = function () {
    const overlay = document.getElementById('sidebar-overlay');
    const sidebar = document.getElementById('sidebar-menu');
    if (!overlay || !sidebar) return;
    overlay.classList.add('active');
    sidebar.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  window.closeSidebar = function () {
    const overlay = document.getElementById('sidebar-overlay');
    const sidebar = document.getElementById('sidebar-menu');
    if (!overlay || !sidebar) return;
    overlay.classList.remove('active');
    sidebar.classList.remove('active');
    document.body.style.overflow = '';
  };

  // ─── Highlight active nav on load ──────────────────────────────
  function highlightActive() {
    const active = activeNav();
    if (!active) return;
    document.querySelectorAll('.nav-item').forEach(function (el) {
      if (el.dataset.nav === active) el.classList.add('active');
      else el.classList.remove('active');
    });
  }

  // ─── Prevent double bottom-nav on pages that already have it ──
  function deduplicateBottomNav() {
    const existing = document.querySelectorAll('.bottom-nav');
    if (existing.length > 1) {
      // Keep the first one (likely the manual one) — remove JS-injected duplicates
      for (let i = 1; i < existing.length; i++) {
        existing[i].remove();
      }
    }
  }

  // ─── Init ──────────────────────────────────────────────────────
  function init() {
    // Only inject nav for public-facing pages, not admin
    const page = currentPage();
    if (page.startsWith('admin') || page === 'admin.html') return;
    if (page === 'crm.html' || page === 'pos.html') return;

    buildSidebar();
    buildBottomNav();
    deduplicateBottomNav();
    updateAccountTab();
    updateSidebarAccount();
    highlightActive();

    // Add hamburger button to hero (index.html)
    addHeroHamburger();

    // Re-run after dynamic content loads
    window.addEventListener('load', function () {
      updateAccountTab();
      updateSidebarAccount();
      highlightActive();
    });

    // Handle login state changes (e.g., after login/logout)
    window.addEventListener('storage', function (e) {
      if (e.key === 'token') {
        updateAccountTab();
        updateSidebarAccount();
      }
    });

    // On resize, switch between mobile/desktop nav display
    let resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        const sidebarOpen = document.getElementById('sidebar-menu')?.classList.contains('active');
        if (!isMobile() && sidebarOpen) {
          closeSidebar();
        }
      }, 250);
    });
  }

  // Run after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
