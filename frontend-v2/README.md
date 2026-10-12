# frontend-v2 — ZenPass UI 升級版（並行開發）

舊版 `frontend/` **完全唔動**（繼續 live）。新版喺度逐步砌，透過 `/v2/` 預覽。

## 預覽
- `https://zenpass.hk/v2/`（nginx alias → 呢個目錄）
- 頁面用**相對路徑**（`assets/v2.css`、`booking.html`），所以喺 `/v2/` 底下正常運作
- API 呼叫用絕對路徑 `/api/...`（同 origin，照 works）

## 一鍵切換（喺 VPS）
```bash
bash scripts/switch-frontend.sh status    # 睇而家 live 邊個版本
bash scripts/switch-frontend.sh promote   # 升級：live → v2
bash scripts/switch-frontend.sh rollback  # 回滾：live → v1
```
原理：nginx `root` 指向 symlink `/var/www/zenpass/frontend-active`。

## 進度
- [x] 設計系統 `assets/v2.css`（tokens + buttons/cards/chips/stepper/slots/bottom-nav）
- [x] `index.html`（首頁樣板）
- [x] `booking.html`（預約 3 步：選時段 → 確認 → 付款 + 15 分鐘倒數）
- [ ] 課程詳情 / 我的預約 / 錢包 / 會員 / 簽到
- [ ] admin / partner-dashboard（參考 shadcn-admin / Mazer）
- [ ] 接真實 API（現時樣板多為靜態 demo 數據）
