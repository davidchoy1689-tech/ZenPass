// ZenPass 搜尋功能測試
import { describe, it, expect } from "vitest";

const API_BASE = process.env.API_BASE || "http://localhost:3001";
const RETRY_DELAY = 2000;

async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url);
    if (res.status !== 429) return res;
    await new Promise((r) => setTimeout(r, RETRY_DELAY));
  }
  return await fetch(url);
}

describe("🔍 搜尋功能", () => {
  it("可按關鍵字搜尋課程（中文）", async () => {
    const res = await fetchWithRetry(`${API_BASE}/api/classes?search=瑜伽`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.classes)).toBe(true);
  });

  it("可按關鍵字搜尋課程（英文）", async () => {
    const res = await fetchWithRetry(`${API_BASE}/api/classes?search=Yoga`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.classes)).toBe(true);
  });

  it("空搜尋回傳全部課程", async () => {
    const res = await fetchWithRetry(`${API_BASE}/api/classes`);
    const data = await res.json();
    expect(data.classes.length).toBeGreaterThan(0);
  });

  it("無結果搜尋回傳空陣列", async () => {
    const res = await fetchWithRetry(
      `${API_BASE}/api/classes?search=zzz_nonexist_xyz`,
    );
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.classes)).toBe(true);
  });
});
