# ZenPass 禪流 — 部署指南

> 本文件說明將 ZenPass 系統部署到生產環境的步驟。

---

## 📦 系統架構

```
┌──────────────────────────────────────┐
│           用戶瀏覽器                   │
│  (GitHub Pages / VPS Nginx)          │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│       Nginx Reverse Proxy            │
│   (HTTPS / SSL Termination)          │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│     Node.js (PM2) Backend API        │
│          Port 3001                   │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│         SQLite Database              │
│      backend/data/zenpass.db         │
└──────────────────────────────────────┘
```

- **Frontend**: 靜態 HTML 頁面（可放 GitHub Pages 或同一部 VPS）
- **Backend API**: Node.js + Express，PM2 管理
- **Database**: SQLite（單檔案，適合中小型應用）
  - 如需擴展可升級至 PostgreSQL

---

## 🖥️ 需求

| 項目 | 建議規格 |
|------|---------|
| VPS | 阿里雲 ECS / 騰訊雲 / AWS EC2 t3.small 或以上 |
| OS | Ubuntu 22.04 LTS |
| Node.js | v18.x 或 v20.x LTS |
| Domain | 已註冊域名（例如 zenpass.hk） |
| SSL | Let's Encrypt（免費） |

---

## 🚀 部署步驟

### 1. 伺服器初始化

```bash
# 更新系統
sudo apt update && sudo apt upgrade -y

# 安裝 Node.js (v20 LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 驗證
node -v   # 應顯示 v20.x
npm -v    # 應顯示 10.x

# 安裝 PM2（全局）
npm install -g pm2

# 安裝 Git
sudo apt install -y git

# 安裝 Nginx
sudo apt install -y nginx
```

### 2. 取得源碼

```bash
# 從 GitHub clone
cd /var/www
sudo git clone https://github.com/davidchoy1689-tech/ZenPass.git zenpass
sudo chown -R $USER:$USER zenpass
cd zenpass

# 安裝相依套件
cd backend
npm install
cd ..
```

### 3. 設定環境變數

建立 `.env.production` 在 project root：

```bash
# .env.production
NODE_ENV=production
PORT=3001
DB_PATH=./data/zenpass.db
# TODO: 接入真實 SMTP 後解鎖以下設定
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your-email@gmail.com
# SMTP_PASS=your-app-password
# TODO: 註冊 Google Analytics 後更新
# GA_MEASUREMENT_ID=G-XXXXXXXX
```

### 4. Database 初始化

```bash
cd backend
# 首次部署：建立 database 及 tables
node src/init-db.js

# 檢查 database 是否正常
node -e "const Database = require('better-sqlite3'); const db = new Database('./data/zenpass.db'); console.log('Tables:', db.prepare('SELECT name FROM sqlite_master WHERE type=\\'table\\'').all().length); db.close();"

# 同步 enrolled_count（修正 seed data 錯誤）
node src/scripts/sync-enrolled-count.js
```

### 5. 啟動 Backend（PM2）

```bash
cd /var/www/zenpass

# 使用 ecosystem.config.cjs 啟動
pm2 start ecosystem.config.cjs

# 查看狀態
pm2 status

# 設定開機自動啟動
pm2 startup
# 然後執行輸出的命令（sudo env PATH=... pm2 startup ...）

# 保存當前 process list
pm2 save
```

### 6. 設定 Nginx Reverse Proxy

建立 `/etc/nginx/sites-available/zenpass`：

```nginx
server {
    listen 80;
    server_name zenpass.hk www.zenpass.hk;

    # 前端靜態檔案
    root /var/www/zenpass/frontend;
    index index.html;

    # Gzip 壓縮
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeout 設定
        proxy_connect_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 靜態資源快取
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

啟用 site：

```bash
sudo ln -s /etc/nginx/sites-available/zenpass /etc/nginx/sites-enabled/
sudo nginx -t          # 測試設定
sudo systemctl reload nginx  # 載入新設定
```

### 7. SSL / HTTPS（Let's Encrypt）

```bash
# 安裝 Certbot
sudo apt install -y certbot python3-certbot-nginx

# 取得 SSL 憑證（自動修改 nginx config）
sudo certbot --nginx -d zenpass.hk -d www.zenpass.hk

# 測試自動續期
sudo certbot renew --dry-run

# 確認憑證狀態
sudo certbot certificates
```

### 8. Frontend 部署

**Option A: GitHub Pages（推薦開發階段）**
- GitHub Pages 已經自動部署
- 只需確保 `api.js` 中的 `API_BASE` 指向 VPS 的 API endpoint

**Option B: 同一部 VPS**
- 靜態檔案已在 `/var/www/zenpass/frontend/`
- Nginx 設定已包含 `root /var/www/zenpass/frontend;`

### 9. 驗證部署

```bash
# 檢查 backend 是否在線
curl http://127.0.0.1:3001/api/health

# 檢查 nginx 能否正確代理
curl https://zenpass.hk/api/health

# 檢查前端是否正常
curl -I https://zenpass.hk/
```

### 10. 監控與維護

```bash
# PM2 常用指令
pm2 status                          # 查看所有 process
pm2 logs zenpass-api                # 查看即時 log
pm2 monit                           # 監控 CPU / 記憶體
pm2 restart zenpass-api             # 重啟
pm2 reload ecosystem.config.cjs     # 重新載入設定

# 查看健康狀態
curl https://zenpass.hk/api/health  # 回傳 DB, uptime, memory

# 更新源碼
cd /var/www/zenpass
git pull
cd backend && npm install && cd ..
pm2 restart zenpass-api
```

---

## 🔧 維護 checklist

### 每日
- [ ] PM2 狀態正常（`pm2 status`）
- [ ] `/api/health` 回傳 200

### 每週
- [ ] 檢查 PM2 log 有無異常
- [ ] Database 備份（copy `backend/data/zenpass.db` 到安全位置）

### 每月
- [ ] 系統更新：`sudo apt update && sudo apt upgrade -y`
- [ ] 檢查磁碟空間：`df -h`
- [ ] 檢查 SSL 憑證有效期：`sudo certbot certificates`
- [ ] PM2 版本更新：`npm install -g pm2@latest && pm2 update`

---

## ⚠️ 注意事項

1. **SQLite 不支援多 instance** — `ecosystem.config.cjs` 中 `instances: 1`，不可改為 cluster mode
2. **Database 備份** — 直接用 `cp backend/data/zenpass.db backup/`，無需停機（SQLite WAL mode）
3. **域名 DNS** — 確保 A record 指向 VPS IP
4. **防火牆** — 開放 port 80, 443（用 `ufw` 或雲端服務商 firewall）
5. **環境變數** — 所有敏感資料（SMTP password, JWT secret）不應 commit 到 Git

---

## 📊 未來升級方向

- [ ] 接入真實 SMTP 發送 email 通知
- [ ] PostgreSQL 取代 SQLite（更大容量 + 更好併發）
- [ ] CDN 加速靜態資源
- [ ] Sentry error tracking
- [ ] Google Analytics 真實 ID 取代 placeholder

---

*最後更新：2026-05-16*
