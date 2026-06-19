// ==================== ZenPass Booking System - 最終整合版 ====================
// IndexedDB 主力 + localStorage fallback
// Version: 3.0

let currentCourse = null;
let bookedCourses = {};

const DB_NAME = 'ZenPassDB';
const STORE_NAME = 'bookings';

async function initDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        var store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('courseId', 'courseId', { unique: false });
        store.createIndex('datetime', 'datetime', { unique: false });
      }
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = function(e) { reject(e.target.error); };
  });
}

async function loadBookings() {
  try {
    var db = await initDB();
    var tx = db.transaction(STORE_NAME, 'readonly');
    var store = tx.objectStore(STORE_NAME);
    var all = await new Promise(function(resolve, reject) {
      var r = store.getAll();
      r.onsuccess = function() { resolve(r.result); };
      r.onerror = function() { reject(r.error); };
    });
    bookedCourses = {};
    all.forEach(function(b) { bookedCourses[b.courseId] = b; });
    return bookedCourses;
  } catch (err) {
    bookedCourses = JSON.parse(localStorage.getItem('zenpass_booked') || '{}');
    return bookedCourses;
  }
}

async function addBooking(bookingData) {
  var data = Object.assign({}, bookingData, { status: 'confirmed', bookedAt: new Date().toISOString() });
  try {
    var db = await initDB();
    var tx = db.transaction(STORE_NAME, 'readwrite');
    var store = tx.objectStore(STORE_NAME);
    await new Promise(function(resolve, reject) {
      var r = store.add(data);
      r.onsuccess = function() { resolve(); };
      r.onerror = function() { reject(r.error); };
    });
  } catch (err) {
    bookedCourses[bookingData.courseId] = data;
    localStorage.setItem('zenpass_booked', JSON.stringify(bookedCourses));
  }
  window.dispatchEvent(new Event('bookingUpdated'));
}

async function cancelBooking(courseId) {
  try {
    var db = await initDB();
    var tx = db.transaction(STORE_NAME, 'readwrite');
    var store = tx.objectStore(STORE_NAME);
    var index = store.index('courseId');
    var records = await new Promise(function(resolve, reject) {
      var r = index.getAll(courseId);
      r.onsuccess = function() { resolve(r.result); };
      r.onerror = function() { reject(r.error); };
    });
    for (var i = 0; i < records.length; i++) {
      await new Promise(function(resolve, reject) {
        var r = store.delete(records[i].id);
        r.onsuccess = function() { resolve(); };
        r.onerror = function() { reject(r.error); };
      });
    }
  } catch (err) {
    delete bookedCourses[courseId];
    localStorage.setItem('zenpass_booked', JSON.stringify(bookedCourses));
  }
  window.dispatchEvent(new Event('bookingUpdated'));
}

// ==================== Button 狀態管理 ====================
function updateAllBookingButtons() {
  document.querySelectorAll('.modern-card, .course-card').forEach(function(card) {
    var id = card.getAttribute('data-id');
    var btn = card.querySelector('.booking-btn');
    if (!id || !btn) return;
    if (bookedCourses[id]) {
      btn.textContent = '\u2705 \u5df2\u9810\u7d04';
      btn.style.background = '#a1a1aa'; btn.style.color = '#fff'; btn.style.cursor = 'default'; btn.style.boxShadow = 'none';
      btn.disabled = true;
      btn.onclick = function(e) { e.stopPropagation(); cancelBooking(id).then(updateAllBookingButtons); };
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

// ==================== Modal 相關 ====================
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
  document.getElementById('modal-course-title').style.display = 'block';
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
  document.getElementById('modal-remaining').textContent = currentCourse.spots || '\u5145\u8db3';

  var sel = document.getElementById('modal-datetime');
  sel.innerHTML = '<option value="">\u8acb\u9078\u64c7\u6642\u6bb5</option>' +
    '<option value="today-0930">\u4eca\u5929 09:30 - 10:30</option>' +
    '<option value="today-1800">\u4eca\u5929 18:00 - 19:00</option>' +
    '<option value="tomorrow-1200">\u660e\u5929 12:00 - 13:00</option>';

  var modal = document.getElementById('booking-modal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  _syncModalDark && _syncModalDark();
}

async function confirmBooking() {
  var datetime = document.getElementById('modal-datetime').value;
  if (!datetime || !currentCourse) return alert('\u8acb\u9078\u64c7\u6642\u6bb5');
  var btn = document.querySelector('.book-confirm');
  btn.textContent = '\u23f3 \u9810\u7d04\u4e2d...';
  btn.disabled = true;
  try {
    await addBooking({
      courseId: currentCourse.courseId,
      title: currentCourse.title,
      instructor: currentCourse.instructor,
      location: currentCourse.location,
      datetime: datetime,
      credits: currentCourse.credits
    });
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

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async function() {
  await loadBookings();
  setTimeout(updateAllBookingButtons, 500);
  window.addEventListener('bookingUpdated', async function() {
    await loadBookings();
    updateAllBookingButtons();
  });
  // Cross-tab via storage event
  window.addEventListener('storage', function(e) {
    if (e.key === 'zenpass_booked') {
      loadBookings().then(updateAllBookingButtons);
    }
  });
});
