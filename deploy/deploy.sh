#!/bin/bash
# ZenPass 禪流 — Auto Deploy Script
# Called by GitHub Actions after git pull
set -e

echo "🚀 ZenPass Deploy Starting..."
echo "===================="

# ——— Pre-flight checks ———

# Check JWT_SECRET — fallback to backend/.env if not in env
# ⚠️ 唔用 `source`：.env 內某啲值含特殊字元，`source` 會被當 shell 執行 → set -e 令 deploy 中止
if [ -z "$JWT_SECRET" ] || [ ${#JWT_SECRET} -lt 32 ]; then
  if [ -f /var/www/zenpass/backend/.env ]; then
    JWT_SECRET="$(grep -E '^JWT_SECRET=' /var/www/zenpass/backend/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r\"')"
  fi
  if [ -z "$JWT_SECRET" ] || [ ${#JWT_SECRET} -lt 32 ]; then
    echo "❌ JWT_SECRET 未設定或太短（需要 ≥32 字元）"
    exit 1
  fi
fi

# Install backend dependencies
echo "📦 Installing backend dependencies..."
cd /var/www/zenpass/backend
npm ci --production || npm ci

# Reload nginx
# 註：實際 config 由 /etc/nginx/conf.d/zenpass.conf 管理，唔依賴 sites-available symlink
# （舊 step 曾因 sites-available 唔存在而令 deploy.sh 中止 → pm2 永遠唔重啟）
echo "🔧 Reloading nginx..."
nginx -t && systemctl reload nginx

# Restart app with PM2（確保一定有重啟）
echo "🔄 Restarting ZenPass API..."
PM2_BIN="$(command -v pm2 || echo /usr/bin/pm2)"
if [ -x "$PM2_BIN" ]; then
  "$PM2_BIN" restart zenpass-api --update-env || "$PM2_BIN" start src/index.js --name zenpass-api
else
  echo "❌ pm2 搵唔到 — 無法重啟"
  exit 1
fi

# Health check
echo "🏥 Running health check..."
sleep 2
HEALTH=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/health)
if [ "$HEALTH" != "200" ]; then
  echo "❌ 健康檢查失敗（HTTP $HEALTH）"
  exit 1
fi

echo "✅ Deploy complete — API is healthy (HTTP 200)"
