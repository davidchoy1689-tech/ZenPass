/**
 * ZenPass 安全測試 — CSP Headers, Rate Limiting, Auth
 */
import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'http://localhost:3001';

describe('Security Headers', () => {
  it('API returns security headers', async () => {
    const res = await fetch(`${API_BASE}/api/health`);
    const headers = res.headers;
    expect(headers.get('x-request-id')).toBeTruthy();
    expect(
      headers.get('x-ratelimit-limit') ||
      headers.get('x-rate-limit-limit')
    ).toBeTruthy();
  });

  it('Helmet security headers present', async () => {
    const res = await fetch(`${API_BASE}/api/health`);
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
      const res = await fetch(`${API_BASE}${route}`);
      expect([401, 403, 302]).toContain(res.status);
    });
  }
});
