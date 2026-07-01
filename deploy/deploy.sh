#!/bin/bash
# ZenPass 禪流 — Auto Deploy Script
# Called by GitHub Actions after git pull
set -e

echo "🚀 ZenPass Deploy Starting..."
echo "===================="

# ——— Pre-flight checks ———

# Check JWT_SECRET
if [ -z "$JWT_SECRET" ] || [ ${#JWT_SECRET} -lt 32 ]; then
  echo "❌ JWT_SECRET 未設定或太短（需要 ≥32 字元）"
  exit 1
fi

# Install backend dependencies
echo "📦 Installing backend dependencies..."
cd /var/www/zenpass/backend
npm ci --production || npm ci

# Apply nginx config & reload
echo "🔧 Reloading nginx..."
ln -sf /var/www/zenpass/deploy/nginx.conf /etc/nginx/sites-available/zenpass
nginx -t && systemctl reload nginx

# Restart app with PM2
echo "🔄 Restarting ZenPass API..."
if command -v pm2 &> /dev/null; then
  pm2 restart zenpass-api 2>/dev/null || pm2 start src/index.js --name zenpass-api
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
