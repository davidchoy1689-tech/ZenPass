// ==================== ZenPass Booking 跨頁面同步系統 (IndexedDB版) ====================
// 使用 IndexedDB 儲存 + localStorage 做跨頁面通知
// Version: 2.0

(function() {
  'use strict';
  
  var BOOKED_CACHE = {};        // In-memory cache for sync reads
  var NOTIFY_KEY = 'zp_notify';  // localStorage key for cross-tab notification
  var _initialized = false;
  
  // Load all bookings from IDB into cache
  async function loadCache() {
    try {
      if (typeof window.IDB === 'undefined') {
        // Fallback to localStorage
        var fallback = JSON.parse(localStorage.getItem('zenpass_booked') || '{}');
        BOOKED_CACHE = {};
        Object.keys(fallback).forEach(function(k) { BOOKED_CACHE[k] = fallback[k]; });
        return;
      }
      var all = await window.IDB.getAll();
      BOOKED_CACHE = {};
      all.forEach(function(b) {
        if (b.courseId) BOOKED_CACHE[b.courseId] = b;
      });
    } catch(e) { console.warn('IDB load failed, using localStorage fallback', e); }
  }
  
  // Sync cache back to IDB (for cross-tab consistency)
  async function syncToIDB() {
    // IDB already has the data from book/cancel operations
    // This ensures cache is fresh
  }
  
  // Notify other tabs
  function notifyTabs() {
    try {
      localStorage.setItem(NOTIFY_KEY, Date.now().toString());
    } catch(e) {}
  }
  
  window.ZenPassBooking = {
    // 讀取 cache (sync)
    getAll() {
      return BOOKED_CACHE;
    },
    
    // 新增預約
    async book(courseId, data) {
      if (typeof window.IDB !== 'undefined') {
        await window.IDB.add({
          courseId: courseId,
          title: data.title,
          instructor: data.instructor || '',
          location: data.location || '',
          datetime: data.datetime || '',
          credits: data.credits || 1,
          status: 'confirmed'
        });
      }
      // Update cache
      BOOKED_CACHE[courseId] = {
        title: data.title,
        instructor: data.instructor || '',
        location: data.location || '',
        datetime: data.datetime || '',
        credits: data.credits || 1,
        status: 'confirmed',
        bookedAt: new Date().toISOString()
      };
      // Fallback to localStorage
      try {
        var fb = JSON.parse(localStorage.getItem('zenpass_booked') || '{}');
        fb[courseId] = BOOKED_CACHE[courseId];
        localStorage.setItem('zenpass_booked', JSON.stringify(fb));
      } catch(e) {}
      notifyTabs();
      window.dispatchEvent(new Event('bookingUpdated'));
    },
    
    // 取消預約
    async cancel(courseId) {
      // IDB: find and delete by courseId
      if (typeof window.IDB !== 'undefined') {
        var bookings = await window.IDB.getByCourseId(courseId);
        for (var i = 0; i < bookings.length; i++) {
          await window.IDB.cancel(bookings[i].id);
        }
      }
      delete BOOKED_CACHE[courseId];
      // Fallback
      try {
        var fb = JSON.parse(localStorage.getItem('zenpass_booked') || '{}');
        delete fb[courseId];
        localStorage.setItem('zenpass_booked', JSON.stringify(fb));
      } catch(e) {}
      notifyTabs();
      window.dispatchEvent(new Event('bookingUpdated'));
    },
    
    // 強制重新載入 cache
    async refresh() {
      await loadCache();
      window.dispatchEvent(new Event('bookingUpdated'));
    }
  };
  
  // Update all page buttons
  window.updateAllBookingButtons = function() {
    document.querySelectorAll('.modern-card, .course-card').forEach(function(card) {
      var courseId = card.getAttribute('data-id');
      var btn = card.querySelector('.booking-btn');
      if (!courseId || !btn) return;
      var isBooked = BOOKED_CACHE[courseId] !== undefined;
      if (isBooked) {
        btn.textContent = '\u2705 \u5df2\u9810\u7d04';
        btn.style.background = '#a1a1aa'; btn.style.color = '#fff'; btn.style.cursor = 'default'; btn.style.boxShadow = 'none';
        btn.disabled = true;
        btn.onclick = function(e) { e.stopPropagation(); window.cancelBooking(courseId); };
      } else {
        btn.textContent = '\u7acb\u5373\u9810\u7d04';
        btn.style.background = ''; btn.style.color = ''; btn.style.cursor = ''; btn.style.boxShadow = '';
        btn.disabled = false;
        btn.onclick = function(e) { e.stopPropagation(); handleBookingClick(btn); };
      }
    });
  };
  
  // Cross-tab sync via localStorage
  window.addEventListener('storage', function(e) {
    if (e.key === NOTIFY_KEY || e.key === 'zenpass_booked') {
      loadCache().then(function() {
        window.dispatchEvent(new Event('bookingUpdated'));
        updateAllBookingButtons();
      });
    }
  });
  
  // Init
  document.addEventListener('DOMContentLoaded', function() {
    loadCache().then(function() {
      _initialized = true;
      setTimeout(updateAllBookingButtons, 500);
    });
  });
})();
