/**
 * ZenPass — 錢包對帳巡邏
 * 每日檢查 wallet_balance 同 pending_payout 有冇不一致，有就通知 admin（每日一次）。
 */

const { getDb } = require("./database");
const { notifyAdmins } = require("./notify-admins");

function hkDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function auditWalletBalances({ now = new Date() } = {}) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, email, wallet_balance, pending_payout FROM users
       WHERE COALESCE(wallet_balance,0) <> 0 OR COALESCE(pending_payout,0) <> 0`,
    )
    .all();

  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const mismatches = [];
  for (const r of rows) {
    const diff = round((Number(r.wallet_balance) || 0) - (Number(r.pending_payout) || 0));
    if (Math.abs(diff) > 0.009) {
      mismatches.push({
        user_id: r.id,
        name: r.name,
        email: r.email,
        wallet_balance: round(r.wallet_balance),
        pending_payout: round(r.pending_payout),
        diff,
      });
    }
  }

  let notified = 0;
  if (mismatches.length) {
    const day = hkDate(now);
    const key = "wallet.reconcile_alert." + day;
    const seen = db.prepare("SELECT value FROM platform_settings WHERE key = ?").get(key);
    if (!seen) {
      const sample = mismatches
        .slice(0, 5)
        .map((m) => `${m.name || m.email || m.user_id}: wallet ${m.wallet_balance} / pending ${m.pending_payout}`)
        .join("\n");
      notified = notifyAdmins("wallet.mismatch", {
        count: mismatches.length,
        sample,
        date: day,
      });
      db.prepare("INSERT OR REPLACE INTO platform_settings (key, value) VALUES (?, ?)").run(
        key,
        new Date().toISOString(),
      );
    }
  }

  return { checked: rows.length, mismatches: mismatches.length, notified };
}

module.exports = { auditWalletBalances };
