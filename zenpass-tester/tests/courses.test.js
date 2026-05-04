// ZenPass 課程頁測試
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
      expect(c.class_reference).toBeTruthy();
      expect(typeof c.class_reference).toBe('string');
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
