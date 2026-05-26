// ZenPass 認證測試
import { describe, it, expect } from "vitest";

const API_BASE = "http://localhost:3001";

describe("🔐 認證系統", () => {
  it("登入成功回傳 token", async () => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@zenpass.hk", password: "admin123" }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.token).toBeTruthy();
  });

  it("錯誤密碼回傳 401", async () => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@zenpass.hk",
        password: "wrongpass",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("無 token 存取管理後台回傳 401", async () => {
    const res = await fetch(`${API_BASE}/api/admin/stats`);
    expect(res.status).toBe(401);
  });

  it("有效 token 可存取管理後台", async () => {
    const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@zenpass.hk", password: "admin123" }),
    });
    const { token } = await loginRes.json();

    const res = await fetch(`${API_BASE}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok).toBe(true);
  });
});
