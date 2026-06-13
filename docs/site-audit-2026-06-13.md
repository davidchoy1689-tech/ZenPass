# ZenPass Site Audit — 2026-06-13

> Comprehensive audit of all pages, API endpoints, and user journeys.
> Server: VPS (Alibaba Cloud), Node 3001, Nginx reverse proxy on zenpass.hk

---

## 1. Student Booking Flow (核心流程)

| Step | Status | Notes |
|:-----|:------|:------|
| Browse courses on explore.html | ✅ | Loads from `/api/classes` (200), fallback to `courses.json` |
| Filter/search/sort categories | ✅ | Categories from `/api/classes/categories`, URL param filtering |
| View class details + schedule | ✅ | `/api/classes/:id` returns class, schedules, and reviews |
| Select schedule time slot | ✅ | Interactive schedule list in class-detail.html |
| See pricing options | ✅ | Single/credits/corporate/trial displayed in class-detail |
| Select payment method | ✅ | FPS / PayMe / Stripe / Credits (class-detail shows modal) |
| Create booking (POST /api/bookings) | ✅ | class-detail.html calls POST `/api/bookings` with idempotency key |
| Idempotency protection | ✅ | `idempotency_key` sent in booking payload |
| Payment — pending_payment → confirmed | ✅ | FPS requires admin approval; credits auto-confirm |
| Confirmation screen | ✅ | payment.html has `#success-page` with booking ref and receipt download |
| Receipt download | ✅ | `downloadReceipt()` function exists |
| View my bookings | ✅ | my-bookings.html loads from `/api/bookings/my` (200) |
| Tab filters: Confirmed/Cancelled | ✅ | Tab switching with counts |
| Cancel booking from my-bookings | ✅ | `cancelBooking()` calls POST `/api/bookings/:id/cancel` |
| Late-cancel penalty rules | ✅ | <2h blocked, 2-12h forfeit credits, >12h full refund |
| Auto-refund on cancel | ✅ | `processRefund()` called for paid bookings |
| Waitlist promotion on cancel | ✅ | `autoNotifyOnCancel()` called |
| Check-in page | ✅ | checkin.html with QR scanner (html5-qrcode) and geofence |
| Rate/review after attendance | ✅ | rate.html with star rating + review text |
| Review API | ✅ | `/api/reviews` endpoints exist |

### Gaps Found
- ❌ **No cancellation notification** — cancel booking function doesn't call `sendNotification` for the user (no "your booking was cancelled" message)
- ⚠️ **No dedicated receipt page** — success screen is inline on payment.html (functional but basic)
- ⚠️ **payment.html doesn't include api.js** — uses its own inline `apiFetch` function (duplicate code)

---

## 2. Auth Flow

| Step | Status | Notes |
|:-----|:------|:------|
| Login page | ✅ | login.html with email/password form |
| Login API | ✅ | POST `/api/auth/login` returns JWT token + user |
| Auto-redirect after login | ✅ | login.html supports `?redirect=` param |
| Session persistence | ✅ | localStorage `zenpass_token` + `zenpass_user` |
| Register / signup | ✅ | Inline in login modal OR signup.html redirects to login.html |
| Register API | ✅ | POST `/api/auth/register` returns 201 |
| Logout | ✅ | `clearToken()` + `location.reload()` |
| Social login (Google) | ✅ | GIS SDK integration (if Google SDK loads) |
| Social login (Apple) | ✅ | Apple client ID configured |
| Auth middleware on backend | ✅ | `authenticateToken` middleware on protected routes |
| Token expiry → redirect to login | ✅ | 401 handling auto-redirects to login.html |
| Demo login (student/coach/admin) | ✅ | `demoLogin()` in api.js |

### Gaps Found
- ❌ **No password reset** — login.html has no "forgot password" link, no `/api/auth/password-reset` endpoint
- ❌ **No email verification** — registration doesn't require email confirmation
- ⚠️ **Signup page** — signup.html is just a redirect to login.html (not a dedicated page)
- ⚠️ **Social login** — Google SDK prompt may not show without proper client ID

---

## 3. Coach Flow

