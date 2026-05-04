// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './playwright',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../test-reports/playwright-report' }],
    ['json', { outputFile: '../test-reports/playwright-results.json' }]
  ],
  use: {
    baseURL: 'http://192.168.1.215:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'Desktop',
      use: { viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'Mobile',
      use: { viewport: { width: 375, height: 812 } },
    },
  ],
});
