/**
 * ZenPass 禪流 — Social Share 功能
 * 支援 WhatsApp、Telegram、複製鏈接
 */

var SHARE_BASE_URL = 'https://zenpass.hk';

/**
 * 分享完成嘅課程
 * @param {number|string} bookingId - 預約 ID
 * @param {string} className - 課程名稱
 */
function shareBooking(bookingId, className) {
  var text = '啱啱喺 ZenPass 上完「' + className + '」！超正 🎉 推薦俾你～ https://zenpass.hk/class-detail.html?id=' + bookingId;
  showShareSheet(text, className);
}

/**
 * 分享課程詳情頁
 * @param {number|string} classId - 課程 ID
 * @param {string} className - 課程名稱
 */
function shareClass(classId, className) {
  var url = SHARE_BASE_URL + '/class-detail.html?id=' + classId;
  var text = '嚟緊想上「' + className + '」🤩 有冇興趣一齊去 ZenPass 玩？ ' + url;
  showShareSheet(text, className);
}

/**
 * 顯示分享選項 Sheet（底部彈出）
 * @param {string} text - 分享文字
 * @param {string} title - 分享標題
 */
function showShareSheet(text, title) {
  // 移除已存在嘅 sheet
  var existing = document.getElementById('share-sheet-overlay');
  if (existing) existing.remove();

  var encodedText = encodeURIComponent(text);
  var whatsappUrl = 'https://wa.me/?text=' + encodedText;
  var telegramUrl = 'https://t.me/share/url?url=' + encodeURIComponent(SHARE_BASE_URL) + '&text=' + encodedText;

  var overlay = document.createElement('div');
  overlay.id = 'share-sheet-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);z-index:1000;opacity:0;transition:opacity 0.3s;';
  overlay.onclick = function(e) { if (e.target === overlay) closeShareSheet(); };

  var sheet = document.createElement('div');
  sheet.style.cssText = 'position:fixed;bottom:-100%;left:0;right:0;background:#fff;border-radius:20px 20px 0 0;padding:24px;max-width:440px;margin:0 auto;transition:bottom 0.3s;box-shadow:0 -4px 24px rgba(0,0,0,0.15);z-index:1001;max-height:80vh;overflow-y:auto;';

  // Dark mode support
  var isDark = document.documentElement.classList.contains('dark');
  if (isDark) {
    sheet.style.background = '#18181b';
  }

  sheet.innerHTML = '' +
    '<div style="text-align:center;margin-bottom:16px;">' +
      '<div style="width:40px;height:4px;background:#e4e4e7;border-radius:2px;margin:0 auto 16px;"></div>' +
      '<h2 style="font-size:18px;font-weight:700;margin:0;' + (isDark ? 'color:#fafafa;' : '') + '">📤 分享</h2>' +
      '<p style="font-size:13px;color:#71717a;margin-top:4px;">分享俾朋友一齊玩！</p>' +
    '</div>' +
    '<div style="display:flex;gap:12px;justify-content:center;margin-bottom:20px;">' +
      // WhatsApp
      '<a href="' + whatsappUrl + '" target="_blank" rel="noopener noreferrer" style="display:flex;flex-direction:column;align-items:center;gap:6px;text-decoration:none;padding:12px;border-radius:12px;background:#25D36620;min-width:80px;transition:background 0.2s;" onmouseover="this.style.background=\'#25D36630\'" onmouseout="this.style.background=\'#25D36620\'">' +
        '<span style="font-size:32px;">💬</span>' +
        '<span style="font-size:12px;font-weight:600;color:#075e54;">WhatsApp</span>' +
      '</a>' +
      // Telegram
      '<a href="' + telegramUrl + '" target="_blank" rel="noopener noreferrer" style="display:flex;flex-direction:column;align-items:center;gap:6px;text-decoration:none;padding:12px;border-radius:12px;background:#0088CC20;min-width:80px;transition:background 0.2s;" onmouseover="this.style.background=\'#0088CC30\'" onmouseout="this.style.background=\'#0088CC20\'">' +
        '<span style="font-size:32px;">✈️</span>' +
        '<span style="font-size:12px;font-weight:600;color:#0088cc;">Telegram</span>' +
      '</a>' +
      // Copy Link
      '<a href="#" onclick="copyShareLink(event, \'' + encodeURIComponent(text) + '\')" style="display:flex;flex-direction:column;align-items:center;gap:6px;text-decoration:none;padding:12px;border-radius:12px;background:#71717a20;min-width:80px;transition:background 0.2s;" onmouseover="this.style.background=\'#71717a30\'" onmouseout="this.style.background=\'#71717a20\'">' +
        '<span style="font-size:32px;">🔗</span>' +
        '<span style="font-size:12px;font-weight:600;color:#52525b;">複製鏈接</span>' +
      '</a>' +
    '</div>' +
    '<button onclick="closeShareSheet()" style="display:block;width:100%;padding:12px;border:none;background:none;color:#71717a;font-size:14px;cursor:pointer;font-family:inherit;' + (isDark ? 'color:#a1a1aa;' : '') + '">取消</button>';

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  // Animate in
  setTimeout(function() {
    overlay.style.opacity = '1';
    sheet.style.bottom = '0';
  }, 10);
}

/** 關閉分享 Sheet */
function closeShareSheet() {
  var overlay = document.getElementById('share-sheet-overlay');
  if (!overlay) return;
  var sheet = overlay.querySelector('div:last-child');
  overlay.style.opacity = '0';
  if (sheet) sheet.style.bottom = '-100%';
  setTimeout(function() { overlay.remove(); }, 300);
}

/** 複製鏈接到剪貼簿 */
function copyShareLink(event, encodedText) {
  event.preventDefault();
  var text = decodeURIComponent(encodedText);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      showToast('✅ 鏈接已複製！');
      closeShareSheet();
    }).catch(function() {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

/** 後備複製方法 */
function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('✅ 鏈接已複製！');
    closeShareSheet();
  } catch (e) {
    showToast('❌ 複製失敗，請手動複製');
  }
  document.body.removeChild(ta);
}

/** 簡單 Toast 提示（與 my-bookings 一致） */
function showToast(text, type) {
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:#18181b;color:#fff;padding:12px 24px;border-radius:12px;font-size:14px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.2);max-width:90%;text-align:center;animation:fadeIn 0.3s ease';
  if (type === 'error') el.style.background = '#ef4444';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(function() { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(function() { el.remove(); }, 300); }, 2500);
}
