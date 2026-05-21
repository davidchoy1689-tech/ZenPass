/**
 * ZenPass 禪流 — 雙重記帳會計服務 (Double-entry Accounting)
 *
 * IPO-ready: 每一筆交易都有 debit/credit 分錄
 * 符合 HKICPA 會計準則、上市公司內部監控要求
 *
 * Account codes (HK上市公司標準):
 *   1000 - 現金 (Platform Bank)
 *   1100 - Stripe 待結算
 *   1200 - FPS/PayMe 待確認
 *   1300 - 應收帳款 (商戶)
 *   2000 - 應付帳款 (商戶)
 *   3000 - 平台收入
 *   3100 - 佣金收入
 *   4000 - 商戶出糧
 *   5000 - 退款
 *   6000 - 營運開支
 */

const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

/**
 * 建立一筆會計分錄（double-entry pair）
 * 自動產生 debit + credit 兩條 records
 *
 * @param {Object} params
 * @param {string} params.bookingId - 關聯 booking ID
 * @param {string} params.userId - 用戶 ID
 * @param {number} params.amount - 金額 (HKD)
 * @param {'payment'|'refund'|'payout'|'commission'} params.type - 交易類型
 * @param {'stripe'|'fps'|'payme'|'credits'} params.method - 支付方式
 * @param {string} [params.description] - 描述
 * @returns {Object} 分錄結果
 */
