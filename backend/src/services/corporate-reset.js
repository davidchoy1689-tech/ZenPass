/**
 * ZenPass - 企業每月 Credit 重置排程（Use it or lose it）
 *
 * 每月自動重置 credit_used，未使用餘額自動到期
 */

const path = require("path");
const { v4: uuidv4 } = require("uuid");

const DB_PATH =
  process.env.DB_PATH || path.resolve(__dirname, "../data/zenpass.db");

function calcNextReset(cycle) {
  const now = new Date();
  switch ((cycle || "monthly").toLowerCase()) {
    case "weekly":
      return new Date(now.getTime() + 7 * 86400000).toISOString();
    case "monthly":
      now.setMonth(now.getMonth() + 1);
      now.setDate(1);
      now.setHours(0, 0, 0, 0);
      return now.toISOString();
    case "quarterly":
      now.setMonth(now.getMonth() + 3);
      return now.toISOString();
    case "yearly":
      now.setFullYear(now.getFullYear() + 1);
      return now.toISOString();
    default:
      now.setMonth(now.getMonth() + 1);
      now.setDate(1);
      now.setHours(0, 0, 0, 0);
      return now.toISOString();
  }
}

function processCorporateResets() {
  const Database = require("better-sqlite3");
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  let resetCount = 0;

  try {
    const due = db
      .prepare(
        `
      SELECT id, name, credit_pool, credit_used, billing_cycle, monthly_allocation
      FROM corporate_companies
      WHERE next_reset_at IS NOT NULL
        AND next_reset_at <= datetime('now')
        AND status = 'active'
    `,
      )
      .all();

    for (const company of due) {
      // Log unused credits before reset
      const unused = company.credit_pool - company.credit_used;

      // Reset credit_used to 0
      db.prepare(
        `UPDATE corporate_companies
         SET credit_used = 0,
             last_reset_at = datetime('now'),
             next_reset_at = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      ).run(calcNextReset(company.billing_cycle), company.id);

      // Also reset all employees' monthly_credit_used for this company
      db.prepare(
        `UPDATE corporate_members
         SET monthly_credit_used = 0,
             monthly_reset_at = strftime('%Y-%m', 'now')
         WHERE company_id = ?`,
      ).run(company.id);

      // Audit log
      db.prepare(
        `INSERT INTO audit_log (id, action_type, entity_type, entity_id, user_id, description, new_values, created_at)
         VALUES (?, 'corporate.reset', 'corporate_company', ?, 'system', ?, ?, datetime('now'))`,
      ).run(
        uuidv4(),
        company.id,
        `💾 月度重置: ${company.name}，${unused} credit 未使用已過期`,
        JSON.stringify({
          company: company.name,
          unused_credits_expired: unused,
          monthly_allocation: company.monthly_allocation,
          credit_pool_before_reset: company.credit_pool,
          credit_used_before_reset: company.credit_used,
        }),
      );

      console.log(
        `[CORPORATE RESET] ${company.name}: reset, ${unused} unused credits expired`,
      );
      resetCount++;
    }

    if (resetCount > 0) {
      console.log(`[CORPORATE RESET] 已完成 ${resetCount} 間企業的月度重置`);
    }
  } catch (err) {
    console.error("[CORPORATE RESET] Error:", err.message);
  } finally {
    db.close();
    return resetCount;
  }
}

module.exports = { processCorporateResets, calcNextReset };
