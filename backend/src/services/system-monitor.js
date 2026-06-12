/**
 * ZenPass System Monitor
 * VPS 狀態監控 + 異常警報
 * 
 * 功能：
 * - PM2 restart count 變化檢測
 * - Error log 新增錯誤檢測
 * - Disk usage 閾值警報
 * - API health check
 * - 透過 email + console 發出警報
 * - 寫入狀態檔供 assistant heartbeat 讀取
 * 
 * 使用方式：
 *   node src/services/system-monitor.js
 *   或整合到 scheduler.js 定時執行
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Database = require("better-sqlite3");
const { emailNotification, sendTelegramAlert } = require("./notification");

const STATE_FILE = path.join(__dirname, "../../data/monitor-state.json");
const LOG_DIR = path.join(__dirname, "../../logs");
const ERROR_LOG = "/root/.pm2/logs/zenpass-api-error.log";
const SCHEDULER_LOG = path.join(LOG_DIR, "scheduler-error.log");

const DISK_THRESHOLD = 80; // 超過 80% 報警
const MAX_RESTART_THRESHOLD = 5; // 每小時超過 5 次 restart 報警

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch (e) {
    /* ignore */
  }
  return {
    lastCheck: null,
    lastRestartCount: { api: 0, scheduler: 0 },
    lastErrorLogPos: 0,
    lastDiskAlert: 0,
    alertCount: {},
    recentAlerts: [],
  };
}

