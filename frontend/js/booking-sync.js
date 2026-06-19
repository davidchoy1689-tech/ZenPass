// ==================== ZenPass Booking Sync ====================
// Shared across all pages — updates buttons when localStorage changes
// Version: 1.0

(function() {
  var KEY = 'zenpass_booked';
  
  // Read all bookings
  window.getBookings = function() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch(e) { return {}; }
  };
  
  // Check if a course is booked
  window.isBooked = function(id) {
    var data = getBookings();
    return !!data[id];
  };
  
  // Update a single button's state
  window.updateButtonState = function(btn, courseId) {
    if (!btn || !courseId) return;
    var data = getBookings();
    if (data[courseId]) {
      btn.textContent = '\u2705 \u5df2\u9810\u7d04';
      btn.style.background = '#a1a1aa'; btn.style.color = '#fff'; btn.style.cursor = 'pointer'; btn.style.boxShadow = 'none';
      btn.disabled = false;
      btn.onclick = function(e) { e.stopPropagation(); showCancelConfirm(courseId, btn); };
    } else {
      btn.textContent = '\u7acb\u5373\u9810\u7d04';
      btn.style.background = ''; btn.style.color = ''; btn.style.cursor = ''; btn.style.boxShadow = '';
      btn.disabled = false;
      btn.onclick = function(e) { e.stopPropagation(); handleBookingClick(btn); };
    }
  };
  
  // Update all buttons on the current page
  window.updateAllBookingButtons = function() {
    document.querySelectorAll('.modern-card, .course-card').forEach(function(card) {
      var courseId = card.getAttribute('data-id');
      var btn = card.querySelector('.booking-btn');
      if (courseId && btn) updateButtonState(btn, courseId);
    });
  };
  
  // Cancel booking
  window.showCancelConfirm = function(courseId, btn) {
    var data = getBookings();
    if (confirm('\u78ba\u5b9a\u8981\u53d6\u6d88\u9810\u7d04\u300c' + (data[courseId]?.title || '\u6b64\u8ab2\u7a0b') + '\u300d\uff1f')) {
      delete data[courseId];
      localStorage.setItem(KEY, JSON.stringify(data));
      updateButtonState(btn, courseId);
      alert('\u2705 \u9810\u7d04\u5df2\u53d6\u6d88');
    }
  };
  
  // Listen for storage changes from other tabs/windows
  window.addEventListener('storage', function(e) {
    if (e.key === KEY) {
      updateAllBookingButtons();
    }
  });
  
  // Init on page load
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(updateAllBookingButtons, 500);
  });
})();