| Step | Status | Notes |
|:-----|:------|:------|
| Coach login | ✅ | Same auth flow, role-based access |
| Coach dashboard | ✅ | coach-dashboard.html loads `/api/coach/my-classes` (200) |
| View upcoming classes | ✅ | Schedule list in dashboard |
| Create/manage classes | ✅ | Add schedule via coach dashboard |
| Earnings tab | ✅ | Tab inside coach-dashboard with income table + revenue chart |
| Earnings API | ✅ | `/api/coach/earnings` (200), `/api/coach/earnings/detail` |
| Payout request | ✅ | `/api/coach/payout-request` endpoint exists |
| Payout history | ✅ | `/api/coach/payout-history` (200) |
| Public coach profile | ✅ | coach-profile.html (profile page), coaches.html (list) |
| Apply to become coach | ✅ | coach-apply.html + register-coach.html |
| Coach application API | ✅ | POST `/api/coach/apply` (200) |
| Coach ratings | ✅ | `/api/ratings/coach/:coachId` (200) |
| Coach ranking | ✅ | `/api/ratings/ranking` (200) |
| Private income tracking | ✅ | `/api/coach/private-income` endpoints |
| Coach notification on new booking | ✅ | `sendNotification("coach.new_booking", ...)` in booking route |

### Gaps Found
- ❌ **coach-earnings.html 404** — This standalone page doesn't exist (earnings is a tab in dashboard, not separate page)
- ⚠️ **No "mark students as attended"** from coach dashboard — check-in is student-initiated via QR
- ⚠️ **Edit class schedule from dashboard** — No UI to edit schedule times (add-only)

---

## 4. Admin Flow

| Step | Status | Notes |
|:-----|:------|:------|
| Admin login page | ✅ | `/admin/login.html` (separate from user login) |
| Admin dashboard | ✅ | `/admin.html` with 16 tabs |
| Dashboard stats | ✅ | `/api/admin/stats` (200) |
| User management | ✅ | `/api/admin/users` (200), table with search |
| Class management | ✅ | `/api/admin/classes` (200) |
| Booking management | ✅ | `/api/admin/bookings` (200) + search |
| Payment approval (pending list) | ✅ | `/api/admin/pending-payments` (200) — FPS/PayMe pending |
| Approve payment | ✅ | `/api/admin/approve-payment` via POST |
| Reject payment | ✅ | `/api/admin/reject-payment` via POST |
| Partner management | ✅ | `partners` tab (pending/active/all filter) |
| Coach application approval | ✅ | `/api/admin/coach-approve` and `coach-reject` |
| Corporate management | ✅ | `corporate` tab — CRUD companies, add employees, top-up credits |
| Pricing settings | ✅ | `pricing` tab — GET/PUT `/api/pricing/admin/pricing` (200) |
| Penalty management | ✅ | `penalty` tab — settings + stats |
| Audit log | ✅ | `audit-log` tab |
| Reports | ✅ | `reports` tab |
| Course content management | ✅ | `course-contents` tab |
| Wallet management | ✅ | `wallets` tab — user wallet balances |
| Migrate tools | ✅ | `migrate` tab — data migration |
| Marketing tools | ✅ | `marketing` tab |
| Payout processing | ✅ | `/api/admin/process-payouts` + `/api/admin/payouts` |

### Gaps Found
- ❌ **`/api/admin/dashboard` returns 404** — admin.html dashboard tab may not load correctly (only `/api/admin/stats` works)
- ❌ **`/api/admin/payments` returns 404** — admin payment section may have broken endpoint
- ❌ **`/api/admin/pricing` returns 404** — only `/api/pricing/admin/pricing` works
- ❌ **`/api/admin/corporate` returns 404** — corporate is at `/api/corporate/companies` instead
- ❌ **`/api/admin/audit-log` returns 404** — audit is at `/api/admin/stats` and `/api/audit/...`
- ⚠️ **No dedicated `/api/admin/dashboard`** — stats endpoint is `/api/admin/stats`

---

## 5. Corporate Employee Flow

