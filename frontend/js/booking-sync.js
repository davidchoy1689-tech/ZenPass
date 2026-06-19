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

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  // 確保資料同步
  bookedCourses = JSON.parse(localStorage.getItem('zenpass_booked')) || {};
});
