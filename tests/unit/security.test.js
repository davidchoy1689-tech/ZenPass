/**
 * ZenPass 安全測試 — CSP Headers, Rate Limiting, Auth
 */
import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'http://localhost:3001';

// 用真實瀏覽器 UA — 避免反炒場中介軟體（anti-scalping）將測試 client 誤判為 bot
// （Node fetch / curl 嘅短 UA < 30 chars 會被當成自動化工具 → 429）
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_HEADERS = { 'User-Agent': BROWSER_UA };

describe('Security Headers', () => {
  it('API returns security headers', async () => {
    const res = await fetch(`${API_BASE}/api/health`, { headers: UA_HEADERS });
    const headers = res.headers;
    expect(headers.get('x-request-id')).toBeTruthy();
    // express-rate-limit v7 標準 header（standardHeaders: true）
    expect(
      headers.get('ratelimit-limit') ||
      headers.get('x-ratelimit-limit') ||
      headers.get('x-rate-limit-limit')
    ).toBeTruthy();
  });

  it('Helmet security headers present', async () => {
    const res = await fetch(`${API_BASE}/api/health`, { headers: UA_HEADERS });
    const headers = res.headers;
    const securityHeaders = [
      'x-content-type-options',
      'x-dns-prefetch-control',
      'x-download-options',
      'x-frame-options',
      'x-permitted-cross-domain-policies',
      'x-xss-protection',
    ];
    for (const h of securityHeaders) {
      expect(headers.get(h)).toBeTruthy();
    }
  });
});

describe('Auth Routes Protected', () => {
  const protectedRoutes = [
    '/api/wallet/balance',
    '/api/points',
    '/api/bookings/my',
    '/api/notifications',
    '/api/coach/earnings',
  ];

  for (const route of protectedRoutes) {
    it(`${route} rejects unauthenticated requests`, async () => {
      const res = await fetch(`${API_BASE}${route}`, { headers: UA_HEADERS });
      expect([401, 403, 302]).toContain(res.status);
    });
  }
});
