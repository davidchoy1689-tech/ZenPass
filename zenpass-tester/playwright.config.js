// ZenPass Playwright Configuration
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3001',
    locale: 'zh-HK',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'mobile-chrome', use: { browserName: 'chromium', viewport: { width: 375, height: 812 } } },
  ],
});
