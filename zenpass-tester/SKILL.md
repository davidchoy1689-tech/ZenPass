---
name: zenpass-tester
description: QA and automated testing for ZenPass platform (https://davidchoy1689-tech.github.io/ZenPass/). Triggers on: full-stack test runs, health checks, data integrity validation, bug auto-fix, test report generation, and commit/push. Use when handling test automation, running regression, validating admin panels (users/classes/bookings), or fixing UI/backend bugs found during testing. Also triggered when cron activates the scheduled auto-test.
---

# ZenPass Tester

Complete QA testing skill for ZenPass — a fitness class booking platform.

## Core Principles

- **分階段測試**：每晚輕量 → 每週完整
- **自動修復**：發現 Bug 後自動修復再跑
- **報告生成**：每次測試完生成完整 Markdown 報告
- **自動初始**：無 tests/ 時自動建立測試框架

---

## A. 分階段測試 Schedule

### 每晚（輕量測試）~ 5 分鐘
```
bash scripts/health-check.sh              # API 健康檢查
bash scripts/data-integrity.sh            # 資料完整性
bash scripts/e2e-test.sh light               # 輕量 E2E（首頁/課程/登入/探索/會籍/管理後台）
bash scripts/code-quality.sh              # ESLint + Prettier
python3 scripts/generate-report.py        # 生成報告
```

### 每週（完整測試）~ 15 分鐘
```
bash scripts/health-check.sh              # API 健康檢查
bash scripts/data-integrity.sh            # 資料完整性
bash scripts/e2e-test.sh full               # 完整 E2E（含搜尋/行動版/404/會員）
bash scripts/mobile-screenshots.sh        # 3 種視口 × 7 頁面 = 21 張截圖
bash scripts/lighthouse.sh                # Lighthouse 性能測試
bash scripts/code-quality.sh              # 代碼質量
python3 scripts/generate-report.py        # 生成報告
git add -A && git commit -m "test: auto test & fixes" && git push
```

---

## B. 詳細測試清單

See `references/frontend-checklist.md` for full checklists covering:

### 課程頁 (courses.html / explore.html)
- [ ] 課程列表渲染完整，無空白/斷裂
- [ ] 分類篩選（瑜伽 / 健身 / 新興運動 / 伸展 / 冥想）
- [ ] 難度篩選（beginner / intermediate / advanced）
- [ ] 價格顯示格式正確（$120）
- [ ] 關鍵字搜尋（中英皆可）
- [ ] RWD 手機一欄 / 平板兩欄 / 桌面三欄
- [ ] Loading/Error 狀態

### 會員頁 (membership.html / my-membership.html)
- [ ] 會籍計劃顯示（trial / standard / unlimited）
- [ ] 價格正確
- [ ] 升級流程導向付款
- [ ] 當前會籍狀態顯示

### 搜尋功能 (explore.html)
- [ ] 關鍵字即時搜尋
- [ ] 空結果提示
- [ ] 中英文支援
- [ ] 分類+搜尋組合
- [ ] 搜尋速度 < 300ms

### 預約流程
- [ ] 時段選擇正確
- [ ] 滿額顯示「已滿」
- [ ] 預約確認訊息
- [ ] 我的預約列表
- [ ] 取消功能
- [ ] 付款整合

### 管理後台 (admin.html)
- [ ] Dashboard 統計正確
- [ ] 用戶列表（學號 US-）
- [ ] 課程列表（課程編號 CL- / 教練編號 US-）
- [ ] 預約列表（預約編號 ZP- / 學生編號 US- / 課程編號 CL-）
- [ ] 付款管理（Approve/Reject）
- [ ] Auth 安全（401/403）

### 行動版 (Mobile)
- [ ] Viewport meta
- [ ] Touch 目標 >= 44px
- [ ] 無水平滾動
- [ ] 漢堡選單
- [ ] 3G 下首屏 < 3s

### 性能目標
- Lighthouse Performance >= 80
- Lighthouse Accessibility >= 85
- LCP < 2.5s, CLS < 0.1

---

## C. 常用測試指令

### Lighthouse 性能測試
```bash
bash zenpass-tester/scripts/lighthouse.sh
```
測試 6 頁面（首頁/課程/探索/會籍/登入/管理後台）
輸出：`test-reports/lighthouse/`

### Playwright E2E
```bash
bash zenpass-tester/scripts/e2e-test.sh light   # 輕量（6 項）
bash zenpass-tester/scripts/e2e-test.sh full    # 完整（8 項）
```

### Code Quality (ESLint + Prettier)
```bash
bash zenpass-tester/scripts/code-quality.sh
```

### 行動版截圖
```bash
bash zenpass-tester/scripts/mobile-screenshots.sh
```
7 頁面 × 3 視口（375/768/1280）= 21 張截圖
輸出：`test-reports/screenshots/`

### Accessibility (a11y)
Via Lighthouse:
```bash
npx lighthouse http://192.168.1.215:3001/ --output=json | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'Accessibility: {d[\"categories\"][\"accessibility\"][\"score\"]*100:.0f}/100')
for audit in d['audits'].values():
    if audit.get('score') == 0 and 'accessibility' in audit.get('categories',{}):
        print(f'  ❌ {audit[\"title\"]}')
"
```

### 全部一次跑
```bash
bash zenpass-tester/scripts/health-check.sh && \
bash zenpass-tester/scripts/data-integrity.sh && \
bash zenpass-tester/scripts/code-quality.sh && \
bash zenpass-tester/scripts/e2e-test.sh light && \
python3 zenpass-tester/scripts/generate-report.py
```

---

## D. 自動初始化測試框架

如果 `tests/` 資料夾不存在，當收到相關指令時自動執行：

```bash
python3 zenpass-tester/scripts/init-tests.py
```

這會自動建立：
- **Vitest** — 8 個測試檔案（課程/詳情/認證/預約/搜尋/CSS）
- **Playwright** — E2E + mobile config
- **package.json scripts** — `npm test`, `npm run test:e2e`, 等

### 產生的測試檔案

| 檔案 | 涵蓋範圍 |
|------|---------|
| `tests/auth.test.js` | Login, token, 401/403 安全 |
| `tests/courses.test.js` | 課程列表、分類、難度篩選 |
| `tests/class-detail.test.js` | 課程詳情、時段資訊 |
| `tests/bookings.test.js` | 預約列表、參考編號、pending payments |
| `tests/search.test.js` | 中英文搜尋、空結果、全部回傳 |
| `tests/css.test.js` | Viewport meta、charset、檔案大小 |
| `tests/e2e/homepage.spec.js` | Playwright E2E 首頁 + 行動版 |
| `vitest.config.js` | Vitest 配置（15s timeout） |
| `playwright.config.js` | Playwright + mobile 配置 |

---

## E. 工作流程

### Step 1: Setup
```bash
cd /path/to/zenpass-platform
# Auto-init tests if missing:
python3 zenpass-tester/scripts/init-tests.py
# Or just npm install:
npm install
```

### Step 2: Run 輕量測試
```bash
npm run test
npm run test:quality
```

### Step 3: Run 完整 E2E
```bash
bash zenpass-tester/scripts/e2e-test.sh full
bash zenpass-tester/scripts/mobile-screenshots.sh
```

### Step 4: Bug Auto-Fix
If any tests fail, see `references/common-bugs.md` for fix patterns.

### Step 5: Generate Report
```bash
python3 zenpass-tester/scripts/generate-report.py
```

### Step 6: Commit
```bash
git add -A && git commit -m "test: auto test & fixes" && git push
```

---

## Scripts

### Main
| Script | Description |
|--------|------------|
| `scripts/health-check.sh` | API smoke test (8 checks) |
| `scripts/data-integrity.sh` | Ref number & consistency validation |
| `scripts/e2e-test.sh` | Playwright E2E (light/full mode) |
| `scripts/mobile-screenshots.sh` | 21 screenshots across 3 viewports |
| `scripts/lighthouse.sh` | Lighthouse perf for all pages |
| `scripts/code-quality.sh` | ESLint + Prettier + HTML check |
| `scripts/generate-report.py` | Comprehensive markdown report |
| `scripts/init-tests.py` | Auto-create Vitest + Playwright tests |

### Quick
| Script | What it does |
|--------|-------------|
| `bash zenpass-tester/scripts/health-check.sh` | ~5s, basic health |
| `bash zenpass-tester/scripts/code-quality.sh` | ~10s, code style |
| `bash zenpass-tester/scripts/e2e-test.sh light` | ~15s, 6 page loads |
| `bash zenpass-tester/scripts/lighthouse.sh` | ~60s, 6 pages profiled |
| `bash zenpass-tester/scripts/data-integrity.sh` | ~3s, data validation |

## References

- `references/testing-guide.md` — Auth patterns, state enums, perf tips
- `references/common-bugs.md` — Known bug patterns and fix steps
- `references/frontend-checklist.md` — Full frontend test checklist (courses, membership, search, booking, mobile, admin, perf)
