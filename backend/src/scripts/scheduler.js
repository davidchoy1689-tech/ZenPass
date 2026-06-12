/**
 * ZenPass 背景排程器
 * 由 PM2 管理，負責定期執行維護任務
 */

const path = require("path");

// Run auto-backup every 24 hours
const { autoBackup } = require("./auto-backup");

// Run booking reminders every 15 minutes
const { sendBookingReminders } = require("./booking-reminder");
const { sendDayBeforeReminders } = require("./booking-reminder");

console.log("⏰ ZenPass 排程器啟動");

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

// Sync enrolled_count every 6 hours (fix data inconsistency from cancellations)
const { syncEnrolledCount } = require("./sync-enrolled-count");
syncEnrolledCount(); // Run on startup
setInterval(syncEnrolledCount, 6 * 60 * 60 * 1000);

// Auto settlement — weekly (every Monday)
const { runAutoSettlement } = require("./auto-settlement");

// System monitor — every 5 minutes
const { runMonitor } = require("../services/system-monitor");
setInterval(runMonitor, 5 * 60 * 1000);
// Also run once on startup after a short delay
setTimeout(runMonitor, 10000);

// No-show auto-processing — every 5 minutes
const http = require("http");
function processNoShows() {
  const req = http.request({
    hostname: "localhost", port: 3001, path: "/api/penalty/process-no-shows", method: "POST"
  }, (res) => {
    let data = "";
    res.on("data", (c) => data += c);
    res.on("end", () => {
      try {
        const r = JSON.parse(data);
        if (r.processed > 0) console.log(`[PENALTY] Auto-processed ${r.processed} no-shows`);
      } catch(e) {}
    });
  });
  req.on("error", (e) => console.error("[PENALTY] Auto-process error:", e.message));
  req.end();
}
setInterval(processNoShows, 5 * 60 * 1000);
setTimeout(processNoShows, 15000); // Run 15s after startup

// Run once on startup (on Monday) or check
function checkAndRunSettlement() {
  const today = new Date().getDay();
  if (today === 1) {
    // Monday
    console.log("💰 檢測到星期一，執行自動結算...");
    runAutoSettlement();
  }
}

// Check every hour if it's Monday
setInterval(checkAndRunSettlement, 60 * 60 * 1000);
checkAndRunSettlement();

console.log("📅 備份排程：每 24 小時");
console.log("🔔 課前提醒：每 15 分鐘");
console.log("💰 自動結算：每週一");
console.log("🔍 系統監控：每 5 分鐘");
console.log("❌ No-Show 自動處理：每 5 分鐘");
