/**
 * 長者隨身簽到卡（90×54mm）— 資料組裝 / 安全 / 版面規格
 */
const fs = require("fs");
const path = require("path");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));
const { loadBookingCard, honorific, hktParts } = require("../src/services/senior-card");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

function db() {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT, gender TEXT, birth_year INTEGER,
      emergency_name TEXT, emergency_phone TEXT, email TEXT);
    CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT, venue_name TEXT, venue_address TEXT);
    CREATE TABLE class_schedules (id TEXT PRIMARY KEY, start_time TEXT, end_time TEXT);
    CREATE TABLE bookings (id TEXT PRIMARY KEY, booking_reference TEXT, user_id TEXT, class_id TEXT, schedule_id TEXT,
      status TEXT, payment_status TEXT, attendee_type TEXT, child_name TEXT, medical_notes TEXT,
      emergency_phone TEXT, parent_name TEXT, parent_phone TEXT);
    CREATE TABLE platform_settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  d.prepare("INSERT INTO users VALUES ('u1','陳小明','91234567','male',1950,'陳太','92345678','kid@example.com')").run();
  d.prepare("INSERT INTO users VALUES ('u2','李玉珍','98765432','female',1948,NULL,NULL,NULL)").run();
  d.prepare("INSERT INTO classes VALUES ('c1','樂齡深層伸展','青衣楓樹窩體育館','青衣楓樹窩路 1 號 1 樓活動室')").run();
  d.prepare("INSERT INTO class_schedules VALUES ('s1','2026-12-12T02:30:00.000Z','2026-12-12T04:00:00.000Z')").run();
  d.prepare(`INSERT INTO bookings VALUES ('b1','ZP-1212-003','u1','c1','s1','confirmed','paid','parent','陳大文',
    '右膝微創手術（避免深蹲）','','陳大文','91234567')`).run();
  d.prepare(`INSERT INTO bookings VALUES ('b2','ZP-1212-004','u2','c1','s1','confirmed','paid','self',NULL,NULL,NULL,NULL,NULL)`).run();
  return d;
}

console.log("\n🧪 1. 稱呼與時間");
{
  ok("男性 → 伯伯", honorific("male") === "伯伯");
  ok("女性 → 婆婆", honorific("female") === "婆婆");
  ok("未填性別 → 空（只顯示姓名）", honorific("", 1950) === "先生／女士" || honorific("") === "");
  const t = hktParts("2026-12-12T02:30:00.000Z");
  ok("UTC 02:30 → HKT 10:30", t.time === "10:30", t.time);
  ok("HKT 星期六", t.weekday === "星期六", t.weekday);
  ok("日期 2026-12-12", t.date === "2026-12-12");
}

console.log("\n🧪 2. 代報長者（子女付款）");
{
  const c = loadBookingCard(db(), "b1");
  ok("學員名 = 長者本人（parent_name）", c.student_name === "陳大文", c.student_name);
  ok("顯示名帶稱呼", c.display_name === "陳大文 伯伯", c.display_name);
  ok("健康備註入卡", c.health_notes.includes("右膝微創"), c.health_notes);
  ok("緊急聯絡人 = 帳戶子女", c.emergency_name === "陳太", c.emergency_name);
  ok("緊急電話 = 子女電話", String(c.emergency_phone).includes("9234"), c.emergency_phone);
  ok("預約編號", c.booking_reference === "ZP-1212-003");
  ok("時間 HKT 10:30", c.time === "10:30");
  ok("場地", c.venue_name.includes("楓樹窩"));
  ok("唔會輸出 email／HKID", !JSON.stringify(c).includes("@") && !JSON.stringify(c).includes("HKID"));
}

console.log("\n🧪 3. 自己報名（長者本人）");
{
  const c = loadBookingCard(db(), "b2");
  ok("學員名 = 帳戶姓名", c.student_name === "李玉珍");
  ok("女性 → 婆婆", c.salute === "婆婆");
  ok("無健康備註 → 空字串", c.health_notes === "");
  ok("預設支援電話 9033 5538", c.support_phone === "9033 5538", c.support_phone);
  ok("有預設路線提示", !!c.route_hint);
}

