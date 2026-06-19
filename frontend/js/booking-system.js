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
  if (!datetime || !currentCourse) return alert('\u8acb\u9078\u64c7\u6642\u6bb5');
  var btn = document.querySelector('.book-confirm');
  btn.textContent = '\u23f3 \u9810\u7d04\u4e2d...';
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
    alert('\u2705 \u9810\u7d04\u6210\u529f\uff01\n\n' + currentCourse.title + '\n' + datetime);
    closeBookingModal();
    updateAllBookingButtons();
  } catch(e) {
    alert('\u9810\u7d04\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
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