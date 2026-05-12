// ZenPass 禪流 — PM2 Ecosystem File
// 用法：pm2 start ecosystem.config.cjs --env production

module.exports = {
  apps: [
    {
      name: "zenpass-api",
      cwd: "./backend",
      script: "src/index.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "development",
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3001,
        DB_PATH: "./data/zenpass.db",
        ALLOW_DEMO_TOKEN: "true",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/tmp/zenpass-error.log",
      out_file: "/tmp/zenpass-out.log",
      merge_logs: true,
      max_memory_restart: "500M",
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