console.log("\n🧪 4. platform_settings 可覆寫");
{
  const d = db();
  d.prepare("INSERT INTO platform_settings VALUES ('card.support_phone','2111 2222')").run();
  d.prepare("INSERT INTO platform_settings VALUES ('card.route_hint','自訂路線')").run();
  const c = loadBookingCard(d, "b2");
  ok("支援電話可設定", c.support_phone === "2111 2222");
  ok("路線提示可設定", c.route_hint === "自訂路線");
}

console.log("\n🧪 5. 版面規格（打印）");
{
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "senior-card.html"), "utf8");
  ok("@page 90mm × 54mm", /@page\s*\{\s*size:\s*90mm\s+54mm/.test(html));
  ok("邊界 0", /@page[^}]*margin:\s*0/.test(html));
  ok("卡片 90mm × 54mm", /width:\s*90mm/.test(html) && /height:\s*54mm/.test(html));
  ok("QR 32mm × 32mm", /\.qrbox\{[^}]*width:\s*32mm/.test(html) && /height:\s*32mm/.test(html));
  ok("姓名 20pt 粗體", /\.name\{[^}]*font-size:\s*20pt/.test(html) && /font-weight:\s*900/.test(html));
  ok("警示框黃底紅字", /--warn-bg:#fff7d6/.test(html) && /--warn:#b91c1c/.test(html));
  ok("背面緊急電話 14pt", /\.emerg \.pn\{[^}]*font-size:\s*14pt/.test(html));
  ok("列印時隱藏按鈕", /@media print\{[\s\S]{0,300}\.no-print\{ display:none/.test(html));
  ok("有列印按鈕", /🖨️ 列印 \/ 存 PDF/.test(html));
  ok("有 demo 預覽模式", /DEMO_CARD/.test(html) && /get\("demo"\)\s*===\s*"1"/.test(html));
  ok("掃碼內容用 zenpass:checkin", /zenpass:checkin/.test(html));
}

console.log("\n🧪 6. API 接線與權限");
{
  const bookings = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "bookings.js"), "utf8");
  const guest = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "guest.js"), "utf8");
  ok("GET /bookings/:id/card", /router\.get\("\/:id\/card",\s*authenticateToken/.test(bookings));
  ok("會員卡有 canAccessBooking 權限檢查", /\[CARD\][\s\S]{0,600}canAccessBooking|canAccessBooking[\s\S]{0,400}\[CARD\]/.test(bookings) || /canAccessBooking\(booking, req\.user\)/.test(bookings));
  ok("訪客卡端點存在", /router\.get\("\/booking-card"/.test(guest));
  ok("訪客卡要 guest_session 驗證", /guest_sessions WHERE token=\? AND expires_at/.test(guest));
  ok("訪客卡核對 booking 擁有權", /b\.user_id !== sess\.user_id/.test(guest));
}

console.log("\n🧪 7. 付款成功頁有下載入口");
{
  const b = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "booking.html"), "utf8");
  ok("有隨身卡按鈕", /id="seniorCardBtn"/.test(b));
  ok("文案：下載長者隨身卡", /下載長者隨身卡/.test(b));
  ok("會員連結帶 booking id", /senior-card\.html\?id=/.test(b));
  ok("訪客連結帶 token", /&token=.*guestToken/.test(b));
  ok("多筆預約時隱藏（避免印錯）", /payIds\.length <= 1/.test(b));
}

console.log("\n🧪 8. 回歸：源碼唔可以有被遮蔽的 SQL 佔位符");
{
  const routesDir = path.join(__dirname, "..", "src");
  const bad = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "logs" && e.name !== "node_modules") walk(p); }
    else if (e.name.endsWith(".js")) {
      const t = fs.readFileSync(p, "utf8");
      if (/=\*\*\*/.test(t)) bad.push(p.replace(routesDir, "src"));
    }
  });
  walk(routesDir);
  ok("冇 `=***` 洩漏（會令 SQL 直接報錯）", bad.length === 0, bad.join(", "));
  const guest = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "guest.js"), "utf8");
  ok("guest claim-payment 用參數化 token", /claim-payment[\s\S]{0,500}guest_sessions WHERE token=\?/.test(guest));
}

console.log(`\n📊 結果: ${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
