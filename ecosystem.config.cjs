// ZenPass 禪流 — PM2 Ecosystem File
// 用法：pm2 start ecosystem.config.js

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
  ],
};
