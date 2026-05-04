// ZenPass 課程詳情頁測試
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
