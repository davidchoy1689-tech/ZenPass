# ZenPass 禪流 — Mobile App (React Native)

> ⚠️ Phase 2 項目 — MVP 驗證期完結後啟動
> 當前優先級：完善 Web PWA 體驗 → 確認產品-market fit → 先做 App

## 技術棧

| 範疇 | 技術 |
|------|------|
| Framework | React Native (Expo) |
| Navigation | Expo Router (file-based) |
| State | Zustand + React Query |
| Payment | Stripe SDK + Alipay/WeChat |
| Push | Firebase Cloud Messaging |
| Maps | react-native-maps |
| BLE | (for QR check-in / NFC) |

## 開發前準備

```bash
# 1. 裝 Expo CLI
npx create-expo-app@latest zenpass-app --template tabs

# 2. 裝依賴
cd zenpass-app
npx expo install expo-router expo-linking expo-constants
npx expo install react-native-maps react-native-safe-area-context
npx expo install @stripe/stripe-react-native
npx expo install expo-notifications expo-device
npx expo install react-native-qrcode-svg

# 3. 開 Dev
npx expo start
```

## 功能路線（按 Priority）

### MVP (Phase 2a, ~4 weeks)
- [ ] 課程瀏覽（分類篩選 + 地圖搜尋）
- [ ] 預約流程（揀堂 → 確認 → 付款）
- [ ] 用戶登入（JWT Token from existing backend）
- [ ] 我的課堂（即將上堂 + 歷史記錄）
- [ ] Push Notification（課堂提醒）

### V1 (Phase 2b, ~6 weeks)
- [ ] 教練面板（開班、收入、出席率）
- [ ] 積分/勳章中心
- [ ] 推薦計劃
- [ ] 離線模式（Offline-first with SQLite）
- [ ] 深色模式

### V2 (Phase 2c, ~8 weeks)
- [ ] QR Code 簽到
- [ ] Apple Pay / Google Pay
- [ ] Apple Watch companion
- [ ] Widget (iOS 17+)
- [ ] Live Activities

## API Integration

All API endpoints live at `https://zenpass.hk/api/` (production).
Backend is already ready — no new endpoints needed for MVP.

```typescript
const API = "https://zenpass.hk/api";

// JWT Token stored in SecureStore
const headers = { Authorization: `Bearer ${token}` };

// Classes
GET  /classes           // Course listing
GET  /classes/:id       // Course detail
GET  /classes/categories // Categories

// Bookings
POST /bookings          // Create booking
GET  /bookings/my       // My bookings

// Auth
POST /auth/login        // Login → JWT
POST /auth/register     // Register

// Points
GET  /points            // Points + tier
POST /points/checkin    // Daily check-in
