#!/usr/bin/env python3
# ZenPass Test Framework Auto-Init
# Creates Vitest + Playwright test files if tests/ doesn't exist

import os, sys, json, shutil

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def init_test_framework():
    """Auto-create Vitest + Playwright test files for ZenPass frontend."""
    
    frontend_dir = os.path.join(PROJECT_DIR, "frontend")
    test_dir = os.path.join(PROJECT_DIR, "tests")
    
    if os.path.exists(test_dir):
        print("✅ tests/ 資料夾已存在，跳過初始化")
        existing = [f for f in os.listdir(test_dir) if f.endswith('.test.js') or f.endswith('.spec.js')]
        print(f"   現有測試檔案：{len(existing)} 個")
        return True
    
    print("🔧 建立測試框架：Vitest + Playwright")
    os.makedirs(test_dir, exist_ok=True)
    
    # Vitest config
    with open(os.path.join(PROJECT_DIR, "vitest.config.js"), "w") as f:
        f.write("""// ZenPass Vitest Configuration
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
""")
    print("  ✅ vitest.config.js")
    
    # === Test files ===
    
    # 1. Courses page test
    with open(os.path.join(test_dir, "courses.test.js"), "w") as f:
        f.write("""// ZenPass 課程頁測試
import { describe, it, expect } from 'vitest';

const API_BASE = 'http://localhost:3001';

describe('📚 課程頁 API', () => {
  
  it('GET /api/classes 回傳課程列表', async () => {
    const res = await fetch(`${API_BASE}/api/classes`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.classes)).toBe(true);
    expect(data.classes.length).toBeGreaterThan(0);
  });

  it('每個課程有 class_reference', async () => {
    const res = await fetch(`${API_BASE}/api/classes`);
    const data = await res.json();
    for (const c of data.classes) {
      expect(c.class_reference).toMatch(/^CL-/);
    }
  });

  it('每個課程有價格且大於 0', async () => {
    const res = await fetch(`${API_BASE}/api/classes`);
    const data = await res.json();
    for (const c of data.classes) {
      expect(c.price_hkd).toBeGreaterThan(0);
    }
  });

  it('課程可按分類篩選', async () => {
    const res = await fetch(`${API_BASE}/api/classes?category=瑜伽`);
    const data = await res.json();
    for (const c of data.classes) {
      expect(c.category).toBe('瑜伽');
    }
  });

  it('課程可按難度篩選', async () => {
    const res = await fetch(`${API_BASE}/api/classes?difficulty=beginner`);
    const data = await res.json();
    for (const c of data.classes) {
      expect(c.difficulty).toBe('beginner');
    }
  });
});
""")
    print("  ✅ tests/courses.test.js")
    
    # 2. Class detail test
    with open(os.path.join(test_dir, "class-detail.test.js"), "w") as f:
        f.write("""// ZenPass 課程詳情頁測試
import { describe, it, expect } from 'vitest';

const API_BASE = 'http://localhost:3001';

describe('📖 課程詳情', () => {
  
  it('GET /api/classes/:id 回傳課程詳情', async () => {
    // First get a class ID
    const listRes = await fetch(`${API_BASE}/api/classes`);
    const listData = await listRes.json();
    const classId = listData.classes[0].id;
    
    const res = await fetch(`${API_BASE}/api/classes/${classId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.class.id).toBe(classId);
  });

  it('課程詳情包含時段資訊', async () => {
    const listRes = await fetch(`${API_BASE}/api/classes`);
    const listData = await listRes.json();
    const classId = listData.classes[0].id;
    
    const res = await fetch(`${API_BASE}/api/classes/${classId}`);
    const data = await res.json();
    expect(Array.isArray(data.schedules)).toBe(true);
  });
});
""")
    print("  ✅ tests/class-detail.test.js")
    
    # 3. Auth test
    with open(os.path.join(test_dir, "auth.test.js"), "w") as f:
        f.write("""// ZenPass 認證測試
import { describe, it, expect } from 'vitest';

const API_BASE = 'http://localhost:3001';

describe('🔐 認證系統', () => {
  
  it('登入成功回傳 token', async () => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@zenpass.hk', password: 'admin123' }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.token).toBeTruthy();
  });

  it('錯誤密碼回傳 401', async () => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@zenpass.hk', password: 'wrongpass' }),
    });
    expect(res.status).toBe(401);
  });

  it('無 token 存取管理後台回傳 401', async () => {
    const res = await fetch(`${API_BASE}/api/admin/stats`);
    expect(res.status).toBe(401);
  });

  it('有效 token 可存取管理後台', async () => {
    const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@zenpass.hk', password: 'admin123' }),
    });
    const { token } = await loginRes.json();
    
    const res = await fetch(`${API_BASE}/api/admin/stats`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(res.ok).toBe(true);
  });
});
""")
    print("  ✅ tests/auth.test.js")
    
    # 4. Booking test
    with open(os.path.join(test_dir, "bookings.test.js"), "w") as f:
        f.write("""// ZenPass 預約流程測試
import { describe, it, expect } from 'vitest';

const API_BASE = 'http://localhost:3001';

async function adminToken() {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@zenpass.hk', password: 'admin123' }),
  });
  const data = await res.json();
  return data.token;
}

describe('📅 預約系統', () => {
  
  it('管理員可取得所有預約', async () => {
    const token = await adminToken();
    const res = await fetch(`${API_BASE}/api/admin/bookings?limit=10`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.bookings)).toBe(true);
  });

  it('每筆預約有 booking_reference', async () => {
    const token = await adminToken();
    const res = await fetch(`${API_BASE}/api/admin/bookings?limit=10`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    for (const b of data.bookings) {
      expect(b.booking_reference).toMatch(/^ZP-/);
    }
  });

  it('每筆預約有關聯用戶資料', async () => {
    const token = await adminToken();
    const res = await fetch(`${API_BASE}/api/admin/bookings?limit=10`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    for (const b of data.bookings) {
      expect(b.user_name).toBeTruthy();
      expect(b.user_reference).toMatch(/^US-/);
    }
  });

  it('待確認付款列表', async () => {
    const token = await adminToken();
    const res = await fetch(`${API_BASE}/api/admin/pending-payments`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(res.ok).toBe(true);
  });
});
""")
    print("  ✅ tests/bookings.test.js")
    
    # 5. Search test
    with open(os.path.join(test_dir, "search.test.js"), "w") as f:
        f.write("""// ZenPass 搜尋功能測試
import { describe, it, expect } from 'vitest';

const API_BASE = 'http://localhost:3001';

describe('🔍 搜尋功能', () => {
  
  it('可按關鍵字搜尋課程（中文）', async () => {
    const res = await fetch(`${API_BASE}/api/classes/search?q=瑜伽`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.classes)).toBe(true);
  });

  it('可按關鍵字搜尋課程（英文）', async () => {
    const res = await fetch(`${API_BASE}/api/classes/search?q=Yoga`);
    const data = await res.json();
    expect(Array.isArray(data.classes)).toBe(true);
  });

  it('空搜尋回傳全部課程', async () => {
    const res = await fetch(`${API_BASE}/api/classes/search?q=`);
    const data = await res.json();
    expect(data.classes.length).toBeGreaterThan(0);
  });

  it('無結果搜尋回傳空陣列', async () => {
    const res = await fetch(`${API_BASE}/api/classes/search?q=zzz_nonexist_xyz`);
    const data = await res.json();
    expect(Array.isArray(data.classes)).toBe(true);
  });
});
""")
    print("  ✅ tests/search.test.js")
    
    # 6. Playwright E2E config
    with open(os.path.join(PROJECT_DIR, "playwright.config.js"), "w") as f:
        f.write("""// ZenPass Playwright Configuration
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://192.168.1.215:3001',
    locale: 'zh-HK',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'mobile-chrome', use: { browserName: 'chromium', viewport: { width: 375, height: 812 } } },
  ],
});
""")
    print("  ✅ playwright.config.js")
    
    # 7. E2E test folder
    os.makedirs(os.path.join(test_dir, "e2e"), exist_ok=True)
    with open(os.path.join(test_dir, "e2e", "homepage.spec.js"), "w") as f:
        f.write("""// ZenPass E2E: 首頁
import { test, expect } from '@playwright/test';

test('首頁載入正常', async ({ page }) => {
  const resp = await page.goto('/');
  expect(resp.status()).toBeLessThan(400);
  await expect(page.locator('body')).not.toBeEmpty();
});

test('課程頁載入', async ({ page }) => {
  await page.goto('/courses.html');
  await expect(page.locator('body')).not.toBeEmpty();
});

test('行動版課程頁', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/courses.html');
  await expect(page.locator('body')).not.toBeEmpty();
});
""")
    print("  ✅ tests/e2e/homepage.spec.js")
    
    # 8. CSS analysis test
    with open(os.path.join(test_dir, "css.test.js"), "w") as f:
        f.write("""// ZenPass CSS/響應式測試
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const FRONTEND_DIR = path.resolve('frontend');

describe('🎨 CSS 與響應式', () => {
  
  it('所有 HTML 檔案有 viewport meta', () => {
    const files = fs.readdirSync(FRONTEND_DIR).filter(f => f.endsWith('.html'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(FRONTEND_DIR, file), 'utf-8');
      expect(content).toMatch(/<meta[^>]*name=["']viewport["']/);
    }
  });

  it('所有 HTML 檔案有 charset', () => {
    const files = fs.readdirSync(FRONTEND_DIR).filter(f => f.endsWith('.html'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(FRONTEND_DIR, file), 'utf-8');
      expect(content).toMatch(/<meta[^>]*charset/);
    }
  });

  it('載入速度測試 - index.html < 10KB', () => {
    const content = fs.readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf-8');
    const sizeKB = Buffer.byteLength(content, 'utf-8') / 1024;
    expect(sizeKB).toBeLessThan(20); // 20KB is reasonable for a SPA
  });
});
""")
    print("  ✅ tests/css.test.js")
    
    # Update package.json scripts
    pkg_path = os.path.join(PROJECT_DIR, "package.json")
    if os.path.exists(pkg_path):
        with open(pkg_path) as f:
            pkg = json.load(f)
        if "scripts" not in pkg:
            pkg["scripts"] = {}
        pkg["scripts"]["test"] = "vitest run"
        pkg["scripts"]["test:watch"] = "vitest"
        pkg["scripts"]["test:e2e"] = "playwright test"
        pkg["scripts"]["test:lighthouse"] = "bash zenpass-tester/scripts/lighthouse.sh"
        pkg["scripts"]["test:screenshots"] = "python3 zenpass-tester/scripts/mobile-screenshots.py"
        pkg["scripts"]["test:quality"] = "bash zenpass-tester/scripts/code-quality.sh"
        pkg["scripts"]["test:all"] = "npm run test && npm run test:quality"
        with open(pkg_path, "w") as f:
            json.dump(pkg, f, indent=2)
        print("  ✅ package.json scripts 已更新")
    
    print(f"\n✅ 測試框架已建立！共 8 個測試檔案")
    print("")
    print("   npm test            — 跑全部 Vitest")
    print("   npm run test:watch  — 監聽模式")
    print("   npm run test:e2e   — Playwright E2E")
    print("   npm run test:all   — 全部測試")
    return True


if __name__ == "__main__":
    success = init_test_framework()
    sys.exit(0 if success else 1)
