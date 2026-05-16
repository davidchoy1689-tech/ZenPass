/**
 * ZenPass 背景排程器
 * 由 PM2 管理，負責定期執行維護任務
 */

const path = require('path');

// Run auto-backup every 24 hours
const { autoBackup } = require('./auto-backup');

console.log('⏰ ZenPass 排程器啟動');

// Initial run
autoBackup();

// Run every 24 hours
setInterval(autoBackup, 24 * 60 * 60 * 1000);

console.log('📅 備份排程已設定：每 24 小時');