| Step | Status | Notes |
|:-----|:------|:------|
| Admin creates company | ✅ | corporate_companies table, admin.html corporate tab |
| Admin adds employees | ✅ | POST `/api/corporate/companies/:id/employees` |
| Employee logs in | ✅ | Same auth, role-based detection |
| Employee books with corporate credits | ✅ | class-detail.html has "Corporate" payment option |
| Hybrid payment (company + personal) | ⚠️ | Not explicitly confirmed in API |
| Monthly credit reset | ✅ | `corporate-reset.js` service scheduled |
| View remaining credits | ✅ | API returns credit balance |

### Gaps Found
- ❌ **Corporate guide page** — corporate-guide.html exists but has no API integration for showing employee's remaining credits
- ❌ **Employee credit balance on my-bookings** — No display of corporate credit balance on the bookings page
- ❌ **`/api/corporate/employees` returns 404** — only `/api/corporate/companies/:id/employees` works (might break admin page)

---

## 6. Membership/Credits Flow

| Step | Status | Notes |
|:-----|:------|:------|
| View membership plans | ✅ | membership.html — all-access, standard, lite plans |
| Membership plans API | ✅ | `/api/memberships/plans` (200) — 3 plans |
| Purchase membership | ✅ | subscribe.html + `/api/memberships/subscribe` |
| Buy credit packages | ✅ | buy-credits.html + `/api/pricing/packages` (200) |
| View my membership | ✅ | my-membership.html — shows expiry, credits remaining |
| Credits deducted on booking | ✅ | Backend logic in booking creation |
| View credit balance | ✅ | my-membership.html and booking page |

### Gaps Found
- ❌ **No membership expiry handling on my-membership** — shows hardcoded expiry date but no auto-renewal toggle or "expiring soon" warning
- ❌ **No auto-renewal** — No backend or frontend auto-renewal mechanism found
- ✅ **Credit packages**: 10/25/50 credits available with tiered pricing

---

## 7. Points/Rewards Flow

| Step | Status | Notes |
|:-----|:------|:------|
| Daily check-in | ✅ | checkin.html awards points on successful check-in |
| Earn points | ✅ | Points system in backend |
| View points history | ✅ | points.html shows point transactions |
| Redeem points | ✅ | 7 mentions of "redeem" in points.html |
| Badges/achievements | ✅ | badges.html — 35+ badges with earned/locked state |
| Referral program | ✅ | referral.html — share code, earn rewards |
| Points API | ✅ | `/api/points` (200), `/api/points/leaderboard` |
| Badges API | ✅ | `/api/badges` (200) with auth |
| Referral API | ✅ | `/api/referral/my-code` (200), `/api/referral/redeem`, `/api/referral/tiers` |

### Gaps Found
- ✅ **Points system is well-integrated** — Points visible in nav bar badge, transactions tracked

---

## 8. Waitlist Flow

| Step | Status | Notes |
|:-----|:------|:------|
| Join waitlist if class is full | ✅ | `joinWaitlist()` in class-detail.html — POST `/api/waitlist/join` |
| Leave waitlist | ✅ | POST `/api/waitlist/leave` |
| Check waitlist status | ✅ | GET `/api/waitlist/status` (200) |
| Auto-notify when spot opens | ✅ | `autoNotifyOnCancel()` in waitlist route — called on booking cancel |
| Auto-join booking from waitlist | ✅ | Functionality in `autoNotifyOnCancel` |

### Gaps Found
- ⚠️ **No UI for viewing waitlist position** — `waitlist-btn` exists but user can't see their queue position
- ⚠️ **No "promoted from waitlist" notification** — `sendNotification` is not called when user is auto-promoted (just booking is created)

---

## 9. Notification Flow

| Step | Status | Notes |
|:-----|:------|:------|
| Booking confirmation (app) | ✅ | `sendNotification("booking.confirmed", ...)` on booking creation |
| Telegram notification config | ✅ | TELEGRAM_BOT_TOKEN config, `sendTelegramAlert()` function |
| Email notification config | ✅ | SMTP email notification service exists |
| Coach notification on new booking | ✅ | `sendNotification("coach.new_booking", ...)` |
| Cancel/refund notification | ❌ | **No notification sent on cancellation** — missing from cancel handler |
| Check-in notification | ⚠️ | Points/rewards sent on check-in but no explicit notification |
| Waitlist promotion notification | ❌ | **No notification sent when promoted** — booking is created silently |

