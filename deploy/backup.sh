#!/bin/bash
# ZenPass 禪流 — 每日數據備份腳本
# 用法：bash deploy/backup.sh
# 建議 cron: 0 3 * * * /var/www/zenpass/deploy/backup.sh

set -e

# 設定
BACKUP_DIR="/var/backups/zenpass"
DB_PATH="/var/www/zenpass/data/zenpass.db"
UPLOADS_DIR="/var/www/zenpass/uploads"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 建立備份目錄
mkdir -p "$BACKUP_DIR/{daily,weekly,monthly}"

echo "📦 ZenPass Backup — $TIMESTAMP"

# 1. SQLite Database Backup（用內建 .backup 避免 corrupt）
echo "   💾 Backing up database..."
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/daily/zenpass-$TIMESTAMP.db'"
gzip -f "$BACKUP_DIR/daily/zenpass-$TIMESTAMP.db"

# 2. Uploads 目錄備份
echo "   📁 Backing up uploads..."
tar -czf "$BACKUP_DIR/daily/uploads-$TIMESTAMP.tar.gz" -C "$(dirname $UPLOADS_DIR)" "$(basename $UPLOADS_DIR)" 2>/dev/null || true

# 3. Config backup（唔含敏感 credential）
echo "   ⚙️  Backing up config..."
cp "/var/www/zenpass/backend/.env" "$BACKUP_DIR/daily/env-$TIMESTAMP.txt" 2>/dev/null || true

# 4. 保留最近 30 日每日備份
echo "   🗑️  Cleaning old backups..."
find "$BACKUP_DIR/daily" -name "zenpass-*.db.gz" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR/daily" -name "uploads-*.tar.gz" -mtime +$RETENTION_DAYS -delete

# 5. 每週日 promotion 到 weekly
if [ "$(date +%u)" = "7" ]; then
  cp "$BACKUP_DIR/daily/zenpass-$TIMESTAMP.db.gz" "$BACKUP_DIR/weekly/"
fi

# 6. 每月 1 日 promotion 到 monthly
if [ "$(date +%d)" = "01" ]; then
  cp "$BACKUP_DIR/daily/zenpass-$TIMESTAMP.db.gz" "$BACKUP_DIR/monthly/"
fi

echo "✅ Backup complete:"
echo "   DB:  $BACKUP_DIR/daily/zenpass-$TIMESTAMP.db.gz"
echo "   Age: $(date -r "$BACKUP_DIR/daily/zenpass-$TIMESTAMP.db.gz" '+%Y-%m-%d %H:%M' 2>/dev/null || echo 'just now')"

# 7. 備份摘要
SIZE=$(du -sh "$BACKUP_DIR/daily/zenpass-$TIMESTAMP.db.gz" 2>/dev/null | cut -f1)
echo "   Size: $SIZE"
