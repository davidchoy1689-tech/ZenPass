/**
 * ZenPass Logger Service
 * Structured logging with Winston (file + console)
 */
const winston = require("winston");
const path = require("path");

const logDir = path.join(__dirname, "..", "logs");

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    // Error logs — rotate 14 days
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
      maxSize: "10m",
      maxFiles: 14,
    }),
    // Combined logs
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
      maxSize: "10m",
      maxFiles: 7,
    }),
  ],
});

// Console output in development
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length
            ? " " + JSON.stringify(meta)
            : "";
          return `${timestamp} ${level}: ${message}${metaStr}`;
        }),
      ),
    }),
  );
}

// Stream for morgan integration
logger.morganStream = {
  write: (message) => logger.info(message.trim()),
};

module.exports = logger;