### Gaps Found
- ❌ **Cancellation notification not implemented** — neither user nor coach gets notified when booking is cancelled
- ❌ **Waitlist promotion notification** — auto-promoted user doesn't receive notification
- ⚠️ **Telegram/Email are configured but not fully active** — environment variables may not be set (dev console.log fallback)

---

## 10. Venue Partner Flow

| Step | Status | Notes |
|:-----|:------|:------|
| Partner application form | ✅ | partner-apply.html |
| Partner application API | ✅ | POST `/api/partner/apply` |
| Partner dashboard | ✅ | partner-dashboard.html |
| Partner status check | ✅ | GET `/api/partner/status` (200) |
| Commission plans | ✅ | GET `/api/partner/commission-plans` (200) — Basic/Standard/Premium tiers |
| Partner list (public) | ✅ | GET `/api/partner/list` (200) |
| Payout management | ✅ | `/api/partner/payouts` endpoints |
| Book as partner | ✅ | `/api/partner/book` |
| Commission rate visible | ✅ | Dashboard displays `commission_rate` % and `commission_plan_label` |

### Gaps Found
- ⚠️ **No venue-specific dashboard for multi-venue partners** — dashboard shows all venues but limited filtering

---

## Page-Specific Checks

### All Pages (51 total) — Status Code
| Status | Count |
|:-------|:-----:|
| HTTP 200 | 50 pages |
| HTTP 404 | 1 page (coach-earnings.html — earnings is tab inside dashboard) |

### API.js Inclusion
| Type | Pages |
|:-----|:------|
| Includes api.js | ✅ 29 pages |
| Inline API calls | 5 pages (payment.html, my.html, points.html, merchant.html, corporate-guide.html) |
| No API calls (static) | 17 pages (404, coach.html, faq, privacy, terms, redirects, etc.) |

### Auth Protection
| Feature | Status |
|:--------|:-------|
| Protected pages redirect to login | ✅ (api.js auto-handles 401 → redirect) |
| Demo mode for first-time visitors | ✅ (auto-creates demo user) |
| Admin page has separate login | ✅ (admin/login.html + session token) |

### Navigation Consistency
| Feature | Status |
|:--------|:-------|
| Bottom nav bar on main pages | ✅ |
| Footer on all pages | ✅ (© 2026 ZenPass 禪流) |
| Back buttons | ✅ header back links |

---

## API Endpoint Status Summary

### Working Public Endpoints
- ✅ `GET /api/health`
- ✅ `GET /api/classes`
- ✅ `GET /api/classes/categories`
- ✅ `GET /api/classes/:id`
- ✅ `GET /api/memberships/plans`
- ✅ `GET /api/pricing/packages`
- ✅ `GET /api/pricing/all`
- ✅ `GET /api/pricing/plans`
- ✅ `GET /api/pricing/dynamic`
- ✅ `GET /api/partner/commission-plans`
- ✅ `GET /api/partner/list`
- ✅ `GET /api/ratings/ranking`

### Working Auth-Endpoint Endpoints (with token)
- ✅ `POST /api/auth/login`
- ✅ `POST /api/auth/register` (201)
- ✅ `GET /api/auth/me`
- ✅ `POST /api/auth/social`
- ✅ `GET /api/bookings/my`
- ✅ `GET /api/users/profile`
- ✅ `GET /api/users/credits`
- ✅ `GET /api/memberships/my`
- ✅ `GET /api/badges`
- ✅ `GET /api/points`
- ✅ `GET /api/notifications` (in-app notifications)
- ✅ `GET /api/coach/my-classes`
- ✅ `GET /api/coach/earnings`
- ✅ `GET /api/coach/payout-history`
- ✅ `GET /api/coach/earnings/detail`
- ✅ `GET /api/wallet/balance`
- ✅ `GET /api/referral/my-code`
- ✅ `GET /api/referral/tiers`
- ✅ `GET /api/waitlist/status`
- ✅ `GET /api/partner/status`

