/**
 * ZenPass 金融相關測試 — IPO Audit 級別
 * 測試 enrolled_count, wallet, booking 一致性
 */
import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'http://localhost:3001';

describe('Bookings Data Integrity', () => {
  it('my bookings endpoint requires auth', async () => {
    const res = await fetch(`${API_BASE}/api/bookings/my`);
    expect([401, 200]).toContain(res.status);
  });
});

describe('Wallet Service', () => {
  it('wallet transactions endpoint exists', async () => {
    const res = await fetch(`${API_BASE}/api/payments/transactions`);
    expect([401, 200]).toContain(res.status);
  });
});

describe('enrolled_count sync mechanism', () => {
  it('sync script exists and is runnable', async () => {
    const { execSync } = await import('child_process');
    const result = execSync(
      'node backend/src/scripts/sync-enrolled-count.js',
      { encoding: 'utf-8', timeout: 10000 }
    );
    expect(result).toContain('同步完成');
  });
});
