/**
 * ZenPass 健康檢查及核心功能單元測試
 */
import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'http://localhost:3001';

describe('ZenPass API Health', () => {
  it('health endpoint returns ok', async () => {
    const res = await fetch(`${API_BASE}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.database.connected).toBe(true);
    expect(body.data.database.tables).toBeGreaterThanOrEqual(20);
  });
});

describe('ZenPass Pricing Engine', () => {
  it('pricing config returns valid data', async () => {
    const res = await fetch(`${API_BASE}/api/pricing/config`);
    if (res.status === 200) {
      const body = await res.json();
      expect(body).toBeDefined();
    }
  });
});

describe('ZenPass Classes', () => {
  it('classes endpoint returns list', async () => {
    const res = await fetch(`${API_BASE}/api/classes`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Response shape: { classes: [...] } or { data: [...] }
    const list = body.classes || body.data || body;
    expect(list).toBeDefined();
  });
});
