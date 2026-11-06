/**
 * 免登入只讀分享簽章（HMAC 16 hex）
 */
const fs = require("fs");
const path = require("path");
process.env.SHARE_TOKEN_SECRET = process.env.SHARE_TOKEN_SECRET || "test-share-secret-0123456789";

const { make, verify, maskedPhone } = require("../src/services/share-token");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

const B = {
  id: "b1", phone: "98765432", schedule_id: "s1", created_at: "2026-11-06 10:00:00",
};

console.log("\n🧪 1. 簽章生成與驗證");
{
  const sig = make(B);
  ok("16 位十六進制", /^[0-9a-f]{16}$/.test(sig), sig);
  ok("正確簽名可通過", verify(B, sig) === true);
  ok("大小寫不敏感", verify(B, sig.toUpperCase()) === true);
  ok("空簽名拒絕", verify(B, "") === false);
  ok("亂字拒絕", verify(B, "aaaaaaaaaaaaaaaa") === false);
  ok("格式錯拒絕", verify(B, "xyz") === false);
}

console.log("\n🧪 2. 防篡改 / 防遍歷");
{
  const sig = make(B);
  ok("改 id → 拒絕（IDOR）", verify({ ...B, id: "b2" }, sig) === false);
  ok("改電話 → 拒絕", verify({ ...B, phone: "91234567" }, sig) === false);
  ok("改班次 → 拒絕", verify({ ...B, schedule_id: "s9" }, sig) === false);
  ok("改建立時間 → 拒絕", verify({ ...B, created_at: "2026-11-06 11:00:00" }, sig) === false);
  ok("同一個 booking 可重複驗證", verify(B, make(B)) === true);
}

console.log("\n🧪 3. 電話脫敏");
{
  ok("香港 8 位 → 頭 4 位 + ****", maskedPhone("98765432") === "9876****", maskedPhone("98765432"));
  ok("852 前綴自動去掉", maskedPhone("85298765432") === "9876****");
  ok("有空格/符號仍可", maskedPhone("9876 5432") === "9876****");
  ok("短號碼 → 空（唔會泄露）", maskedPhone("123") === "");
}

console.log("\n🧪 4. 公開端點（只讀 + 最小權限）");
{
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "public.js"), "utf8");
  ok("路由 GET /bookings/:id", /router\.get\("\/bookings\/:id"/.test(src));
  ok("必須驗簽", /shareToken\.verify\(/.test(src));
  ok("失敗回 403 統一訊息", /403[\s\S]{0,120}連結已失效或無效/.test(src));
  ok("不存在與錯簽名同一回應（防探測）", /if \(!b \|\| !shareToken\.verify/.test(src));
  ok("no-store", /Cache-Control", "no-store"/.test(src));
  ok("有 QR payload", /bookingQr\.make\(b\.id\)/.test(src));
  ok("有教練評語", /coach_tags/.test(src));
  ok("已掛載 /api/public", /app\.use\("\/api\/public"/.test(fs.readFileSync(path.join(__dirname, "..", "src", "index.js"), "utf8")));
}

console.log("\n🧪 5. 敏感欄位過濾");
{
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "public.js"), "utf8");
  const payload = src.slice(src.indexOf("res.json({"), src.indexOf("exports"));
  ok("唔回傳金額", !/amount/.test(src));
  ok("唔回傳付款狀態", !/payment_status/.test(src));
  ok("唔回傳 email", !/email/.test(src));
  ok("有 read_only 標記", /read_only: true/.test(src));
  ok("緊急電話只回脫敏", /phone_masked/.test(src));
}

console.log("\n🧪 6. 前端整合");
{
  const mb = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "my-bookings.html"), "utf8");
  const sv = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "senior-view.html"), "utf8");
  const ap = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "adult-pass.html"), "utf8");
  ok("my-bookings 有複製大字版連結", /複製大字版連結/.test(mb) && /data-copy="senior-view\.html"/.test(mb));
  ok("my-bookings 有複製票券連結", /複製票券連結/.test(mb) && /data-copy="adult-pass\.html"/.test(mb));
  ok("只用有 share 的訂單顯示", /b\.share \?/.test(mb));
  ok("複製成功 Toast", /已複製免登入連結/.test(mb));
  ok("senior-view 支援 share", /const SHARE = qs\.get\("share"\)/.test(sv) && /api\/public\/bookings\//.test(sv));
  ok("adult-pass 支援 share", /const SHARE = qs\.get\("share"\)/.test(ap) && /api\/public\/bookings\//.test(ap));
  ok("分享模式唔會硬撥號（電話已脫敏）", /if \(ephone\) \{/.test(sv));
  ok("/bookings/my 會附 share", /shareToken\.make\(/.test(fs.readFileSync(path.join(__dirname, "..", "src", "routes", "bookings.js"), "utf8")));
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
