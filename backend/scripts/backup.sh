#!/bin/bash
# ZenPass SQLite Backup Script
# Usage: ./scripts/backup.sh
# Cron: 15 3 * * * /var/www/zenpass/backend/scripts/backup.sh
#
# 2026-11-04 修正：
#   1) 只清理自己嘅 `zenpass-YYYYMMDD-HHMMSS.db.gz`，唔會誤刪 auto-backup.js 嘅
#      `zenpass-YYYY-MM-DD.db` 或 backup service 嘅 `zenpass-backup-*.json`
#   2) 保留 14 日（原本 glob 把三種備份混在一起，實際只剩 ~4 日）
#   3) 備份目錄 700、檔案 600（內含個資）

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PATH="$BACKEND_DIR/data/zenpass.db"
BACKUP_DIR="$BACKEND_DIR/backups"
KEEP_DAYS=14

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/zenpass-$TIMESTAMP.db"

# SQLite 官方在線備份（WAL-safe，會包含未 checkpoint 嘅資料）
if command -v sqlite3 &> /dev/null; then
    sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
else
    echo "❌ sqlite3 未安裝，停止備份（避免用 cp 產生不一致快照）" >&2
    exit 1
fi

# 完整性檢查，唔合格即刻刪除並報錯
CHECK=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;")
if [ "$CHECK" != "ok" ]; then
    echo "❌ 備份完整性檢查失敗: $CHECK" >&2
    rm -f "$BACKUP_FILE"
    exit 1
fi
chmod 600 "$BACKUP_FILE"

if command -v gzip &> /dev/null; then
    gzip -f "$BACKUP_FILE"
    chmod 600 "$BACKUP_FILE.gz"
    echo "Backup: $BACKUP_FILE.gz"
else
    echo "Backup: $BACKUP_FILE"
fi

# 只清理本腳本自己嘅 gz 備份
find "$BACKUP_DIR" -maxdepth 1 -name "zenpass-[0-9]*-[0-9]*.db.gz" -mtime +"$KEEP_DAYS" -delete
ls -t "$BACKUP_DIR"/zenpass-[0-9]*-[0-9]*.db.gz 2>/dev/null \
  | tail -n +$((KEEP_DAYS + 1)) | xargs -r rm -f 2>/dev/null || true

echo "Backup complete. $(ls "$BACKUP_DIR"/zenpass-[0-9]*-[0-9]*.db.gz 2>/dev/null | wc -l) daily backups retained."
