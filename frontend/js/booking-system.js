// Inject toast CSS
(function() {
  var s = document.createElement('style');
  s.textContent = '@keyframes toastIn{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}.toast-enter{animation:toastIn 0.3s ease}';
  document.head.appendChild(s);
})();

// ==================== Toast 通知 ====================
function showToast(title, message, type) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var tmpl = document.getElementById('toast-template');
  if (!tmpl) return;
  var toast = tmpl.content.cloneNode(true).querySelector('.toast');
  toast.querySelector('#toast-icon').textContent = type === 'error' ? '❌' : type === 'info' ? 'ℹ️' : '✅';
  toast.querySelector('#toast-title').textContent = title;
  toast.querySelector('#toast-message').textContent = message || '';
  if (type === 'error') toast.style.borderColor = '#ef4444';
  else if (type === 'success') toast.style.borderColor = '#10b981';
  var dark = document.documentElement.classList.contains('dark');
  if (dark) { toast.style.background = '#18181b'; toast.querySelector('#toast-title').style.color = '#fafafa'; toast.querySelector('#toast-message').style.color = '#a1a1aa'; }
  container.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) { toast.style.transition = 'opacity 0.3s'; toast.style.opacity = '0'; setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300); } }, 4500);
}

// ==================== ZenPass Booking System UI Layer ====================
// Uses ZenPassBooking from booking-sync.js for data, handles UI

let currentCourse = null;

function updateAllBookingButtons() {
  document.querySelectorAll('.modern-card, .course-card').forEach(function(card) {
    var id = card.getAttribute('data-id');
    var btn = card.querySelector('.booking-btn');
    if (!id || !btn) return;
    if (window.ZenPassBooking && window.ZenPassBooking.isBooked(id)) {
      btn.textContent = '\u2705 \u5df2\u9810\u7d04';
      btn.style.background = '#a1a1aa'; btn.style.color = '#fff'; btn.style.cursor = 'default'; btn.style.boxShadow = 'none';
      btn.disabled = true;
      btn.onclick = function(e) { e.stopPropagation(); cancelBooking(id); };
    } else {
      btn.textContent = '\u7acb\u5373\u9810\u7d04';
      btn.style.background = ''; btn.style.color = ''; btn.style.cursor = ''; btn.style.boxShadow = '';
      btn.disabled = false;
      btn.onclick = function(e) { e.stopPropagation(); handleBookingClick(btn); };
    }
  });
}

function handleBookingClick(btn) {
  var card = btn.closest('.modern-card, .course-card');
  if (!card) return;
  openBookingModal(card);
}