### Admin Endpoints (with admin token)
- ✅ `GET /api/admin/stats`
- ✅ `GET /api/admin/users`
- ✅ `GET /api/admin/classes`
- ✅ `GET /api/admin/bookings`
- ✅ `GET /api/admin/pending-payments`
- ✅ `POST /api/admin/approve-payment`
- ✅ `POST /api/admin/coach-approve`
- ✅ `GET /api/admin/user-detail/:id`
- ✅ `GET /api/admin/coach-detail/:id`

### 404 Endpoints
- ⚠️ `GET /api/admin/dashboard` — only `/api/admin/stats` works
- ⚠️ `GET /api/admin/payments` — no dedicated payments list endpoint
- ⚠️ `GET /api/admin/pricing` — only `/api/pricing/admin/pricing` works
- ⚠️ `GET /api/admin/corporate` — only `/api/corporate/companies` works
- ⚠️ `GET /api/admin/audit-log` — no dedicated audit-log endpoint
- ⚠️ `GET /api/notifications/my` — no my-specific endpoint

---

## Gaps Summary

### ❌ Missing / Broken (Critical)
1. **Password reset** — No "forgot password" flow anywhere (login.html has no link, no API endpoint)
2. **Email verification** — Registration doesn't verify email addresses
3. **Cancellation notification** — Booking cancellation doesn't notify user or coach via `sendNotification`
4. **Waitlist promotion notification** — User promoted from waitlist doesn't get notified
5. **`/api/admin/dashboard` 404** — Admin dashboard stats UI may be broken
6. **coach-earnings.html 404** — If linked from anywhere, will 404

### ⚠️ Partial / Could Improve (Medium)
1. **payment.html doesn't use api.js** — Duplicated API helper code (maintenance risk)
2. **Membership expiry handling** — No auto-renewal or expiration warnings
3. **Corporate credit balance on my-bookings** — Employee can't see their remaining company credits on the bookings page
4. **Admin Corporate endpoint migration** — Some endpoints moved to `/api/corporate/*` but admin tabs may still call old paths
5. **Inline API in my.html, points.html** — These pages use direct fetch instead of api.js helper
6. **Various admin endpoints** — Some tab UIs might not load (dashboard, payments, pricing, corporate, audit-log)
7. **No session refresh** — Token expires after configurable period, no refresh token mechanism

---

## Recommendations (Priority Order)

1. **🔴 Add password reset flow** — Create `POST /api/auth/password-reset` endpoint + "忘記密碼" link on login.html
2. **🔴 Fix admin endpoints** — Ensure all admin tabs call correct API paths (dashboard→stats, payments→pending-payments, corporate→/api/corporate/companies)
3. **🟡 Add cancellation notification** — Call `sendNotification("booking.cancelled", ...)` in the cancel handler
4. **🟡 Add waitlist promotion notification** — Notify user when auto-promoted from waitlist
5. **🟡 Show corporate credit balance on my-bookings** — Add API call and display for employee's remaining company credits
6. **🟡 Standardise API calls** — Have payment.html, my.html, points.html use api.js instead of inline code
7. **🟢 Add membership expiry handling** — Show expiry warnings, add auto-renewal toggle
8. **🟢 Clean up coach-earnings page** — Remove any broken links to coach-earnings.html or create the page
9. **🟢 Waitlist position UI** — Show user their position in waitlist queue
10. **🟢 Email verification** — Add verification step to registration flow

---

## Data Summary

- **Database tables**: 49 tables
- **Bookings**: 7 records (attended, cancelled, no_show statuses)
- **Users**: 20 registered users
- **Classes**: Multiple classes across 20+ categories
- **API uptime**: ~28 minutes at time of check
- **DB connected**: ✅ (SQLite, file: `backend/data/zenpass.db`)
- **Memory**: 19.69 MB usage (out of 1,871 MB total)
- **Node version**: v22.22.2

---

*Audit completed: 2026-06-13 14:20 HKT*
*Server: VPS (Alibaba Cloud) | Domain: zenpass.hk*
