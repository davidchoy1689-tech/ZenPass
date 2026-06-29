/**
 * ZenPass 禪流 — 錢包服務
 *
 * 核心邏輯：
 * - creditCoachEarning() — 課堂 attended → 自動入帳教練錢包
 * - debitWallet() — 扣數（提現、租場）
 * - getBalance() — 查詢結餘
 * - getTransactions() — 交易記錄（含 source 詳情）
 *
 * 設計原則：
 * - 所有金錢變動必須有完整 audit trail
 * - 每筆交易可追溯到 source (booking / class / payout)
 * - balance 用 double-entry 方式確保準確性
 */

const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");
const { writeBlock } = require("./blockchain-audit");

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

/**
 * 教練收入自動入帳
 * 喺 student attended 後自動 call 呢個 function
 *
 * @param {string} coachId - 教練 user id
 * @param {string} scheduleId - 課堂 schedule id
 * @param {string} coachEarningId - coach_earnings 記錄 id
 * @param {number} netAmount - 教練實收金額（已扣佣金）
 * @param {string} description - 描述，例如「流瑜伽 09:00 - 2026-05-25」
 * @param {string} bookingId - 相關 booking id（optional）
 * @returns {object} { success, transaction_id, balance_after }
 */
function creditCoachEarning({
  coachId,
  scheduleId,
  coachEarningId,
  netAmount,
  description,
  bookingId,
}) {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  try {
    // Double-check: 同一筆 earning 未入過帳
    const exists = db
      .prepare(
        "SELECT id FROM wallet_transactions WHERE coach_earning_id = ? AND type = 'class_income'",
      )
      .get(coachEarningId);

    if (exists) {
      console.log(
        `[WALLET] Skipping duplicate credit for earning ${coachEarningId}`,
      );
      return { success: true, transaction_id: exists.id, duplicate: true };
    }

    // Get current balance
    const user = db
      .prepare("SELECT wallet_balance FROM users WHERE id = ?")
      .get(coachId);
    const balanceBefore = user ? user.wallet_balance || 0 : 0;
    const balanceAfter = Math.round((balanceBefore + netAmount) * 100) / 100;

    const txId = uuidv4();

    // Update user wallet balance
    db.prepare("UPDATE users SET wallet_balance = ? WHERE id = ?").run(
      balanceAfter,
      coachId,
    );

    // Insert wallet_transaction
    db.prepare(
      `
      INSERT INTO wallet_transactions 
        (id, user_id, type, amount, balance_before, balance_after, 
         source_type, source_id, coach_earning_id, description, status)
      VALUES (?, ?, 'class_income', ?, ?, ?, ?, ?, ?, ?, 'completed')
    `,
    ).run(
      txId,
      coachId,
      netAmount,
      balanceBefore,
      balanceAfter,
      bookingId ? "booking" : "schedule",
      bookingId || scheduleId,
      coachEarningId,
      description,
    );

    console.log(
      `[WALLET] Credited HK$${netAmount} to coach ${coachId} (tx: ${txId})`,
    );

    // ⛓️ 區塊鏈：記錄錢包入帳
    try {
      writeBlock({
        entityType: "wallet_transaction",
        entityId: txId,
        data: {
          user_id: coachId,
          amount: netAmount,
          type: "class_income",
          balance_after: balanceAfter,
          status: "completed",
          source_type: bookingId ? "booking" : "schedule",
        },
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (credit wallet):", bcErr.message);
    }

    db.close();
    return {
      success: true,
      transaction_id: txId,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
    };
  } catch (err) {
    db.close();
    console.error("[WALLET] creditCoachEarning error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 扣錢（提現 / 行政費 / 調整）
 *
 * @param {object} params
 * @returns {object} { success, transaction_id, balance_after }
 */
function debitWallet({
  userId,
  amount,
  type,
  description,
  reference,
  fee = 0,
  sourceType = "",
  sourceId = "",
}) {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  try {
    const user = db
      .prepare("SELECT wallet_balance FROM users WHERE id = ?")
      .get(userId);
    if (!user) {
      db.close();
      return { success: false, error: "用戶不存在" };
    }

    const balanceBefore = user.wallet_balance || 0;
    const totalDebit = amount + fee;

    if (balanceBefore < totalDebit) {
      db.close();
      return {
        success: false,
        error: `餘額不足 (需要 $${totalDebit}，現有 $${balanceBefore})`,
      };
    }

    const balanceAfter = Math.round((balanceBefore - totalDebit) * 100) / 100;
    const txId = uuidv4();

    db.prepare("UPDATE users SET wallet_balance = ? WHERE id = ?").run(
      balanceAfter,
      userId,
    );

    db.prepare(
      `
      INSERT INTO wallet_transactions 
        (id, user_id, type, amount, balance_before, balance_after,
         source_type, source_id, description, reference, fee, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
    `,
    ).run(
      txId,
      userId,
      type,
      amount,
      balanceBefore,
      balanceAfter,
      sourceType,
      sourceId,
      description,
      reference,
      fee,
    );

    // ⛓️ 區塊鏈：記錄錢包扣數
    try {
      writeBlock({
        entityType: "wallet_transaction",
        entityId: txId,
        data: {
          user_id: userId,
          amount: -amount,
          type,
          balance_after: balanceAfter,
          fee,
          status: "completed",
        },
      });
    } catch (bcErr) {
      console.error("⚠️ Blockchain write failed (debit wallet):", bcErr.message);
    }

    db.close();
    return {
      success: true,
      transaction_id: txId,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      fee,
    };
  } catch (err) {
    db.close();
    console.error("[WALLET] debitWallet error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 查詢錢包結餘（含銀包+教練收入摘要）
 */
function getWalletSummary(userId) {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  try {
    const user = db
      .prepare(
        "SELECT wallet_balance, total_earnings, pending_payout, bank_name, bank_account, bank_code FROM users WHERE id = ?",
      )
      .get(userId);

    if (!user) {
      db.close();
      return null;
    }

    // 最近 5 筆交易
    const recentTxs = db
      .prepare(
        `
      SELECT id, type, amount, balance_before, balance_after, source_type, source_id, description, fee, created_at
      FROM wallet_transactions WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 5
    `,
      )
      .all(userId);

    db.close();

    return {
      wallet_balance: user.wallet_balance || 0,
      total_earnings: user.total_earnings || 0,
      pending_payout: user.pending_payout || 0,
      bank: {
        name: user.bank_name || "",
        account: user.bank_account || "",
        code: user.bank_code || "",
      },
      recent_transactions: recentTxs,
    };
  } catch (err) {
    db.close();
    console.error("[WALLET] getWalletSummary error:", err.message);
    return null;
  }
}

/**
 * 攞完整交易記錄（可 filter）
 */
function getTransactions({
  userId,
  type,
  limit = 50,
  offset = 0,
  startDate,
  endDate,
}) {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  try {
    let where = "WHERE w.user_id = ?";
    const params = [userId];

    if (type) {
      where += " AND w.type = ?";
      params.push(type);
    }
    if (startDate) {
      where += " AND w.created_at >= ?";
      params.push(startDate);
    }
    if (endDate) {
      where += " AND w.created_at <= ?";
      params.push(endDate);
    }

    // 如果有 source_type = 'booking'， join 去攞 class title
    const txs = db
      .prepare(
        `
      SELECT w.* FROM wallet_transactions w
      ${where}
      ORDER BY w.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params, limit, offset);

    // 對有 source_id 嘅交易，嘗試攞額外資訊
    const enriched = txs.map((tx) => {
      let extra = null;
      if (tx.source_type === "booking" && tx.source_id) {
        try {
          extra = db
            .prepare(
              `
            SELECT b.id, b.booking_reference, b.amount as booking_amount, b.status as booking_status,
                   cs.start_time, c.title as class_title, c.price_hkd
            FROM bookings b
            LEFT JOIN class_schedules cs ON b.schedule_id = cs.id
            LEFT JOIN classes c ON cs.class_id = c.id
            WHERE b.id = ?
          `,
            )
            .get(tx.source_id);
        } catch (e) {
          /* ignore */
        }
      }
      return { ...tx, extra };
    });

    const total = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM wallet_transactions w ${where}
    `,
      )
      .get(...params);

    db.close();
    return { transactions: enriched, total: total.count };
  } catch (err) {
    db.close();
    console.error("[WALLET] getTransactions error:", err.message);
    return { transactions: [], total: 0, error: err.message };
  }
}

/**
 * 管理員：所有教練錢包總覽
 */
function getAllCoachWallets({ limit = 50, offset = 0 }) {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  try {
    const wallets = db
      .prepare(
        `
      SELECT u.id, u.name, u.email, u.phone, u.wallet_balance, u.total_earnings, u.pending_payout,
             u.bank_name, u.bank_account, u.bank_code,
             (SELECT COUNT(*) FROM wallet_transactions wt WHERE wt.user_id = u.id) as tx_count,
             (SELECT MAX(created_at) FROM wallet_transactions wt WHERE wt.user_id = u.id) as last_tx_date
      FROM users u
      WHERE u.is_coach = 1
      ORDER BY u.wallet_balance DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(limit, offset);

    const total = db
      .prepare("SELECT COUNT(*) as count FROM users WHERE is_coach = 1")
      .get();

    db.close();
    return { wallets, total: total.count };
  } catch (err) {
    db.close();
    console.error("[WALLET] getAllCoachWallets error:", err.message);
    return { wallets: [], total: 0, error: err.message };
  }
}

module.exports = {
  creditCoachEarning,
  debitWallet,
  getWalletSummary,
  getTransactions,
  getAllCoachWallets,
};
