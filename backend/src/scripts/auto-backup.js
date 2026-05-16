/**
 * ZenPass 自動備份腳本
 * 每天執行一次，保留最近 7 日備份
 * 用法: node backend/src/scripts/auto-backup.js
 */

const path = require('path');
const fs = require('fs');

// Resolve paths relative to project root
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'zenpass.db');
const BACKUP_DIR = path.join(PROJECT_ROOT, 'backups');

function autoBackup() {
  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const date = new Date();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const backupFile = path.join(BACKUP_DIR, `zenpass-${dateStr}.db`);

  // Check if today's backup already exists
  if (fs.existsSync(backupFile)) {
    console.log(`⏭️  今日備份已存在: ${backupFile}`);
    cleanupOldBackups();
    return;
  }

  // Copy database file
  try {
    fs.copyFileSync(DB_PATH, backupFile);
    console.log(`✅ 備份成功: ${backupFile} (${(fs.statSync(backupFile).size / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error(`❌ 備份失敗: ${err.message}`);
    return;
  }

  cleanupOldBackups();
}

function cleanupOldBackups() {
  // Keep only last 7 days of backups
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('zenpass-') && f.endsWith('.db'))
      .sort();

    while (files.length > 7) {
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
