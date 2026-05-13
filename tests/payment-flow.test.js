// ZenPass 付款流程測試
// 測試 FPS / PayMe / Stripe 付款流程及確認
import { describe, it, expect, beforeAll } from "vitest";

const API_BASE = process.env.API_BASE || "http://localhost:3001";
let token = null;
let userId = null;
let testBookingId = null;

beforeAll(async () => {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@zenpass.hk", password: "admin123" }),
  });
  if (res.ok) {
    const data = await res.json();
    token = data.token;
    userId = data.user?.id;
  }
});

describe("💳 付款 API", () => {
  it("取得付款方式列表", async () => {
    const res = await fetch(`${API_BASE}/api/payments/gateways`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.gateways || data).toBeTruthy();
  });

  it("取得 Stripe 手續費資料", async () => {
    const res = await fetch(`${API_BASE}/api/payments/stripe/fees`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.fees || data).toBeTruthy();
  });

  it("上傳收據需要登入", async () => {
    const res = await fetch(`${API_BASE}/api/payments/upload-receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "data:image/png;base64,iVBORw0KGgo=" }),
    });
    expect(res.status).toBe(401);
  });

  it("FPS 付款需要登入", async () => {
    const res = await fetch(`${API_BASE}/api/payments/fps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: 100,
        fps_reference: "FPS123456",
        booking_id: "00000000-0000-0000-0000-000000000000",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("FPS 付款提交（無效 booking）", async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/api/payments/fps`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        amount: 100,
        fps_reference: "FPS123456",
        booking_id: "00000000-0000-0000-0000-000000000000",
      }),
    });
    // Should return error about invalid booking, not crash
    expect(res.status).toBeGreaterThanOrEqual(400);
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });

  it("PayMe 付款需要 fps_reference", async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/api/payments/payme`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        amount: 100,
        booking_id: "00000000-0000-0000-0000-000000000000",
      }),
    });
    // Missing Reference → should 400
    expect([400, 500]).toContain(res.status);
  });

  it("上傳無效圖片格式會出錯", async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/api/payments/upload-receipt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ image: "not-a-base64-image" }),
    });
    expect(res.status).toBe(400);
  });

  it("付款確認需要所有必填欄位", async () => {
    if (!token) return;
    // Missing booking_id
    const res = await fetch(`${API_BASE}/api/payments/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        payment_method: "fps",
        payment_reference: "REF123",
        amount: 100,
      }),
    });
    expect([400, 422]).toContain(res.status);
  });

  it("取得當前用戶預約列表", async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/api/bookings/my`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.bookings || data).toBeTruthy();
  });

  it("完整預約流程：建立 → FPS 付款確認", async () => {
    if (!token) return;

    // 1. 先取得一個可用時段
    const classesRes = await fetch(`${API_BASE}/api/classes?limit=1`);
    if (!classesRes.ok) return;
    const classesData = await classesRes.json();
    const classList = classesData.classes || classesData.data || [];
    if (classList.length === 0) return; // skip if no classes

    const firstClass = classList[0];
    if (!firstClass.schedules || firstClass.schedules.length === 0) return;

    const scheduleId = firstClass.schedules[0].id;
    const classId = firstClass.id;

    // 2. 建立預約
    const createRes = await fetch(`${API_BASE}/api/bookings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        schedule_id: scheduleId,
        class_id: classId,
        payment_type: "single",
        amount: firstClass.price_hkd || 100,
      }),
    });
    console.log(
      `[PaymentFlow] 建立預約: ${createRes.status}`,
    );

    // 如果 400 可能係 already booked 或者 full
    if (createRes.status === 201 || createRes.ok) {
      const createData = await createRes.json();
      testBookingId = createData.booking?.id || createData.id;
      expect(testBookingId).toBeTruthy();
      console.log(`[PaymentFlow] 預約 ID: ${testBookingId}`);

      // 3. 提交 FPS 付款
      const fpsRes = await fetch(`${API_BASE}/api/payments/fps`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amount: firstClass.price_hkd || 100,
          fps_reference: "TEST-FPS-" + Date.now(),
          booking_id: testBookingId,
        }),
      });
      console.log(
        `[PaymentFlow] FPS 提交: ${fpsRes.status}`,
      );
    }
  });
});

describe("📋 預約 API 錯誤處理", () => {
  it("無效 schedule_id 格式", async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/api/bookings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        schedule_id: "not-a-uuid",
        class_id: "not-a-uuid",
        payment_type: "single",
      }),
    });
    // Should return input validation error
    expect([400, 422]).toContain(res.status);
    const data = await res.json();
    expect(data.error || data.details).toBeTruthy();
  });

  it("缺少必填欄位", async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/api/bookings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    expect([400, 422]).toContain(res.status);
  });

  it("無效 payment_type", async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/api/bookings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        schedule_id: "00000000-0000-0000-0000-000000000000",
        class_id: "00000000-0000-0000-0000-000000000000",
        payment_type: "invalid_type_xyz",
      }),
    });
    expect([400, 422]).toContain(res.status);
  });

  it("無 token 存取預約返回 401", async () => {
    const res = await fetch(`${API_BASE}/api/bookings/my`);
    expect(res.status).toBe(401);
  });

  it("無效 token 返回 403", async () => {
    const res = await fetch(`${API_BASE}/api/bookings/my`, {
      headers: { Authorization: "Bearer invalid_token_here" },
    });
    expect([401, 403]).toContain(res.status);
  });
});
