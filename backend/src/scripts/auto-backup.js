/**
 * ZenPass 自動備份腳本
 * 每天執行一次，保留最近 7 日備份
 * 用法: node backend/src/scripts/auto-backup.js
 *
 * ⚠️ 2026-11-04 修正：DB 用 WAL 模式，`fs.copyFileSync` 只會複製主檔、
 *    漏掉 zenpass.db-wal 內未 checkpoint 嘅交易（實測少 15 條審計紀錄）。
 *    改用 SQLite 官方在線備份 API（better-sqlite3 `db.backup` / sqlite3 `.backup`），
 *    確保快照一致、包含 WAL 內容。
 */

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

// Resolve paths relative to project root
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DB_PATH = path.join(PROJECT_ROOT, "data", "zenpass.db");
const BACKUP_DIR = path.join(PROJECT_ROOT, "backups");
const KEEP_DAYS = 7;

/** 安全在線備份（會包含 WAL 未 checkpoint 嘅資料） */
function safeCopy(dest) {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH, { readonly: true });
    return db.backup(dest).then(() => {
      try { db.close(); } catch (e) {}
    });
  } catch (e) {
    // fallback：SQLite CLI 的 .backup（同樣 WAL-safe）
    execFileSync("sqlite3", [DB_PATH, `.backup '${dest}'`], { stdio: "ignore" });
    return Promise.resolve();
  }
}

async function autoBackup() {
  // Ensure backup directory exists（只 root 可讀，內含個資）
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  }

  const date = new Date();
  const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
  const backupFile = path.join(BACKUP_DIR, `zenpass-${dateStr}.db`);

  // Check if today's backup already exists
  if (fs.existsSync(backupFile)) {
    console.log(`⏭️  今日備份已存在: ${backupFile}`);
    cleanupOldBackups();
    return;
  }

  try {
    const tmpFile = `${backupFile}.tmp`;
    await safeCopy(tmpFile);
    fs.renameSync(tmpFile, backupFile);
    fs.chmodSync(backupFile, 0o600);

    // 基本完整性檢查，唔合格即刪，避免留下壞備份
    const check = execFileSync("sqlite3", [backupFile, "PRAGMA integrity_check;"], {
      encoding: "utf8",
    }).trim();
    if (check !== "ok") {
      fs.unlinkSync(backupFile);
      throw new Error(`integrity_check = ${check}`);
    }

    console.log(
      `✅ 備份成功: ${backupFile} (${(fs.statSync(backupFile).size / 1024).toFixed(1)} KB)`,
    );
  } catch (err) {
    console.error(`❌ 備份失敗: ${err.message}`);
    return;
  }

  cleanupOldBackups();
}

function cleanupOldBackups() {
  // 只清理自己嘅 `zenpass-YYYY-MM-DD.db`，唔會誤刪 cron gz 備份或 JSON 備份
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^zenpass-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort();

    while (files.length > KEEP_DAYS) {
      const old = files.shift();
      fs.unlinkSync(path.join(BACKUP_DIR, old));
      console.log(`🗑️  清理舊備份: ${old}`);
    }
  } catch (err) {
    console.error(`⚠️ 清理備份時出錯: ${err.message}`);
  }
}

// Run if called directly
if (require.main === module) {
  console.log(`📦 ZenPass 自動備份 — ${new Date().toISOString()}`);
  autoBackup();
}

module.exports = { autoBackup };
