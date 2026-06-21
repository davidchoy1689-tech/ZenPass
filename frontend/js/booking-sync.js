// ==================== ZenPass 預約狀態同步機制 ====================
// IndexedDB 主力 + localStorage fallback + 跨頁面即時同步
// Version: 4.0

const DB_NAME = 'ZenPassDB';
const STORE_NAME = 'bookings';

let dbInstance = null;
let bookedMap = new Map();

async function initIndexedDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        var store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('courseId', 'courseId', { unique: true });
        store.createIndex('datetime', 'datetime');
      }
    };
    req.onsuccess = function(e) { dbInstance = e.target.result; resolve(dbInstance); };
    req.onerror = function(e) { reject(e.target.error); };
  });
}

async function loadAllBookings() {
  try {
    var db = await initIndexedDB();
    var tx = db.transaction(STORE_NAME, 'readonly');
    var store = tx.objectStore(STORE_NAME);
    var all = await new Promise(function(resolve, reject) {
      var r = store.getAll();
      r.onsuccess = function() { resolve(r.result); };
      r.onerror = function() { reject(r.error); };
    });
    bookedMap.clear();
    all.forEach(function(b) { bookedMap.set(b.courseId, b); });
  } catch (err) {
    // IndexedDB fail → try localStorage
  }
  // Always merge from zenpass_booked (class-detail booking fallback)
  try {
    var localData = JSON.parse(localStorage.getItem('zenpass_booked') || '{}');
    Object.keys(localData).forEach(function(k) {
      var item = localData[k];
      if (!bookedMap.has(item.courseId || k)) {
        bookedMap.set(item.courseId || k, item);
      }
    });
  } catch(e) {}
}

async function bookCourse(bookingData) {
  var data = {
    courseId: bookingData.courseId,
    title: bookingData.title,
    instructor: bookingData.instructor,
    location: bookingData.location,
    datetime: bookingData.datetime,
    credits: bookingData.credits,
    status: 'confirmed',
    bookedAt: new Date().toISOString()
  };
  try {
    var db = await initIndexedDB();
    var tx = db.transaction(STORE_NAME, 'readwrite');
    var store = tx.objectStore(STORE_NAME);
    await new Promise(function(resolve, reject) {
      var r = store.put(data);
      r.onsuccess = function() { resolve(); };
      r.onerror = function() { reject(r.error); };
    });
  } catch (err) {
    bookedMap.set(bookingData.courseId, data);
    localStorage.setItem('zenpass_booked', JSON.stringify(Object.fromEntries(bookedMap)));
  }
  broadcastUpdate();
}

async function cancelCourse(courseId) {
  try {
    var db = await initIndexedDB();
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
    bookedMap.delete(courseId);
    localStorage.setItem('zenpass_booked', JSON.stringify(Object.fromEntries(bookedMap)));
  }
  broadcastUpdate();
}

function broadcastUpdate() {
  window.dispatchEvent(new CustomEvent('bookingUpdated', { detail: { timestamp: Date.now() } }));
}

function isBooked(courseId) {
  return bookedMap.has(courseId);
}

// ==================== 公開 API ====================
window.ZenPassBooking = {
  loadAllBookings: loadAllBookings,
  bookCourse: bookCourse,
  cancelCourse: cancelCourse,
  isBooked: isBooked,
  getAll: function() { return Object.fromEntries(bookedMap); }
};

// 跨頁面通知（其他分頁的 bookingUpdated 事件）
// booking-system.js 已監聽此事件用於更新按鈕狀態

// 跨頁面同步
window.addEventListener('storage', function(e) {
  if (e.key === 'zenpass_booked') {
    loadAllBookings().then(function() { broadcastUpdate(); });
  }
});

// DOMContentLoaded 時初始化
document.addEventListener('DOMContentLoaded', async function() {
  await loadAllBookings();
  window.dispatchEvent(new Event('bookingUpdated'));
});