function openBookingModal(card) {
  currentCourse = {
    courseId: card.getAttribute('data-id'),
    title: card.getAttribute('data-title') || card.querySelector('.modern-card-title')?.textContent?.trim() || '',
    instructor: card.getAttribute('data-instructor') || '',
    location: card.getAttribute('data-location') || '',
    image: card.getAttribute('data-image') || card.querySelector('img')?.src || '',
    credits: parseInt(card.getAttribute('data-credits')) || 1,
    time: card.getAttribute('data-time') || ''
  };

  document.getElementById('modal-course-title').textContent = '\u9810\u7d04\u8ab2\u7a0b';
  document.getElementById('modal-course-name').textContent = currentCourse.title;
  document.getElementById('modal-instructor').textContent = currentCourse.instructor;
  document.getElementById('modal-location').textContent = currentCourse.location + ' \u00b7 ' + currentCourse.time;

  var imgEl = document.getElementById('modal-course-img');
  if (currentCourse.image) {
    imgEl.style.backgroundImage = "url('" + currentCourse.image + "')";
    imgEl.style.backgroundSize = 'cover'; imgEl.innerHTML = '';
  } else {
    imgEl.style.background = 'var(--gray-100)';
    imgEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:28px">\U0001f4c5</div>';
  }

  document.getElementById('modal-credits').textContent = currentCourse.credits + ' Pass';
  document.getElementById('modal-remaining').textContent = card.getAttribute('data-spots') || '\u5145\u8db3';

  var sel = document.getElementById('modal-datetime');
  sel.innerHTML = '<option value="">\u8acb\u9078\u64c7\u6642\u6bb5</option>' +
    '<option value="today-0930">\u4eca\u5929 09:30 - 10:30</option>' +
    '<option value="today-1800">\u4eca\u5929 18:00 - 19:00</option>' +
    '<option value="tomorrow-1200">\u660e\u5929 12:00 - 13:00</option>';

  var modal = document.getElementById('booking-modal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  if (typeof _syncModalDark === 'function') _syncModalDark();
}

async function confirmBooking() {
  var datetime = document.getElementById('modal-datetime').value;
  if (!datetime || !currentCourse) return showToast('請選擇時段', '', 'info');
  var btn = document.querySelector('.book-confirm');
  btn.textContent = '⏳ 預約中...';
  btn.disabled = true;
  try {
    if (window.ZenPassBooking) {
      await window.ZenPassBooking.bookCourse({
        courseId: currentCourse.courseId,
        title: currentCourse.title,
        instructor: currentCourse.instructor,
        location: currentCourse.location,
        datetime: datetime,
        credits: currentCourse.credits
      });
    }
    showToast('✅ 預約成功！', currentCourse.title + '· ' + datetime, 'success');
    closeBookingModal();
    updateAllBookingButtons();
  } catch(e) {
    showToast('預約失敗', '請稍後再試', 'error');
  }
}

function closeBookingModal() {
  var modal = document.getElementById('booking-modal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
  var btn = document.querySelector('.book-confirm');
  if (btn) { btn.textContent = '\u78ba\u8a8d\u9810\u7d04'; btn.disabled = false; }
}

async function cancelBooking(courseId) {
  if (!confirm('確定要取消此預約嗎？')) return;
  try {
    if (window.ZenPassBooking) await window.ZenPassBooking.cancelCourse(courseId);
    showToast('預約已取消', '您的課程預約已成功取消。如需重新預約，請再次選擇時段。', 'info');
    if (typeof renderBookings === 'function') renderBookings();
    updateAllBookingButtons();
    setTimeout(function() {
      showToast('取消確認電郵已寄出', '取消詳情已發送到您的註冊電郵', 'info');
    }, 800);
  } catch(err) {
    showToast('取消失敗', '請稍後再試', 'error');
  }
}

// Listen for updates from other tabs
window.addEventListener('bookingUpdated', function() {
  updateAllBookingButtons();
});

// ==================== 通知中心 + Email 模擬 ====================
var _notifications = JSON.parse(localStorage.getItem('zenpass_notifications')) || [];

function addNotification(title, message, type) {
  var n = { id: Date.now(), title: title, message: message || '', type: type || 'info', time: new Date().toLocaleTimeString('zh-HK', {hour:'2-digit',minute:'2-digit'}), read: false };
  _notifications.unshift(n);
  if (_notifications.length > 30) _notifications.pop();
  localStorage.setItem('zenpass_notifications', JSON.stringify(_notifications));
  renderNotifications();
  updateNotificationCount();
}

function renderNotifications() {
  var list = document.getElementById('notification-list');
  if (!list) return;
  if (_notifications.length === 0) {
    list.innerHTML = '<div style="padding:32px;text-align:center;color:#a1a1aa;font-size:13px">暫無新通知</div>';
    return;
  }
  list.innerHTML = _notifications.map(function(n) {
    return '<div style="padding:14px 16px;border-bottom:1px solid #f4f4f5;cursor:pointer;opacity:' + (n.read ? '0.6' : '1') + '" onclick="markNotifRead(' + n.id + ')">' +
      '<div style="display:flex;justify-content:space-between"><span style="font-weight:600;font-size:13px">' + n.title + '</span><span style="font-size:11px;color:#a1a1aa">' + n.time + '</span></div>' +
      (n.message ? '<div style="font-size:12px;color:#71717a;margin-top:4px">' + n.message + '</div>' : '') + '</div>';
  }).join('');
}

function updateNotificationCount() {
  var unread = 0; _notifications.forEach(function(n){ if(!n.read) unread++; });
  var badge = document.getElementById('notification-count');
  if (!badge) return;
  if (unread > 0) { badge.style.display = 'flex'; badge.textContent = unread > 9 ? '9+' : unread; }
  else { badge.style.display = 'none'; }
}

function markNotifRead(id) {
  _notifications = _notifications.map(function(n){ return n.id === id ? Object.assign({}, n, {read: true}) : n; });
  localStorage.setItem('zenpass_notifications', JSON.stringify(_notifications));
  renderNotifications();
  updateNotificationCount();
}

function toggleNotify() {
  var panel = document.getElementById('notification-center');
  if (!panel) return;
  if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  renderNotifications();
  setTimeout(function() {
    document.addEventListener('click', function closeN(e) {
      if (!e.target.closest('#notification-center') && !e.target.closest('[onclick*="toggleNotify"]')) {
        panel.style.display = 'none';
        document.removeEventListener('click', closeN);
      }
    });
  }, 100);
}

function showEmailPreview(subject, content) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:300;padding:16px';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = '<div style="background:var(--white);border-radius:24px;max-width:480px;width:100%;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.2)">' +
    '<div style="background:#059669;padding:20px 24px;color:#fff"><div style="font-size:11px;opacity:0.7">zenpass.hk</div><div style="font-size:15px;font-weight:600">ZenPass 禪流</div></div>' +
    '<div style="padding:24px"><div style="font-size:18px;font-weight:700;margin-bottom:16px">' + subject + '</div>' +
    '<div style="font-size:14px;line-height:1.6;color:var(--dark-700)">' + content + '</div></div>' +
    '<div style="padding:16px 24px;border-top:1px solid var(--gray-200);text-align:center;font-size:11px;color:#a1a1aa">此為系統模擬電郵 • 如有問題請聯絡 support@zenpass.hk</div></div>';
  document.body.appendChild(overlay);
}

// Auto-add notification on booking + email preview
var _origConfirm = confirmBooking;
confirmBooking = function() {
  var result = _origConfirm.apply(this, arguments);
  if (currentCourse) {
    addNotification('✅ 預約成功', currentCourse.title, 'success');
    setTimeout(function() {
      showEmailPreview('預約確認 - ' + currentCourse.title, '親愛的會員：<br><br>你已成功預約以下課程：<br><br>📅 時間：' + (document.getElementById('modal-datetime')?.value || '') + '<br>📍 地點：' + currentCourse.location + '<br>👤 教練：' + currentCourse.instructor + '<br><br>請於課堂開始前 10 分鐘到達場地。<br>如需取消，請於開課 12 小時前操作。<br><br>ZenPass 禪流團隊');
    }, 1500);
  }
  return result;
};
// Init on load
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(updateAllBookingButtons, 800);
  // Dark mode for notif panel
  var dark = document.documentElement.classList.contains('dark');
  var p = document.getElementById('notif-panel');
  if (p && dark) { p.style.background = '#18181b'; p.style.borderColor = '#27272a'; }
});