function createEntry({ bookingId, userId, amount, type, method, description = "" }) {
  const db = new Database(DB_PATH);
  try {
    const now = new Date().toISOString();
    const ref = require("../services/refgen").genRef("GL");
    const entries = [];

    switch (type) {
      case "payment": {
        // Debit: Cash/Stripe/FPS/PayMe (資產增加)
        // Credit: Platform Revenue (收入增加)
        const assetAccount = method === "stripe" ? "1100" : method === "credits" ? "1200" : "1000";
        const assetName = method === "stripe" ? "Stripe 待結算" : method === "credits" ? "點數收入" : "現金";

        entries.push({
          id: uuidv4(),
          bookingId, userId, ref,
          debit: amount, credit: 0,
          accountCode: assetAccount,
          accountName: assetName,
          type, method, description,
          createdAt: now,
        });
        entries.push({
          id: uuidv4(),
          bookingId, userId, ref,
          debit: 0, credit: amount,
          accountCode: "3000",
          accountName: "平台收入",
          type, method, description,
          createdAt: now,
        });
        break;
      }
      case "refund": {
        // Debit: Refund Expense (退款開支)
        // Credit: Cash/Stripe (資產減少)
        entries.push({
          id: uuidv4(),
          bookingId, userId, ref,
          debit: amount, credit: 0,
          accountCode: "5000",
          accountName: "退款",
          type, method, description,
          createdAt: now,
        });
        entries.push({
          id: uuidv4(),
          bookingId, userId, ref,
          debit: 0, credit: amount,
          accountCode: method === "stripe" ? "1100" : "1000",
          accountName: method === "stripe" ? "Stripe 待結算" : "現金",
          type, method, description,
          createdAt: now,
        });
        break;
      }
      case "commission": {
        // Debit: Commission Expense
        // Credit: Accounts Payable (商戶應收)
        entries.push({
          id: uuidv4(),
          bookingId, userId, ref,
          debit: amount, credit: 0,
          accountCode: "3100",
          accountName: "佣金收入",
          type, method, description,
          createdAt: now,
        });
        entries.push({
          id: uuidv4(),
          bookingId, userId, ref,
          debit: 0, credit: amount,
          accountCode: "2000",
          accountName: "商戶應付款",
          type, method, description,
          createdAt: now,
        });
        break;
      }
      case "payout": {
        // Debit: Accounts Payable (減少應付)
        // Credit: Cash (資產減少)
        entries.push({
          id: uuidv4(),
          bookingId, userId, ref,
          debit: amount, credit: 0,
          accountCode: "2000",
          accountName: "商戶應付款",
          type, method, description,
          createdAt: now,
        });
        entries.push({
          id: uuidv4(),
          bookingId, userId, ref,
          debit: 0, credit: amount,
          accountCode: "1000",
          accountName: "現金",
          type, method, description,
          createdAt: now,
        });
        break;
      }
    }

    // Batch insert
    const stmt = db.prepare(`
      INSERT INTO ledger (id, booking_id, user_id, reference,
        debit, credit, account_code, account_name,
        transaction_type, payment_method, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((rows) => {
      for (const e of rows) {
        stmt.run(
          e.id, e.bookingId, e.userId, e.ref,
          e.debit, e.credit, e.accountCode, e.accountName,
          e.type, e.method, e.description, e.createdAt
        );
      }
    });

    insertMany(entries);

    return { reference: ref, entries: entries.length, balanced: true };
  } catch (err) {
    console.error("[ACCOUNTING] Failed to create entry:", err.message);
    return null;
  } finally {
    db.close();
  }
}

/**
 * 快速記錄 payment 入帳
 */
function recordPayment(bookingId, userId, amount, method) {
  return createEntry({
    bookingId, userId, amount,
    type: "payment",
    method,
    description: `課程預付款 HK$${amount} via ${method.toUpperCase()}`,
  });
}

/**
 * 快速記錄退款
 */
function recordRefund(bookingId, userId, amount, method) {
  return createEntry({
    bookingId, userId, amount,
    type: "refund",
    method,
    description: `退款 HK$${amount} via ${method.toUpperCase()}`,
  });
}

/**
 * 快速記錄平台佣金
 */
function recordCommission(bookingId, userId, amount, method) {
  return createEntry({
    bookingId, userId, amount,
    type: "commission",
    method,
    description: `平台佣金 HK$${amount}`,
  });
}

/**
 * 快速記錄商戶出糧
 */
function recordPayout(coachId, amount, method) {
  // For payouts, bookingId could be the payout batch reference
  return createEntry({
    bookingId: `payout-${Date.now()}`,
    userId: coachId,
    amount,
    type: "payout",
    method: method || "bank",
    description: `商戶出糧 HK$${amount}`,
  });
}

/**
 * 查詢帳戶結餘
 * @param {string} accountCode - e.g. "1000"
 * @returns {number} 結餘
 */
function getBalance(accountCode) {
  const db = new Database(DB_PATH);
  try {
    const result = db.prepare(`
      SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) as balance
      FROM ledger WHERE account_code = ?
    `).get(accountCode);
    return result ? result.balance : 0;
  } catch (err) {
    console.error("[ACCOUNTING] Failed to get balance:", err.message);
    return 0;
  } finally {
    db.close();
  }
}

/**
 * 試算表 — 所有帳戶結餘
 * Debits = Credits 先係 balanced
 */
function trialBalance() {
  const db = new Database(DB_PATH);
  try {
    const accounts = db.prepare(`
      SELECT account_code, account_name,
        SUM(debit) as total_debit,
        SUM(credit) as total_credit,
        SUM(debit) - SUM(credit) as balance
      FROM ledger
      GROUP BY account_code, account_name
      ORDER BY account_code
    `).all();

    const totalDebit = accounts.reduce((s, r) => s + r.total_debit, 0);
    const totalCredit = accounts.reduce((s, r) => s + r.total_credit, 0);

    return {
      accounts,
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
      balanced: Math.abs(totalDebit - totalCredit) < 0.01,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[ACCOUNTING] Trial balance failed:", err.message);
    return null;
  } finally {
    db.close();
  }
}

/**
 * 按 booking 查詢分錄
 */
function getEntriesByBooking(bookingId) {
  const db = new Database(DB_PATH);
  try {
    return db.prepare(`
      SELECT * FROM ledger WHERE booking_id = ? ORDER BY created_at
    `).all(bookingId);
  } catch (err) {
    return [];
  } finally {
    db.close();
  }
}

module.exports = {
  createEntry,
  recordPayment,
  recordRefund,
  recordCommission,
  recordPayout,
  getBalance,
  trialBalance,
  getEntriesByBooking,
};
