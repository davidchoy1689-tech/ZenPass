#!/bin/bash
# ZenPass SQLite Backup Script
# Usage: ./scripts/backup.sh
# Recommended cron: 0 3 * * * /path/to/zenpass-platform/backend/scripts/backup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PATH="$BACKEND_DIR/data/zenpass.db"
BACKUP_DIR="$BACKEND_DIR/backups"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Create timestamped backup
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/zenpass-$TIMESTAMP.db"

# Use sqlite3 backup for safe online backup
if command -v sqlite3 &> /dev/null; then
    sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
else
    cp "$DB_PATH" "$BACKUP_FILE"
fi

# Compress (optional if gzip is available)
if command -v gzip &> /dev/null; then
    gzip -f "$BACKUP_FILE"
    echo "Backup: $BACKUP_FILE.gz"
else
    echo "Backup: $BACKUP_FILE"
fi

# Clean up backups older than 30 days
find "$BACKUP_DIR" -name "zenpass-*.db*" -mtime +30 -delete

# Keep only last 7 daily backups
ls -t "$BACKUP_DIR"/zenpass-*.db* 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null || true

echo "Backup complete. $(ls "$BACKUP_DIR"/*.db* 2>/dev/null | wc -l) backups retained."
