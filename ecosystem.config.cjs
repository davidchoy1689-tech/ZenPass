// ZenPass 禪流 — PM2 Ecosystem File
// 用法：pm2 start ecosystem.config.cjs
// 注意：如果 pm2 不在 PATH 中，可用完整路徑：~/.npm-global/bin/pm2 start ecosystem.config.cjs

module.exports = {
  apps: [
    {
      name: "zenpass-api",
      cwd: "./backend",
      script: "src/index.js",
      instances: 1, // SQLite 唔支援 multi-instance，keep 1
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
        DB_PATH: "./data/zenpass.db",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      max_memory_restart: "500M",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      listen_timeout: 5000,
      kill_timeout: 5000,
    },
    {
      name: "zenpass-scheduler",
      cwd: "./backend",
      script: "src/scripts/scheduler.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        DB_PATH: "./data/zenpass.db",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/scheduler-error.log",
      out_file: "./logs/scheduler-out.log",
      merge_logs: true,
      max_memory_restart: "200M",
      restart_delay: 3000,
      max_restarts: 5,
      min_uptime: "10s",
      kill_timeout: 3000,
    },
  ],
};
