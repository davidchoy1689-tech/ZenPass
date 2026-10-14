/**
 * v2.1 module unit tests — 四邊拆賬 / holds / payment intent / catalog / outbox
 * 跑法：node tests/test-v21-modules.js（pre-commit 亦會自動跑）
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const tmp = path.join(os.tmpdir(), "v21-test.db");
[tmp, tmp + "-wal", tmp + "-shm"].forEach((f) => {
  try { fs.unlinkSync(f); } catch {}
});
process.env.DB_PATH = tmp;

const db = new Database(tmp);
db.exec(`
CREATE TABLE classes(id TEXT PRIMARY KEY, price_hkd REAL, credits_cost INTEGER);
CREATE TABLE bookings(id TEXT PRIMARY KEY, user_id TEXT, amount REAL, status TEXT, class_id TEXT, platform_earned_amount REAL, venue_earned_amount REAL);
CREATE TABLE ledger(id TEXT PRIMARY KEY, booking_id TEXT, user_id TEXT, reference TEXT, debit REAL, credit REAL, account_code TEXT, account_name TEXT, transaction_type TEXT, payment_method TEXT, description TEXT, created_at TEXT);
CREATE TABLE ledger_holds(id TEXT PRIMARY KEY, booking_id TEXT UNIQUE, user_id TEXT, amount REAL, asset TEXT, state TEXT, expires_at TEXT, committed_at TEXT, voided_at TEXT, reason TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE payment_intents(id TEXT PRIMARY KEY, booking_id TEXT UNIQUE, user_id TEXT, amount REAL, currency TEXT, method TEXT, psp TEXT, psp_ref TEXT, state TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE plan_versions(id TEXT PRIMARY KEY, plan_key TEXT, version INTEGER, price_hkd REAL, credits_granted INTEGER, features_json TEXT, effective_from TEXT, created_at TEXT, UNIQUE(plan_key,version));
CREATE TABLE entitlements(id TEXT PRIMARY KEY, user_id TEXT, key TEXT, value INTEGER, source TEXT, valid_until TEXT, created_at TEXT, updated_at TEXT, UNIQUE(user_id,key));
CREATE TABLE outbox_events(id TEXT PRIMARY KEY, topic TEXT, ref_type TEXT, ref_id TEXT, payload_json TEXT, status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), dispatched_at TEXT);
`);
db.prepare("INSERT INTO bookings VALUES('b1','u1',120,'confirmed','c1',20,30)").run();
db.prepare("INSERT INTO classes VALUES('c1',120,12)").run();

const acc = require("../src/services/accounting");
const lh = require("../src/services/ledger-holds");
const pi = require("../src/services/payment-intents");
const cat = require("../src/services/membership-catalog");
const ob = require("../src/services/outbox");

let ok = true;
const chk = (n, c) => { console.log((c ? "✅" : "❌") + " " + n); if (!c) ok = false; };

// 四邊拆賬：120 = 平台20 + 教練70 + 場地30
acc.postBookingSplitLedger("b1", "u1", 120, "credits");
const rows = db.prepare("SELECT * FROM ledger WHERE booking_id='b1'").all();
const dr = rows.reduce((s, r) => s + (r.debit || 0), 0);
const cr = rows.reduce((s, r) => s + (r.credit || 0), 0);
chk("four-way balanced 120=20+70+30", Math.abs(dr - 120) < 0.01 && Math.abs(cr - 120) < 0.01 && rows.some(r => r.account_code === "2001" && r.credit === 70) && rows.some(r => r.account_code === "2002" && r.credit === 30));
chk("four-way idempotent", acc.postBookingSplitLedger("b1", "u1", 120, "credits") === false);

// holds
lh.createHold("b1", "u1", 120, "credits");
chk("hold pending", db.prepare("SELECT state FROM ledger_holds WHERE booking_id='b1'").get().state === "pending");
chk("hold commit", lh.commitHold("b1") === true && db.prepare("SELECT state FROM ledger_holds WHERE booking_id='b1'").get().state === "committed");
lh.createHold("b9", "u1", 50, "credits"); lh.voidHold("b9", "test");
chk("hold void", db.prepare("SELECT state FROM ledger_holds WHERE booking_id='b9'").get().state === "voided");

// payment intent
pi.upsertIntent({ bookingId: "b1", userId: "u1", amount: 120, method: "fps", state: "succeeded" });
const pirow = db.prepare("SELECT state, psp FROM payment_intents WHERE booking_id='b1'").get();
chk("intent succeeded/fps", pirow.state === "succeeded" && pirow.psp === "fps");

// catalog + entitlements
cat.seedPlanVersions({ lite: { price_hkd: 299, credits_granted: 37, features: [] } });
chk("plan_versions seeded", db.prepare("SELECT COUNT(*) c FROM plan_versions").get().c === 1);
cat.grantEntitlements("u1", "silver", "2099-01-01T00:00:00Z");
chk("entitlement tier", cat.hasEntitlement("u1", "pt_sessions") === true && cat.hasEntitlement("u1", "dedicated_support") === false);

// outbox
ob.enqueue({ topic: "t.x", refId: "z1" });
chk("outbox pending", ob.counts().pending === 1);
ob.markDispatched(ob.pending()[0].id);
chk("outbox dispatched", ob.counts().dispatched === 1);

console.log(ok ? "✅ V2.1 MODULE TESTS PASS" : "❌ V2.1 MODULE TESTS FAIL");
process.exit(ok ? 0 : 1);
