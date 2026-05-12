#!/bin/bash
# ZenPass 禪流 — VPS 一鍵部署腳本
# 用法：bash deploy/setup-vps.sh
# 前置：購買 VPS（建議 Linode $10/月 或 阿里雲 ECS），設定 DNS A record 指向 VPS IP
#       然後 ssh root@YOUR_SERVER_IP 執行以下

set -e

echo "🚀 ZenPass VPS Setup"
echo "===================="

# 1. System updates
echo "📦 Updating system..."
apt update && apt upgrade -y
apt install -y nginx certbot python3-certbot-nginx git curl

# 2. Install Node.js 22
echo "📦 Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2

# 3. Create directories
echo "📁 Creating directories..."
mkdir -p /var/www/zenpass/{frontend,data,uploads}
mkdir -p /var/log/zenpass

# 4. Clone repo (or copy files)
echo "📥 Clone ZenPass..."
cd /var/www/zenpass
git clone https://github.com/davidchoy1689-tech/ZenPass.git .
# If using local files, replace above with: rsync -avz --exclude 'node_modules' --exclude '.git' ./ /var/www/zenpass/

# 5. Setup .env
echo "🔑 Setup environment..."
cp backend/.env.example backend/.env
# Edit backend/.env with real credentials:
#   - DB_PATH=/var/www/zenpass/data/zenpass.db
#   - ALLOW_DEMO_TOKEN=*** (false for production)
echo "⚠️  Please edit backend/.env with production values"
echo "   - ALLOW_DEMO_TOKEN=*** (set to anything EXCEPT true)"
echo "   - Set TELEGRAM_BOT_TOKEN / WHATSAPP_CALLMEBOT_KEY"

# 6. Install dependencies
echo "📦 Installing dependencies..."
cd /var/www/zenpass/backend
npm ci --only=production

# 7. Symlink frontend
echo "🔗 Setting up frontend..."
ln -sf /var/www/zenpass/frontend /var/www/zenpass/

# 8. Setup Nginx
echo "🔧 Configuring Nginx..."
ln -sf /var/www/zenpass/deploy/nginx.conf /etc/nginx/sites-available/zenpass
ln -sf /etc/nginx/sites-available/zenpass /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 9. SSL Certificate
echo "🔒 Setting up SSL..."
echo "Run: certbot --nginx -d zenpass.hk -d www.zenpass.hk"
echo "Then re-enable HTTP→HTTPS redirect in nginx.conf"

# 10. Start with PM2
echo "🚀 Starting ZenPass..."
pm2 start /var/www/zenpass/ecosystem.config.js --env production
pm2 save
pm2 startup

# 11. Setup daily backup
echo "💾 Setting up daily backup..."
mkdir -p /var/backups/zenpass/{daily,weekly,monthly}
cp /var/www/zenpass/deploy/backup.sh /etc/cron.daily/zenpass-backup
chmod +x /etc/cron.daily/zenpass-backup
# Test backup
bash /etc/cron.daily/zenpass-backup

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit backend/.env with production values"
echo "  2. Run: certbot --nginx -d zenpass.hk"
echo "  3. Run: pm2 restart zenpass-api"
echo "  4. Visit https://zenpass.hk"