function writeState(state) {
  state.lastCheck = new Date().toISOString();
  if (state.recentAlerts.length > 50) {
    state.recentAlerts = state.recentAlerts.slice(-50);
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getPM2Status() {
  try {
    const out = execSync("pm2 list --no-color", {
      encoding: "utf-8",
      timeout: 5000,
    });
    const lines = out.split("\n");
    const apiLine = lines.find((l) => l.includes("zenpass-api"));
    const schedulerLine = lines.find((l) => l.includes("zenpass-scheduler"));

    const parse = (line) => {
      if (!line) return null;
      const parts = line.split("│").map((p) => p.trim());
      return {
        id: parts[1],
        restarts: parseInt(parts[7]) || 0,
        status: parts[9],
        cpu: parts[10],
        mem: parts[11],
        uptime: parts[6],
      };
    };

    return {
      api: parse(apiLine),
      scheduler: parse(schedulerLine),
      raw: out,
    };
  } catch (e) {
    return { error: e.message };
  }
}

function checkRestartRate(state, pm2) {
  const alerts = [];
  if (!pm2.api || !pm2.scheduler) return alerts;

  const prevApi = state.lastRestartCount.api;
  const prevSched = state.lastRestartCount.scheduler;
  const nowApi = pm2.api.restarts;
  const nowSched = pm2.scheduler.restarts;

  const apiDiff = nowApi - prevApi;
  const schedDiff = nowSched - prevSched;

  if (apiDiff > 0) {
    alerts.push(
      `🔄 zenpass-api restart +${apiDiff}（總計 ${nowApi} 次）`,
    );
  }
  if (schedDiff > 0) {
    alerts.push(
      `🔄 zenpass-scheduler restart +${schedDiff}（總計 ${nowSched} 次）`,
    );
  }

  state.lastRestartCount.api = nowApi;
  state.lastRestartCount.scheduler = nowSched;

  return alerts;
}

function checkDiskUsage() {
  try {
    const out = execSync("df -h /", { encoding: "utf-8", timeout: 3000 });
    const line = out.split("\n")[1];
    if (!line) return null;
    const parts = line.split(/\s+/);
    const usage = parseInt(parts[4]?.replace("%", ""));
    return {
      usage,
      total: parts[1],
      used: parts[2],
      available: parts[3],
      mount: parts[5],
    };
  } catch (e) {
    return null;
  }
}

function checkErrorLog(state) {
  const alerts = [];
  try {
    if (!fs.existsSync(ERROR_LOG)) return alerts;
    const stats = fs.statSync(ERROR_LOG);
    const pos = state.lastErrorLogPos || 0;

    if (stats.size > pos) {
      const fd = fs.openSync(ERROR_LOG, "r");
      const buf = Buffer.alloc(stats.size - pos);
      fs.readSync(fd, buf, 0, buf.length, pos);
      fs.closeSync(fd);

      const newContent = buf.toString("utf-8");
      const lines = newContent.split("\n").filter((l) => l.trim());
      state.lastErrorLogPos = stats.size;

      if (lines.length > 0) {
        const recent = lines.slice(-3);
        alerts.push(
          `⚠️ Error log 新增 ${lines.length} 行（最近：${recent[0]?.substring(0, 120)}）`,
        );
      }
    }
  } catch (e) {
    /* log might not exist yet */
  }
  return alerts;
}

function checkSchedulerErrorLog(state) {
  const alerts = [];
  try {
    if (!fs.existsSync(SCHEDULER_LOG)) return alerts;
    const logContent = fs.readFileSync(SCHEDULER_LOG, "utf-8");
    const lines = logContent.split("\n").filter((l) => l.trim());
    const lastLine = lines[lines.length - 1] || "";
    if (lastLine.toLowerCase().includes("error")) {
      alerts.push(`⚠️ Scheduler error: ${lastLine.substring(0, 120)}`);
    }
  } catch (e) {
    /* ignore */
  }
  return alerts;
}

function checkHealth() {
  try {
    const out = execSync(
      "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/health",
      { encoding: "utf-8", timeout: 5000 },
    );
    return { status: "ok", code: parseInt(out) };
  } catch (e) {
    return { status: "error", code: 0 };
  }
}

function formatAlertSummary(alerts, pm2, disk, health) {
  let msg = "🔍 ZenPass 系統監控報告\n";
  msg += `📅 ${new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}\n`;
  msg += "━━━━━━━━━━━━━━━━━━\n";

  if (alerts.length > 0) {
    msg += "🚨 異常警報：\n";
    alerts.forEach((a) => (msg += `  ${a}\n`));
    msg += "━━━━━━━━━━━━━━━━━━\n";
  }

  if (pm2.api) {
    msg += `📊 API: ${pm2.api.status}（restart ${pm2.api.restarts} 次, CPU ${pm2.api.cpu}, MEM ${pm2.api.mem}）\n`;
  }
  if (pm2.scheduler) {
    msg += `📊 Scheduler: ${pm2.scheduler.status}（restart ${pm2.scheduler.restarts} 次）\n`;
  }
  if (disk) {
    msg += `💾 Disk: ${disk.usage}%（${disk.available} 可用）\n`;
  }
  if (health) {
    msg += `🏥 API Health: HTTP ${health.code}\n`;
  }

  return msg;
}

async function runMonitor() {
  const state = readState();
  const pm2 = getPM2Status();
  const disk = checkDiskUsage();
  const health = checkHealth();

  let alerts = [];

  // 1. Check restart count changes
  alerts = alerts.concat(checkRestartRate(state, pm2));

  // 2. Check error log for new entries
  alerts = alerts.concat(checkErrorLog(state));
  alerts = alerts.concat(checkSchedulerErrorLog(state));

  // 3. Check disk usage (alert if above threshold, max once per hour)
  if (disk && disk.usage >= DISK_THRESHOLD) {
    const lastAlert = state.lastDiskAlert || 0;
    if (Date.now() - lastAlert > 3600000) {
      alerts.push(`⚠️ Disk usage 已達 ${disk.usage}%（threshold: ${DISK_THRESHOLD}%）`);
      state.lastDiskAlert = Date.now();
    }
  }

  // 4. Check health
  if (health && health.code !== 200) {
    alerts.push(`🔴 API health check 失敗（HTTP ${health.code}）`);
  }

  // 5. Send alerts if needed
  if (alerts.length > 0) {
    const summary = formatAlertSummary(alerts, pm2, disk, health);

    // Log to file
    const logPath = path.join(LOG_DIR, "monitor-alerts.log");
    fs.appendFileSync(
      logPath,
      `[${new Date().toISOString()}] ${alerts.join(" | ")}\n`,
    );

    // Send email alert (SMTP is configured)
    const emailSent = await emailNotification(
      process.env.SMTP_USER || "info.zenpass@gmail.com",
      `[ZenPass Monitor] ${alerts.length} 個警報`,
      `<pre>${summary}</pre>`,
    );

    // Send Telegram alert (if configured) + console fallback
    await sendTelegramAlert(summary);

    console.log(`[Monitor] ${alerts.length} alerts sent (email: ${emailSent ? "✅" : "⚠️"})`);

    state.recentAlerts.push({
      time: new Date().toISOString(),
      alerts: [...alerts],
    });
  } else {
    console.log(`[Monitor] ✅ 系統正常（${new Date().toISOString()}）`);
  }

  // Write status file for heartbeat consumption
  const statusPath = path.join(LOG_DIR, "monitor-status.json");
  fs.writeFileSync(
    statusPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        pm2: pm2.error
          ? { error: pm2.error }
          : {
              api: {
                status: pm2.api?.status,
                restarts: pm2.api?.restarts,
                uptime: pm2.api?.uptime,
              },
              scheduler: {
                status: pm2.scheduler?.status,
                restarts: pm2.scheduler?.restarts,
                uptime: pm2.scheduler?.uptime,
              },
            },
        disk,
        health: health
          ? { status: health.status, code: health.code }
          : null,
        alerts: state.recentAlerts.slice(-3),
      },
      null,
      2,
    ),
  );

  writeState(state);
  return { alerts, pm2, disk, health };
}

// Run as standalone
if (require.main === module) {
  runMonitor()
    .then((r) => {
      if (r.alerts.length > 0) {
        console.log(formatAlertSummary(r.alerts, r.pm2, r.disk, r.health));
      }
      process.exit(0);
    })
    .catch((e) => {
      console.error("Monitor error:", e);
      process.exit(1);
    });
}

module.exports = { runMonitor, getPM2Status, checkDiskUsage, checkHealth };
