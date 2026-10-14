const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const tmp = path.join(os.tmpdir(), "ledger-test.db");
try { fs.unlinkSync(tmp); } catch {}
try { fs.unlinkSync(tmp + "-wal"); } catch {}
try { fs.unlinkSync(tmp + "-shm"); } catch {}
process.env.DB_PATH = tmp;

const db = new Database(tmp);
db.exec(`
CREATE TABLE bookings(id TEXT PRIMARY KEY, user_id TEXT, amount REAL,
  platform_commission_rate REAL, platform_earned_amount REAL, venue_earned_amount REAL);
CREATE TABLE ledger(id TEXT PRIMARY KEY, booking_id TEXT, user_id TEXT, reference TEXT,
  debit REAL, credit REAL, account_code TEXT, account_name TEXT, transaction_type TEXT,
  payment_method TEXT, description TEXT, created_at TEXT);
`);
// 四邊拆賬：amount 100 = 平台 20 + 教練 50 + 場地 30
db.prepare("INSERT INTO bookings VALUES(?,?,?,?,?,?)").run("b1", "u1", 100, 0.25, 20, 30);

const acc = require("../src/services/accounting");

const r1 = acc.postBookingLedger("b1", "u1", 100, "credits", 0.25);
const rows = db.prepare("SELECT * FROM ledger WHERE booking_id='b1'").all();
const dr = rows.reduce((s, r) => s + (r.debit || 0), 0);
const cr = rows.reduce((s, r) => s + (r.credit || 0), 0);
console.log("call1 returned:", r1, "| ledger rows:", rows.length);
console.log("debit=", dr, "credit=", cr, "| balanced:", Math.abs(dr - cr) < 0.001);
const types = rows.map(r => r.transaction_type).sort().join(",");
console.log("entry types:", types);
const accts = rows.map(r => r.account_code).sort().join(",");
console.log("accounts:", accts);

const r2 = acc.postBookingLedger("b1", "u1", 100, "credits", 0.25);
console.log("call2 (idempotent) returned:", r2, "| total ledger rows:", db.prepare("SELECT COUNT(*) c FROM ledger").get().c);

const r3 = acc.postBookingLedger("b2", "u1", 0, "credits", 0.25);
console.log("zero-amount returned:", r3);

// 四邊拆賬預期：資產 100 (借) = 平台 20 + 教練 50 + 場地 30 (貸) → 4 行
const hasCredit = (code, amt) => rows.some(r => r.account_code === code && Math.abs(r.credit - amt) < 0.001);
const ok =
  rows.length === 4 &&
  Math.abs(dr - cr) < 0.001 &&
  Math.abs(dr - 100) < 0.001 &&
  hasCredit("3000", 20) && hasCredit("2001", 50) && hasCredit("2002", 30) &&
  r1 === true && r2 === false && r3 === false &&
  db.prepare("SELECT COUNT(*) c FROM ledger").get().c === 4;
console.log(ok ? "✅ UNIT TEST PASS" : "❌ UNIT TEST FAIL");
process.exit(ok ? 0 : 1);
