// ZenPass 搜尋功能測試
import { describe, it, expect } from "vitest";

const API_BASE = "http://localhost:3001";

describe("🔍 搜尋功能", () => {
  it("可按關鍵字搜尋課程（中文）", async () => {
    const res = await fetch(`${API_BASE}/api/classes?search=瑜伽`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.classes)).toBe(true);
    expect(data.classes.length).toBeGreaterThan(0);
  });

  it("可按關鍵字搜尋課程（英文）", async () => {
    const res = await fetch(`${API_BASE}/api/classes?search=Yoga`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.classes)).toBe(true);
  });

  it("空搜尋回傳全部課程", async () => {
    const res = await fetch(`${API_BASE}/api/classes`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.classes.length).toBeGreaterThan(0);
  });

  it("無結果搜尋回傳空陣列", async () => {
    const res = await fetch(`${API_BASE}/api/classes?search=zzz_nonexist_xyz`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.classes)).toBe(true);
    expect(data.classes.length).toBe(0);
  });
});
