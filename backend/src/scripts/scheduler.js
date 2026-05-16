/**
 * ZenPass 背景排程器
 * 由 PM2 管理，負責定期執行維護任務
 */

const path = require('path');

// Run auto-backup every 24 hours
const { autoBackup } = require('./auto-backup');

// Run booking reminders every 15 minutes
const { sendBookingReminders } = require('./booking-reminder');
const { sendDayBeforeReminders } = require('./booking-reminder');

console.log('⏰ ZenPass 排程器啟動');

// Initial runs
autoBackup();
sendBookingReminders();
sendDayBeforeReminders();

// Run backup every 24 hours
setInterval(autoBackup, 24 * 60 * 60 * 1000);

// Run booking reminders every 15 minutes
setInterval(sendBookingReminders, 15 * 60 * 1000);

// Run day-before reminders every hour
setInterval(sendDayBeforeReminders, 60 * 60 * 1000);

console.log('📅 備份排程：每 24 小時');
console.log('🔔 課前提醒：每 15 分鐘');
