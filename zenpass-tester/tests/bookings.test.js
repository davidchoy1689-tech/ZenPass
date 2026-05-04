// ZenPass 預約流程測試
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
