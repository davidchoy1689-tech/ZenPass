// ZenPass 認證測試
import { describe, it, expect, beforeAll } from "vitest";

const API_BASE = process.env.API_BASE || "http://localhost:3001";
let adminToken = null;

beforeAll(async () => {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@zenpass.hk", password: "admin123" }),
    });
    if (res.ok) {
      const data = await res.json();
      adminToken = data.token;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
});

describe("🔐 認證系統", () => {
  it("登入成功回傳 token", async () => {
    expect(adminToken).toBeTruthy();
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
    expect([401, 429]).toContain(res.status);
  });

  it("無 token 存取管理後台回傳 401", async () => {
    const res = await fetch(`${API_BASE}/api/admin/stats`);
    expect([401, 429]).toContain(res.status);
  });

  it("有效 token 可存取管理後台", async () => {
    if (!adminToken) return;
    const res = await fetch(`${API_BASE}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect([200, 429]).toContain(res.status);
  });
});
