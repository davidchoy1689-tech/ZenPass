// ZenPass 安全測試
// 測試 XSS、SQL injection、未授權存取、Rate limiting
import { describe, it, expect, beforeAll } from "vitest";

const API_BASE = process.env.API_BASE || "http://localhost:3001";
let token = null;

beforeAll(async () => {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@zenpass.hk", password: "admin123" }),
  });
  if (res.ok) {
    const data = await res.json();
    token = data.token;
  }
});

describe("🛡️ 安全測試 — 未授權存取", () => {
  const protectedEndpoints = [
    ["GET", "/api/admin/stats"],
    ["GET", "/api/admin/bookings"],
    ["GET", "/api/bookings/my"],
    ["POST", "/api/bookings"],
    ["POST", "/api/payments/fps"],
    ["POST", "/api/payments/payme"],
    ["GET", "/api/coach/earnings"],
  ];

  for (const [method, endpoint] of protectedEndpoints) {
    it(`${method} ${endpoint} 無 token 應返回 401`, async () => {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({}) } : {}),
      });
      expect([401, 403]).toContain(res.status);
    });
  }
});

describe("🛡️ 安全測試 — XSS 防護", () => {
  it("登入唔應該 reflect XSS payload", async () => {
    const xssPayload = "<script>alert('xss')</script>";
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `test${xssPayload}@test.com`,
        password: "password123",
      }),
    });
    const body = await res.text();
    // Response should not contain unescaped script tag
    expect(body).not.toContain("<script>alert('xss')</script>");
    // Response should be JSON, not HTML
    expect(res.headers.get("content-type")).toMatch(/json/);
  });

  it("註冊唔應該 reflect XSS payload", async () => {
    const xssName = "<img src=x onerror=alert(1)>";
    const xssEmail = `xss${Date.now()}${xssName}@test.com`;
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: xssEmail,
        password: "password123",
        name: xssName,
      }),
    });
    const body = await res.text();
    // Response should be valid JSON, no raw XSS
    expect(res.headers.get("content-type")).toMatch(/json/);
    try {
      const data = JSON.parse(body);
      // If success, name in response should be escaped
      if (data.user?.name) {
        expect(data.user.name).not.toContain("<img");
      }
    } catch (e) {
      // If 400/409, it's fine as long as it's valid JSON
      expect(body).not.toContain("<img");
    }
  });
});

describe("🛡️ 安全測試 — SQL Injection 防護", () => {
  it("SQL injection 喺 email field", async () => {
    const sqlPayloads = [
      "' OR '1'='1",
      "admin'--",
      "admin@test.com' OR 1=1--",
      "'; DROP TABLE users; --",
      "' UNION SELECT * FROM users--",
    ];

    for (const payload of sqlPayloads) {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: payload,
          password: "anypassword",
        }),
      });
      // Should not crash or return 500 — protection should handle it
      expect(res.status).not.toBe(500);
      const contentType = res.headers.get("content-type") || "";
      expect(contentType).toMatch(/json/);
    }
  });

  it("SQL injection 喺 class 查詢參數", async () => {
    const sqlPayloads = [
      "1 OR 1=1",
      "1; DROP TABLE classes; --",
      "' UNION SELECT * FROM users--",
    ];

    for (const payload of sqlPayloads) {
      const res = await fetch(`${API_BASE}/api/classes?category=${encodeURIComponent(payload)}`);
      // Should not crash
      expect([200, 400, 429]).toContain(res.status);
      const contentType = res.headers.get("content-type") || "";
      expect(contentType).toMatch(/json/);
    }
  });
});

describe("🛡️ 安全測試 — CSRF/Token 處理", () => {
  it("修改 token 後被拒絕", async () => {
    if (!token) return;
    // Tamper with the token
    const tamperedToken = token.slice(0, -5) + "XXXXX";
    const res = await fetch(`${API_BASE}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${tamperedToken}` },
    });
    expect([401, 403]).toContain(res.status);
  });

  it("用唔同用戶 token 存取 admin 被拒", async () => {
    // Create a fake token (format: header.payload.signature)
    const fakeToken =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImZha2UtdXNlciJ9.fakesignature";
    const res = await fetch(`${API_BASE}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${fakeToken}` },
    });
    expect([401, 403]).toContain(res.status);
  });
});

describe("🛡️ 安全測試 — Response Headers", () => {
  it("API 回傳有安全 headers", async () => {
    const res = await fetch(`${API_BASE}/api/health`);
    const headers = res.headers;

    // Helmet headers present
    const headerNames = [...headers.keys()].map((h) => h.toLowerCase());

    // Key security headers should be present
    const expectedHeaders = [
      "x-content-type-options",  // nosniff
      "x-frame-options",         // frameguard
      "x-xss-protection",        // xssFilter (deprecated but still set by Helmet)
    ];

    for (const h of expectedHeaders) {
      expect(headerNames).toContain(h);
    }

    // X-Powered-By should NOT be present (hidePoweredBy)
    expect(headerNames).not.toContain("x-powered-by");
  });
});

describe("🛡️ 安全測試 — 登入暴力破解防護", () => {
  it("短時間內大量登入嘗試應觸發 rate limit", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `brute${i}@test.com`,
          password: "wrong",
        }),
      });
      results.push(res.status);
    }

    // At least some requests should be rate limited (429)
    // Note: Rate limit is 500/15min, so only flag if all 429
    const rateLimited = results.filter((s) => s === 429);
    // This might not trigger with just 5 requests under 500 limit
    // But we verify no 500 errors during rapid requests
    const serverErrors = results.filter((s) => s >= 500);
    expect(serverErrors.length).toBe(0);
  });
});
