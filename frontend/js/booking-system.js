// Inject toast CSS
(function() {
  var s = document.createElement('style');
  s.textContent = '@keyframes toastIn{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}.toast-enter{animation:toastIn 0.3s ease}';
  document.head.appendChild(s);
})();

// ==================== Toast 通知 ====================
function showToast(title, message, icon) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.style.cssText = 'display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e4e4e7;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,0.1);padding:14px 18px;min-width:260px;max-width:340px;animation:fadeInUp 0.3s ease;pointer-events:auto';
  var dark = document.documentElement.classList.contains('dark');
  if (dark) toast.style.background = '#18181b'; toast.style.border = '1px solid #27272a';
  toast.innerHTML = '<span style="font-size:24px">' + (icon || '✅') + '</span>' +
    '<div style="flex:1"><div style="font-weight:600;font-size:14px;color:' + (dark?'#fafafa':'#18181b') + '">' + title + '</div>' +
    (message ? '<div style="font-size:12px;color:' + (dark?'#a1a1aa':'#71717a') + ';margin-top:2px">' + message + '</div>' : '') + '</div>' +
    '<button onclick="this.parentElement.remove()" style="background:none;border:none;color:#a1a1aa;font-size:16px;cursor:pointer;padding:4px">✕</button>';
  container.appendChild(toast);
  setTimeout(function() {
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    toast.style.opacity = '0'; toast.style.transform = 'translateY(10px)';
    setTimeout(function() { if (toast.parentElement) toast.remove(); }, 300);
  }, 3000);
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
  if (confirm('\u78ba\u5b9a\u53d6\u6d88\u6b64\u9810\u7d04\uff1f')) {
    if (window.ZenPassBooking) await window.ZenPassBooking.cancelCourse(courseId);
    alert('\u2705 \u9810\u7d04\u5df2\u53d6\u6d88');
    if (typeof renderBookings === 'function') renderBookings();
    updateAllBookingButtons();
  }
}

// Listen for updates from other tabs
window.addEventListener('bookingUpdated', function() {
  updateAllBookingButtons();
});

// Init
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(updateAllBookingButtons, 800);
});
