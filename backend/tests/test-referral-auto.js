/** ZenPass — 推薦碼自動入賬 tests（2026-10-20） */
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "***";
const tmp = path.join(os.tmpdir(), "zenpass-refauto-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', email_verified INTEGER DEFAULT 0, credits INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
    wallet_balance REAL DEFAULT 0, membership_type TEXT DEFAULT 'none', referral_credits_earned INTEGER DEFAULT 0,
    pending_referral_code TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE referral_codes (id TEXT PRIMARY KEY, user_id TEXT, code TEXT UNIQUE, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE referral_redemptions (id TEXT PRIMARY KEY, referrer_id TEXT, referred_user_id TEXT, code_used TEXT,
    status TEXT DEFAULT 'completed', created_at TEXT DEFAULT (datetime('now')));
  `);
  pre.prepare("INSERT INTO users (id,name,email,email_verified) VALUES ('ref1','推薦人','r@x.com',1)").run();
  pre.prepare("INSERT INTO users (id,name,email,email_verified) VALUES ('new1','新人','n@x.com',0)").run();
  pre.prepare("INSERT INTO referral_codes (id,user_id,code) VALUES ('rc1','ref1','ZPABCD1234')").run();
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();
  const { getDb } = require("../src/services/database");
  const db = getDb();

  const { redeemCode, autoRedeemPending } = require("../src/services/referral-service");

  console.log("🧪 推薦碼自動入賬 tests");

  // 未驗證 → 403
  const blocked = redeemCode("new1", "ZPABCD1234");
  ok(blocked.status === 403 && blocked.body.code === "EMAIL_NOT_VERIFIED", "未驗證 → 403");
  ok(db.prepare("SELECT credits FROM users WHERE id='new1'").get().credits === 0, "未驗證冇加 credits");

  // 模擬註冊帶入推薦碼 → 驗證後自動兌換
  db.prepare("UPDATE users SET pending_referral_code='ZPABCD1234' WHERE id='new1'").run();
  db.prepare("UPDATE users SET email_verified=1 WHERE id='new1'").run();
  const auto = autoRedeemPending("new1");
  ok(auto.redeemed === true, "驗證後自動兌換成功");

  const u1 = db.prepare("SELECT credits, referral_credits_earned, pending_referral_code FROM users WHERE id='new1'").get();
  const u2 = db.prepare("SELECT credits, referral_credits_earned FROM users WHERE id='ref1'").get();
  ok(Number(u1.credits) === 5 && Number(u1.referral_credits_earned) === 5, `新人 +5 credits（got ${u1.credits}）`);
  ok(Number(u2.credits) === 5 && Number(u2.referral_credits_earned) === 5, `推薦人 +5 credits（got ${u2.credits}）`);
  ok(u1.pending_referral_code === null, "pending code 已清除");

  const red = db.prepare("SELECT * FROM referral_redemptions WHERE referred_user_id='new1'").get();
  ok(!!red, "有 referral_redemptions 記錄");
  const tx = db.prepare("SELECT type, credits, description FROM credit_transactions WHERE source='referral' ORDER BY rowid").all();
  ok(tx.length === 2 && Number(tx[0].credits) === 5 && Number(tx[1].credits) === 5, `credits 流水有 2 筆各 5（got ${tx.length}）`);
  ok(tx.some((t) => /迎新/.test(t.description)) && tx.some((t) => /推薦朋友/.test(t.description)), "流水描述清晰");

  // 再 autoRedeem（已冇 pending）→ 不重複
  const auto2 = autoRedeemPending("new1");
  ok(auto2.redeemed === false, "唔會重複入賬");
  ok(Number(db.prepare("SELECT credits FROM users WHERE id='new1'").get().credits) === 5, "credits 仍然 5");

  // 自己推薦碼
  const self = redeemCode("ref1", "ZPABCD1234", { requireVerified: false });
  ok(self.status === 400, "自己推薦碼 → 400");

  console.log(fail === 0 ? "\n✅ 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
