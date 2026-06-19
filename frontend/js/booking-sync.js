// ==================== ZenPass Booking 跨頁面同步系統 ====================
let bookedCourses = JSON.parse(localStorage.getItem('zenpass_booked')) || {};

window.ZenPassBooking = {
  getAll() {
    return bookedCourses;
  },

  book(courseId, data) {
    bookedCourses[courseId] = {
      ...data,
      bookedAt: new Date().toISOString()
    };
    localStorage.setItem('zenpass_booked', JSON.stringify(bookedCourses));
    this.broadcastUpdate();
  },

  cancel(courseId) {
    delete bookedCourses[courseId];
    localStorage.setItem('zenpass_booked', JSON.stringify(bookedCourses));
    this.broadcastUpdate();
  },

  // 廣播更新給其他分頁
  broadcastUpdate() {
    window.dispatchEvent(new Event('bookingUpdated'));
  }
};

// 監聽其他分頁的 localStorage 變化
window.addEventListener('storage', (e) => {
  if (e.key === 'zenpass_booked') {
    bookedCourses = JSON.parse(e.newValue || '{}');
    window.dispatchEvent(new Event('bookingUpdated'));
  }
});

// 更新所有頁面 button 狀態
window.updateAllBookingButtons = function() {
  document.querySelectorAll('.modern-card, .course-card').forEach(function(card) {
    var courseId = card.getAttribute('data-id');
    var btn = card.querySelector('.booking-btn');
    if (!courseId || !btn) return;
    var isBooked = bookedCourses[courseId] !== undefined;
    if (isBooked) {
      btn.textContent = '✅ 已預約';
      btn.style.background = '#a1a1aa'; btn.style.color = '#fff'; btn.style.cursor = 'default'; btn.style.boxShadow = 'none';
      btn.disabled = true;
      btn.onclick = function(e) { e.stopPropagation(); window.cancelBooking(courseId); };
    } else {
      btn.textContent = '立即預約';
      btn.style.background = ''; btn.style.color = ''; btn.style.cursor = ''; btn.style.boxShadow = '';
      btn.disabled = false;
      btn.onclick = function(e) { e.stopPropagation(); handleBookingClick(btn); };
    }
  });
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  // 確保資料同步
  bookedCourses = JSON.parse(localStorage.getItem('zenpass_booked')) || {};
});
