/**
 * PM2 Ecosystem Configuration
 * ZenPass Backend — Production Process Manager
 *
 * Usage:
 *   pm2 start ecosystem.config.js        # Start
 *   pm2 restart ecosystem.config.js      # Restart
 *   pm2 status                           # Status
 *   pm2 logs                             # Tail logs
 *   pm2 monit                            # Monitor
 *   pm2 startup                          # Auto-start on boot
 *   pm2 save                             # Save process list
 */
module.exports = {
  apps: [
    {
      name: "zenpass-api",
      script: "src/index.js",
      cwd: __dirname + "/backend",
      instances: 1,               // Single instance (stable for low traffic)
      exec_mode: "fork",          // Fork mode (not cluster)
      watch: false,               // No auto-reload on file change (production)
      autorestart: true,          // Auto-restart on crash
      max_restarts: 10,           // Max restarts within min_uptime
      min_uptime: "10s",          // Min uptime for restart stability
      restart_delay: 3000,        // Wait 3s between restarts
      max_memory_restart: "500M", // Restart if memory exceeds 500MB
      
      // Environment
      env: {
        NODE_ENV: "development",
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3001,
      },
      
      // Logging (pm2 manages its own logs)
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: __dirname + "/backend/logs/pm2-error.log",
      out_file: __dirname + "/backend/logs/pm2-out.log",
      merge_logs: true,
      
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 5000,
      shutdown_with_message: true,
    },
  ],
};
