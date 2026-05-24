/**
 * ZenPass 禪流 — 共用 UI 工具
 * 所有頁面通用嘅互動元件
 * 確保每個頁面嘅 <head> 都會 load 呢個 script
 */

;(function() {
  var Z = window.ZenPass = window.ZenPass || {};

  /* ----- Toast 通知系統 ----- */
  Z.toast = function(msg, type) {
    type = type || 'success';
    // Remove existing container if stale
    var c = document.getElementById('zp-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'zp-toast-container';
      c.style.cssText = [
        'position:fixed;top:16px;left:50%;transform:translateX(-50%);',
        'z-index:9999;display:flex;flex-direction:column;gap:8px;',
        'align-items:center;pointer-events:none;',
        'width:calc(100% - 32px);max-width:400px;'
      ].join('');
      document.body.appendChild(c);
    }
    var t = document.createElement('div');
    var icons = { success:'✅', error:'❌', info:'ℹ️', warning:'⚠️' };
    t.style.cssText = [
      'pointer-events:auto;',
      'background:#fff;border-radius:12px;padding:14px 18px;',
      'box-shadow:0 4px 20px rgba(0,0,0,0.12);',
      'display:flex;align-items:center;gap:10px;',
      'font-size:14px;font-weight:500;width:100%;',
      'animation:zpToastIn 0.3s ease-out;',
      'border-left:4px solid ' + (type === 'error' ? '#ef4444' : type === 'info' ? '#3b82f6' : '#059669')
    ].join('');
    t.innerHTML = '<span style="font-size:20px;flex-shrink:0">' + (icons[type]||'✅') + '</span>'
      + '<span style="flex:1">' + Z.escHtml(msg) + '</span>';
    c.appendChild(t);
    setTimeout(function() {
      t.style.animation = 'zpToastOut 0.3s ease-in forwards';
      setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 2800);
  };

  /* ----- Modal 對話框 ----- */
  Z.modal = function(opts) {
    var overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed;top:0;left:0;right:0;bottom:0;',
      'background:rgba(0,0,0,0.5);z-index:9998;',
      'display:flex;align-items:center;justify-content:center;',
      'padding:20px;animation:zpFadeIn 0.2s ease-out;'
    ].join('');
    var modal = document.createElement('div');
    modal.style.cssText = [
      'background:#fff;border-radius:16px;padding:24px;',
      'max-width:340px;width:100%;text-align:center;',
      'box-shadow:0 10px 40px rgba(0,0,0,0.15);',
      'animation:zpModalIn 0.25s ease-out;'
    ].join('');
    modal.innerHTML = [
      opts.icon ? '<div style="font-size:48px;margin-bottom:10px">' + opts.icon + '</div>' : '',
      opts.title ? '<div style="font-size:18px;font-weight:700;margin-bottom:6px">' + Z.escHtml(opts.title) + '</div>' : '',
      opts.desc ? '<div style="font-size:14px;color:#6b7280;margin-bottom:16px;line-height:1.5">' + Z.escHtml(opts.desc) + '</div>' : '',
      opts.confirmText ? '<button class="zp-modal-btn primary">' + Z.escHtml(opts.confirmText) + '</button>' : '',
      opts.cancelText ? '<button class="zp-modal-btn secondary" style="margin-top:6px">' + Z.escHtml(opts.cancelText) + '</button>' : ''
    ].join('');
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    if (opts.confirmText) {
      modal.querySelector('.primary').onclick = function() {
        document.body.removeChild(overlay);
        if (opts.onConfirm) opts.onConfirm();
      };
    }
    if (opts.cancelText) {
      modal.querySelector('.secondary').onclick = function() {
        document.body.removeChild(overlay);
        if (opts.onCancel) opts.onCancel();
      };
    }
    overlay.onclick = function(e) {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        if (opts.onCancel) opts.onCancel();
      }
    };
    return { close: function() { if (overlay.parentNode) document.body.removeChild(overlay); } };
  };

  /* ----- Loading Overlay ----- */
  Z.showLoading = function(text) {
    text = text || '載入中...';
    var el = document.createElement('div');
    el.id = 'zp-loading';
    el.style.cssText = [
      'position:fixed;top:0;left:0;right:0;bottom:0;',
      'background:rgba(255,255,255,0.7);z-index:9997;',
      'display:flex;align-items:center;justify-content:center;'
    ].join('');
    el.innerHTML = '<div style="text-align:center"><div style="display:inline-block;width:36px;height:36px;border:3px solid #e5e7eb;border-top:3px solid #ff6b35;border-radius:50%;animation:zpSpin 0.8s linear infinite;margin-bottom:8px"></div><div style="font-size:13px;color:#6b7280">' + Z.escHtml(text) + '</div></div>';
    document.body.appendChild(el);
    return { hide: function() { if (el.parentNode) el.parentNode.removeChild(el); } };
  };

  /* ----- HTML 轉義 ----- */
  Z.escHtml = function(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  };

  /* ----- 格式化時間 ----- */
  Z.formatDate = function(dateStr) {
    var d = new Date(dateStr);
    var months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    return d.getDate() + ' ' + months[d.getMonth()];
  };
  Z.formatTime = function(dateStr) {
    var d = new Date(dateStr);
    return ('0'+d.getHours()).slice(-2) + ':' + ('0'+d.getMinutes()).slice(-2);
  };
  Z.formatDateTime = function(dateStr) {
    return Z.formatDate(dateStr) + ' ' + Z.formatTime(dateStr);
  };

  /* ----- 自動注入 CSS keyframes ----- */
  (function() {
    var id = 'zp-keyframes';
    if (document.getElementById(id)) return;
    var s = document.createElement('style');
    s.id = id;
    s.textContent = [
      '@keyframes zpSpin { to { transform: rotate(360deg); } }',
      '@keyframes zpToastIn { from { opacity:0;transform:translateY(-20px) scale(0.95); } to { opacity:1;transform:translateY(0) scale(1); } }',
      '@keyframes zpToastOut { from { opacity:1;transform:translateY(0) scale(1); } to { opacity:0;transform:translateY(-20px) scale(0.95); } }',
      '@keyframes zpFadeIn { from { opacity:0; } to { opacity:1; } }',
      '@keyframes zpModalIn { from { opacity:0;transform:scale(0.92) translateY(10px); } to { opacity:1;transform:scale(1) translateY(0); } }',
      '.zp-modal-btn { width:100%;padding:12px;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;font-family:-apple-system,sans-serif;transition:all 0.15s; }',
      '.zp-modal-btn.primary { background:#c94420;color:white; }',
      '.zp-modal-btn.primary:hover { background:#e55a2b; }',
      '.zp-modal-btn.secondary { background:#f3f4f6;color:#6b7280; }',
      '.zp-modal-btn:hover { opacity:0.9;transform:translateY(-1px); }',
      '.zp-modal-btn:active { transform:scale(0.97); }'
    ].join('\n');
    document.head.appendChild(s);
  })();

  /* ----- 共用 Bottom Nav 高亮 ----- */
  Z.highlightNav = function(page) {
    document.querySelectorAll('.nav-item').forEach(function(el) {
      var href = el.getAttribute('href');
      el.classList.toggle('active', href && href.indexOf(page) > -1);
    });
  };

  /* ----- 登入狀態檢查 ----- */
  Z.isLoggedIn = function() {
    return !!localStorage.getItem('zenpass_token');
  };
  Z.getUser = function() {
    try { return JSON.parse(localStorage.getItem('zenpass_user') || '{}'); } catch(e) { return {}; }
  };

  /* ----- 初始化執行 ----- */
  Z.init = function() {
    // Auto-highlight bottom nav
    var path = window.location.pathname.split('/').pop() || 'index.html';
    Z.highlightNav(path.replace('.html',''));
    // Show logged-in state
    var btns = document.getElementById('auth-buttons');
    if (btns && Z.isLoggedIn()) {
      var user = Z.getUser();
      btns.innerHTML = '<a href="my.html" class="zen-btn-ghost" style="font-size:13px">👤 ' + (user.name || '我的') + '</a>';
    }
  };

  // Auto-run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', Z.init);
  } else {
    Z.init();
  }

})();
