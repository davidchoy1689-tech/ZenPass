/**
 * test-guest-rate-limit.js — 訪客預約多維限流單元測試
 * 跑法：node backend/tests/test-guest-rate-limit.js
 */
const assert = require("assert");
const guard = require("../src/middleware/guest-booking-guard");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("✅ " + name); pass++; }
  catch (e) { console.log("❌ " + name + " — " + e.message); fail++; }
}

function makeReq(body, ip) {
  return { body, ip: ip || "1.1.1.1", headers: {}, connection: {} };
}

function makeRes() {
  const r = {
    statusCode: 200,
    headers: {},
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
  return r;
}

function run(req) {
  const res = makeRes();
  let nexted = false;
  guard.guard(req, res, () => { nexted = true; });
  return { res, nexted };
}

const BODY = (phone, sid) => ({ name: "測試", phone, classId: "c1", scheduleIds: [sid || "s1"] });

guard._resetAll();

t("前 5 次同 IP 全部通過", () => {
  for (let i = 0; i < 5; i++) {
    const { res, nexted } = run(makeReq(BODY("9111000" + i, "s-" + i)));
    assert.ok(nexted, "第 " + (i + 1) + " 次被擋: " + JSON.stringify(res.body));
  }
});

t("第 6 次同 IP → 429 + 契約欄位", () => {
  const { res, nexted } = run(makeReq(BODY("92220001", "s1")));
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(res.body.error, "rate_limited");
  assert.strictEqual(res.body.code, "GUEST_BOOKING_RATE_LIMIT");
  assert.ok(res.body.retry_after_sec > 0, "retry_after_sec 應 > 0");
  assert.ok(res.headers["Retry-After"], "應有 Retry-After 標頭");
});

t("被拒請求唔會消耗其他維度配額（回滾）", () => {
  // 新 IP、新電話 → 應可用
  const { nexted } = run(makeReq(BODY("93330001", "s2"), "2.2.2.2"));
  assert.ok(nexted, "回滾失敗：其他維度被連累");
});

guard._resetAll();

t("同電話第 4 次 → 429（3/小時）", () => {
  const ip = "3.3.3.";
  for (let i = 0; i < 3; i++) {
    const { nexted } = run(makeReq(BODY("94440001", "s" + i), ip + (i + 1)));
    assert.ok(nexted, "第 " + (i + 1) + " 次應通過");
  }
  const { res, nexted } = run(makeReq(BODY("94440001", "s9"), ip + "9"));
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 429);
});

guard._resetAll();

t("同班次第 4 次 → 429（3/10 分鐘）", () => {
  for (let i = 0; i < 3; i++) {
    const { nexted } = run(makeReq(BODY("9555000" + i, "same-sess"), "4.4.4." + (i + 1)));
    assert.ok(nexted, "第 " + (i + 1) + " 次應通過");
  }
  const { res, nexted } = run(makeReq(BODY("95559999", "same-sess"), "4.4.4.99"));
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 429);
});

guard._resetAll();

t("電話正規化：+852 空格不影響計數", () => {
  const a = run(makeReq(BODY("+852 9666 0001", "z1"), "5.5.5.1"));
  assert.ok(a.nexted);
  const b = run(makeReq(BODY("96660001", "z2"), "5.5.5.2"));
  assert.ok(b.nexted);
  const c = run(makeReq(BODY("9666-0001", "z3"), "5.5.5.3"));
  assert.ok(c.nexted);
  const d = run(makeReq(BODY("96660001", "z4"), "5.5.5.4"));
  assert.strictEqual(d.res.statusCode, 429, "第 4 次應被電話維度擋住");
  assert.strictEqual(guard.normPhone("+852 9666 0001"), "96660001");
});

guard._resetAll();

t("sessionKeyOf 排序一致（時段次序不影響）", () => {
  assert.strictEqual(
    guard.sessionKeyOf({ classId: "c", scheduleIds: ["b", "a"] }),
    guard.sessionKeyOf({ classId: "c", scheduleIds: ["a", "b"] }),
  );
});

t("GUEST_GUARD_DISABLED=1 可完全停用（應急開關）", () => {
  process.env.GUEST_GUARD_DISABLED = "1";
  guard._resetAll();
  for (let i = 0; i < 20; i++) {
    const { nexted } = run(makeReq(BODY("97770001", "s1")));
    assert.ok(nexted, "停用後第 " + (i + 1) + " 次應通過");
  }
  delete process.env.GUEST_GUARD_DISABLED;
});

console.log(`\n${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
