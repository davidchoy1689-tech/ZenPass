# Cloudflare 遷移前置檢查（2026-11-02）

> 目的：把 `zenpass.hk` 由「阿里雲 DNS 直指 ECS」轉去 Cloudflare（CDN + WAF + 抗 DDoS）。
> 本文件只做**現況實查 + 步驟 + 回滾**，**未執行任何變更**。

## 0. 實查現況（2026-11-02 08:35 HKT）

| 項目 | 實測 |
|---|---|
| DNS 供應商 | 阿里雲 DNS（`ns7/ns8.alidns.com`） |
| A 記錄 | `zenpass.hk`、`www.zenpass.hk` → `47.242.246.2`（阿里雲香港 ECS） |
| 前置代理 | **無**（直連 origin，response header 見 `server: nginx/1.20.1`） |
| TLS | Let's Encrypt，`CN=zenpass.hk`，有效至 **2027-01-10**（Cloudflare Full (strict) 可直接用） |
| nginx | 1.20.1；**未設 `real_ip`**（`set_real_ip_from` 缺失）、**無 rate limit**、未見 ufw/firewalld 規則 |
| 站台 | `https://zenpass.hk` → 200，CSP／X-Frame-Options 由後端輸出 |

## 1. 必做前置（改 NS 之前）

1. **降 TTL**：阿里雲把 `zenpass.hk`、`www` A 記錄 TTL 改 **300 秒**，等 30 分鐘
2. **Cloudflare 匯入 DNS**：A 記錄照抄 `47.242.246.2`，**先開灰雲（DNS only）**
3. **SSL/TLS 模式**：確認 origin 可被 CF 連 443（已確認），之後才轉 **Full (strict)**
4. **保留 mail 記錄**：MX / SPF / DKIM / DMARC 必須一併匯入，否則 `info.zenpass@gmail.com` 通知、`support@zenpass.hk` 收信會斷（**最容易中招**）
5. **記錄 baseline**：現時 nginx access log 流量、`/api/health` 回應時間，遷移後對照

## 2. 遷移步驟

1. Cloudflare 建 zone → 匯入全部記錄（灰雲）
2. 阿里雲改 NS → `xxx.ns.cloudflare.com` ×2 → 等生效（通常 1–4 小時，最長 24 小時）
3. 驗證灰雲狀態一切如常（`dig`, 網站 200, API 200, 登入, WhatsApp 分享 OG）
4. 逐個記錄轉**橙雲**：先 `www`，再 apex
5. 加 **Origin 防火牆規則**：只准 Cloudflare IP 段連 80/443（`cloudflare.com/ips-v4`），避免繞過 WAF
6. nginx 加 `real_ip`（`ngx_http_realip_module` 已內建於標準 build，需驗證）→ 否則所有訪客 IP 變 CF 節點，影響速率限制／審計 log
7. **Cache Rules**：
   - `/assets/*` → Edge TTL 1 年（由 origin header 決定，保持 immutable）
   - `/*.html`、`/api/*`、`/c/*` → **Bypass cache**（HTML 已 no-cache；`/c/` 由 Node SSR-lite 輸出，**唔可以**被 CF 快取）
   - `/api/coaches/:slug/og.png` → 可快取 1 日（已有 `?v=` 破緩存）
8. **ACME 續期**：certbot HTTP-01 在橙雲下會失敗 → 改 **DNS-01** 或改走 origin 直連 IP 驗證（最遲於 2027-01-10 前處理，建議遷移當日一併改好）
9. WAF：先開 Managed Rules（低敏感度）+ Bot Fight Mode（觀察 log 3 日才升級）

## 3. 驗收清單

- [ ] `dig zenpass.hk` 見 Cloudflare 任何播 IP；`server` header 變 `cloudflare`
- [ ] `https://zenpass.hk` 200；`/api/health` 200；admin 登入成功（cookie + CSRF 正常）
- [ ] 落單 → 付款 → 確認流程走一次（測試班）
- [ ] WhatsApp／IG 分享連結見到正確 OG 圖（唔係 CF 錯誤頁）
- [ ] `/c/<slug>`（11/04 上線後）確認 **Bypass cache** 生效
- [ ] Email：`POST /api/admin/test-lead-notify` 收到信（MX 未斷）
- [ ] 真實訪客 IP 落 access log（唔係 `172.70.x.x`）
- [ ] 後台 audit log 記錄 IP 正常

## 4. 回滾

- 阿里雲 NS 改回 `ns7/ns8.alidns.com` → 30 分鐘內全站復原（DNS 有 TTL 殘留，最多 300 秒 + 遞歸快取）
- 灰雲（DNS only）階段出問題：只需把記錄轉灰，无需改 NS
- **唔可以**同時改 NS 同 nginx 設定；每次只改一樣，方便定位

## 5. 風險（按機會率排序）

| 風險 | 影響 | 對策 |
|---|---|---|
| MX/DKIM 漏匯入 | 收唔到信、通知斷 | §1.4 逐條核對 |
| certbot 續期失敗 | 2027-01 站台 HTTPS 死 | 遷移當日改 DNS-01 |
| `/c/` 被 CF 快取 | 教練頁資料過時／slug 301 失效 | Bypass cache 規則 |
| 未設 real_ip | 速度限制誤傷、log 假 IP | §2.6 |
| Bot Fight Mode 太激 | 正常用戶被 challenge，WhatsApp 預覽失敗 | 先觀察模式 |
