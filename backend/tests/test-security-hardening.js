/**
 * ZenPass — 安全加固 tests（收據清洗／未付款佔位／審計 append-only／公開頁脫敏／驗證限流）
 * node backend/tests/test-security-hardening.js 2>/dev/null
 */
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "local-test-secret-0123456789abcdefgh";
const tmp = path.join(os.tmpdir(), "zenpass-sec-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log("  ✅ " + m); pass++; } else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT, address TEXT, status TEXT DEFAULT 'active');
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, loyalty_tier TEXT DEFAULT 'bronze',
    loyalty_tier_manual INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,phone,role) VALUES ('u1','Tester','t@x.hk','91234567','user')").run();
  pre.close();

  await require("../src/config/init-db")();
  const { getDb } = require("../src/services/database");
  const db = getDb();

  console.log("\n🧪 安全加固\n");

  // ============ 1. 收據圖片清洗 ============
  console.log("📋 1. 收據圖片清洗（magic byte / 體積 / EXIF）");
  const { sanitizeReceiptImage, MAX_BYTES } = require("../src/utils/image-sanitize");

  // 最小合法 PNG（1x1 透明）
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  let r = sanitizeReceiptImage("data:image/png;base64," + pngB64);
  ok(r.ok && r.kind === "png" && r.dataUrl.startsWith("data:image/png;base64,"), "合法 PNG 通過");

  r = sanitizeReceiptImage(null);
  ok(r.ok && r.dataUrl === null, "冇收據 → 通過（可選欄位）");

  r = sanitizeReceiptImage("data:image/svg+xml;base64," + Buffer.from("<svg onload=alert(1)>").toString("base64"));
  ok(!r.ok && r.code === "RECEIPT_UNSUPPORTED_TYPE", "SVG／腳本內容一律拒絕");

  r = sanitizeReceiptImage("data:image/png;base64," + Buffer.from("<?php system($_GET[1]); ?>").toString("base64"));
  ok(!r.ok && r.code === "RECEIPT_UNSUPPORTED_TYPE", "假稱 PNG 嘅 PHP 內容被 magic byte 擋");

  r = sanitizeReceiptImage("not-a-data-url");
  ok(!r.ok && r.code === "RECEIPT_INVALID", "非 data URL 拒絕");

  const big = Buffer.alloc(MAX_BYTES + 1024, 0x41);
  r = sanitizeReceiptImage("data:image/jpeg;base64," + big.toString("base64"));
  ok(!r.ok && (r.code === "RECEIPT_TOO_LARGE"), "超過 5MB 拒絕");

  // JPEG with EXIF (APP1) containing GPS string
  const exifPayload = Buffer.concat([
    Buffer.from("Exif\0\0", "latin1"),
    Buffer.from("GPSLatitude=22.3193;GPSLongitude=114.1694;", "latin1"),
  ]);
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1, 0x00, 0x00]),
    exifPayload,
  ]);
  app1.writeUInt16BE(exifPayload.length + 2, 2);
  const sof = Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 7, 8]); // fake SOS + data
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.from([0xff, 0xd9])]);
  r = sanitizeReceiptImage("data:image/jpeg;base64," + jpeg.toString("base64"));
  const decodedOut = Buffer.from((r.dataUrl || "").split(",")[1] || "", "base64");
  ok(r.ok && r.kind === "jpeg", "JPEG 通過");
  ok(decodedOut.includes(Buffer.from([0xff, 0xd8])) && decodedOut.includes(Buffer.from([0xff, 0xd9])), "JPEG 結構保留（SOI/EOI）");
  ok(!decodedOut.includes(Buffer.from("Exif", "latin1")), "EXIF 區塊已移除");
  ok(!decodedOut.includes(Buffer.from("GPSLatitude", "latin1")), "GPS 座標已移除");

  // PNG with tEXt chunk
  function pngChunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "latin1");
    const body = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4); // crc 不驗證，僅結構測試
    return Buffer.concat([len, body, crc]);
  }
  const pngWithText = Buffer.concat([
    Buffer.from(pngB64, "base64").slice(0, 8),
    pngChunk("IHDR", Buffer.alloc(13, 1)),
    pngChunk("tEXt", Buffer.from("Author\0David Choy", "latin1")),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  r = sanitizeReceiptImage("data:image/png;base64," + pngWithText.toString("base64"));
  const pngOut = Buffer.from((r.dataUrl || "").split(",")[1] || "", "base64");
  ok(r.ok && !pngOut.includes(Buffer.from("Author", "latin1")), "PNG tEXt（作者／GPS 描述）已移除");
  ok(pngOut.includes(Buffer.from("IHDR", "latin1")) && pngOut.includes(Buffer.from("IEND", "latin1")), "PNG 必要區塊保留");

  // ============ 2. 未付款佔位防護 ============
  console.log("\n📋 2. 未付款佔位防護（Denial-of-Inventory）");
  const { unpaidHoldGuard, HOLD_MAX } = require("../src/middleware/unpaid-hold-guard");
  ok(HOLD_MAX === 4, "上限 = 4 個未付款佔位");

  const cols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  ok(cols.includes("status") && cols.includes("created_at"), "bookings 表具備 status/created_at");

  // 建立最小 class + schedule（避免 FOREIGN KEY 失敗）
  db.prepare(
    `INSERT INTO classes (id, coach_id, title, category, duration, price_hkd, status, max_participants)
     VALUES ('c1','u1','測試班','新興運動',60,150,'active',10)`,
  ).run();
  db.prepare(
    `INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, status)
     VALUES ('s1','c1',datetime('now','+2 days'),datetime('now','+2 days','+1 hour'),10,'available')`,
  ).run();
  db.prepare(
    `INSERT INTO class_schedules (id, class_id, start_time, end_time, max_participants, status)
     VALUES ('s2','c1',datetime('now','+3 days'),datetime('now','+3 days','+1 hour'),10,'available')`,
  ).run();

  // 插入 3 個 pending_payment
  const ins = db.prepare(
    `INSERT INTO bookings (id, booking_reference, user_id, schedule_id, class_id, payment_type, payment_status, amount, status, created_at)
     VALUES (?,?,?,?,?, 'single', 'pending', 150, 'pending_payment', datetime('now'))`,
  );
  for (let i = 0; i < 3; i++) ins.run("b" + i, "REF" + i, "u1", "s1", "c1");

  const callGuard = () => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (x) => { res.body = x; return res; };
    let nexted = false;
    unpaidHoldGuard({ user: { id: "u1" }, headers: {}, ip: "1.1.1.1" }, res, () => { nexted = true; });
    return { res, nexted };
  };
  let g = callGuard();
  ok(g.nexted && g.res.statusCode === 200, "3 個佔位 → 放行");

  ins.run("b3", "REF3", "u1", "s2", "c1");
  g = callGuard();
  ok(!g.nexted && g.res.statusCode === 429 && g.res.body.code === "UNPAID_HOLD_LIMIT", "第 4 個佔位起 → 429 UNPAID_HOLD_LIMIT");

  // 30 分鐘前嘅舊佔位唔計
  db.prepare("UPDATE bookings SET created_at = datetime('now','-45 minutes') WHERE id='b1'").run();
  g = callGuard();
  ok(g.nexted, "超過 30 分鐘嘅舊佔位唔再計（自動釋放後可再落單）");

  // ============ 3. 審計日誌 append-only ============
  console.log("\n📋 3. 審計日誌只增不減");
  const { installDeleteTriggers } = require("../src/services/financial-protection");
  installDeleteTriggers();
  db.prepare(
    `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, new_values, description, created_at)
     VALUES ('a1','test.event','test','e1','u1','{}','原始紀錄', datetime('now'))`,
  ).run();
  let updBlocked = false, delBlocked = false;
  try { db.prepare("UPDATE audit_log SET description='改咗' WHERE id='a1'").run(); } catch (e) { updBlocked = true; }
  try { db.prepare("DELETE FROM audit_log WHERE id='a1'").run(); } catch (e) { delBlocked = true; }
  ok(updBlocked, "UPDATE audit_log 被 trigger 阻止");
  ok(delBlocked, "DELETE audit_log 被 trigger 阻止");
  const still = db.prepare("SELECT description FROM audit_log WHERE id='a1'").get();
  ok(still && still.description === "原始紀錄", "紀錄內容維持不變");

  // ============ 4. 公開驗證頁脫敏 + 限流 ============
  console.log("\n📋 4. 公開驗證頁（姓名脫敏／限流）");
  const certRouter = require("../src/routes/certificates");
  ok(typeof certRouter.maskStudentName === "function", "有姓名脫敏函數");
  ok(certRouter.maskStudentName("Chan Tai Man") === "C** T** M**", "英文姓名 → C** T** M**");
  ok(certRouter.maskStudentName("陳小明") === "陳**", "中文姓名 → 陳**");
  ok(certRouter.maskStudentName("李") === "李*", "單字姓名 → 李*");
  const verifyLayer = certRouter.stack.find((l) => l.route && l.route.path === "/verify/:code" && l.route.methods.get);
  ok(verifyLayer && verifyLayer.route.stack.length >= 2, "verify 路由已掛 middleware（含限流）");
  const certSrc = require("fs").readFileSync(path.join(__dirname, "../src/routes/certificates.js"), "utf8");
  ok(/max: process\.env\.NODE_ENV === "test" \? 1000 : 30/.test(certSrc), "驗證端點限流 30 次／分鐘");

  // ============ 5. 收據清洗已接入所有寫入點 ============
  console.log("\n📋 5. 收據清洗接入點");
  const files = ["payments.js", "credits.js", "membership-orders.js"];
  files.forEach((f) => {
    const src = require("fs").readFileSync(path.join(__dirname, "../src/routes", f), "utf8");
    ok(/sanitizeReceiptImage\(/.test(src) && /RECEIPT/.test(src) === false, `${f} 已接入清洗`);
  });
  const guestSrc = require("fs").readFileSync(path.join(__dirname, "../src/routes/guest.js"), "utf8");
  ok(/GUEST_BOOK_BATCH_LIMIT/.test(guestSrc), "訪客批量下單上限 6 個時段");
  ok(/HOLD_CAPACITY_GUARD/.test(guestSrc), "全站佔位上限保護");
  const bookingSrc = require("fs").readFileSync(path.join(__dirname, "../src/routes/bookings.js"), "utf8");
  ok(/unpaidHoldGuard/.test(bookingSrc), "登入用戶下單已掛佔位防護");

  console.log(`\n${fail === 0 ? "✅ 全部通過" : "❌ 有失敗"} — ${pass} 通過 / ${fail} 失敗\n`);
  try { require("fs").unlinkSync(tmp); } catch (e) {}
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
