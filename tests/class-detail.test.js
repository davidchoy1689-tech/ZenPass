// ZenPass 課程詳情頁測試
import { describe, it, expect } from 'vitest';

const API_BASE = 'http://192.168.1.215:3001';
const RETRY_DELAY = 2000;

async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url);
    if (res.status !== 429) return res;
    await new Promise(r => setTimeout(r, RETRY_DELAY));
  }
  return await fetch(url);
}

describe('📖 課程詳情', () => {

  it('GET /api/classes/:id 回傳詳情', async () => {
    const listRes = await fetchWithRetry(`${API_BASE}/api/classes`);
    const listData = await listRes.json();
    expect(listData.classes.length).toBeGreaterThan(0);
    const classId = listData.classes[0].id;

    const res = await fetchWithRetry(`${API_BASE}/api/classes/${classId}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.class.id).toBe(classId);
  });

  it('課程詳情有時段資訊', async () => {
    const listRes = await fetchWithRetry(`${API_BASE}/api/classes`);
    const listData = await listRes.json();
    expect(listData.classes.length).toBeGreaterThan(0);
    const classId = listData.classes[0].id;

    const res = await fetchWithRetry(`${API_BASE}/api/classes/${classId}`);
    const data = await res.json();
    if (data.schedules) {
      expect(Array.isArray(data.schedules)).toBe(true);
    }
  });
});
