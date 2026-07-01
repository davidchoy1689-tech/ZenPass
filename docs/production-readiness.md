# ZenPass Production Readiness Checklist

> 每次 deploy 前後請跟此清單逐項檢查。

---

## ✅ Pre-deploy

- [ ] All code committed and pushed to `main`
- [ ] Unit tests pass locally: `npm run test:unit`
- [ ] Integration tests pass: `npm run test:integration`
- [ ] JWT_SECRET in `.env` (min 32 chars)
- [ ] CSRF enabled (check `/api/csrf-token` returns cookie)
- [ ] DB Singleton pattern active (`src/services/database.js` → `getDb()`)
- [ ] Rate limiting configured (auth: 10/min, admin: 30/min, general: 100/min)
- [ ] Helmet security headers enabled
- [ ] `deploy/deploy.sh` up to date
- [ ] GitHub Secrets configured: `VPS_SSH_KEY`, `VPS_HOST`, etc.
- [ ] CI pipeline green on latest commit

## 🔧 Deploy Steps

1. **Push to main** (triggers GitHub Actions)
2. **Or manual deploy:**
   ```bash
   ssh root@47.242.246.2
   cd /var/www/zenpass
   git pull origin main
   bash deploy/deploy.sh
   ```
3. **Verify automatic deploy:**
   - Watch GitHub Actions → deploy job
   - Check PM2: `pm2 status` → zenpass-api should be `online`
   - Check logs: `pm2 logs zenpass-api --lines 20`

## 🩺 Post-deploy Verification

Run the health check script from any machine:

```bash
bash zenpass-tester/scripts/health-check.sh http://47.242.246.2:3001
```

Or check manually:

- [ ] `/api/health` returns 200
- [ ] Login works: `POST /api/login`
- [ ] CSRF token endpoint: `GET /api/csrf-token` returns cookie
- [ ] Wishlist API: `GET /api/wishlist` returns (authenticated)
- [ ] NPS submit: `POST /api/nps/submit`
- [ ] Dynamic pricing: `GET /api/pricing`
- [ ] Loyalty tiers API: `GET /api/loyalty`
- [ ] Subscription pause: `POST /api/subscriptions/pause`
- [ ] Stripe webhook reachable
- [ ] Admin panel: `http://47.242.246.2:3001/admin.html` loads

## 📊 Monitoring

- [ ] PM2 logs clean: `pm2 logs zenpass-api --lines 50` — no uncaught errors
- [ ] Memory usage < 500MB: `pm2 show zenpass-api | grep memory`
- [ ] Response time < 500ms: check `zenpass-tester/scripts/health-check.sh` output
- [ ] Disk usage OK: `df -h` on VPS
- [ ] Nginx active: `systemctl status nginx`
- [ ] SSL cert valid: `certbot certificates`
- [ ] Backup schedule active (DB backup crontab)

## 🚨 Rollback Procedure

If deploy fails:

```bash
cd /var/www/zenpass
git log --oneline -5              # find previous stable commit
git reset --hard <previous-hash>  # rollback
bash deploy/deploy.sh             # re-deploy
```

Or use PM2 rollback if configured:

```bash
pm2 revert zenpass-api
```

---

_Last updated: 2026-07-02_
