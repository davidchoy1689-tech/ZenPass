/**
 * ZenPass 禪流 — 自動結算腳本 (自動出糧)
 *
 * 每週一執行：
 * 1. 教練收入結算 — 將 coach_earnings 中 pending 嘅紀錄打包成 coach_payouts
 * 2. 商戶分潤結算 — 根據 attended booking 計算 partner 嘅分成
 *
 * 用法:
 *   node backend/src/scripts/auto-settlement.js
 *
 * 排程: 由 scheduler.js 每週一觸發
 */

const path = require("path");
const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");
const { sendNotification } = require("../services/notification");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DB_PATH = path.join(PROJECT_ROOT, "data", "zenpass.db");

/**
 * 教練自動結算
 * 將全部 pending 狀態嘅 coach_earnings 打包成 coach_payouts
 */
function settleCoachEarnings() {
  const db = new Database(DB_PATH);
  const ts = new Date().toISOString();
  let settled = 0;

  try {
    db.pragma("journal_mode = WAL");

    // 找出所有有 pending earnings 嘅 coach
    const coaches = db
      .prepare(
        `
      SELECT ce.coach_id, u.name as coach_name, u.email as coach_email,
        SUM(ce.net_amount) as total_pending,
        COUNT(*) as earning_count
      FROM coach_earnings ce
      JOIN users u ON ce.coach_id = u.id
      WHERE ce.status = 'pending'
      GROUP BY ce.coach_id
      HAVING total_pending > 0
    `,
      )
      .all();

    if (coaches.length === 0) {
      console.log(`[${ts}] ✅ 沒有待結算嘅教練收入`);
      return { settled: 0, coaches: 0 };
    }

    console.log(
      `[${ts}] 💰 發現 ${coaches.length} 位教練有待結算收入`,
    );

    for (const coach of coaches) {
      try {
        const amount = coach.total_pending;
        const fee = Math.max(0, Math.round(amount * 0.01 * 100) / 100); // 1% 手續費
        const netAmount = amount - fee;
        const payoutId = uuidv4();
        const poRef =
          "PO-" +
          ts.slice(0, 10).replace(/-/g, "") +
          "-" +
          Math.random().toString(36).substring(2, 6).toUpperCase();

        // Create payout record
        db.prepare(
          `INSERT INTO coach_payouts (id, coach_id, amount, fee, net_amount, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`,
        ).run(payoutId, coach.coach_id, amount, fee, netAmount);

        // Mark earnings as paid (linked to this payout)
        db.prepare(
          `UPDATE coach_earnings SET status = 'paid', payout_id = ? 
           WHERE coach_id = ? AND status = 'pending'`,
        ).run(payoutId, coach.coach_id);

        // Update user totals
        const newPending = db
          .prepare(
            `SELECT COALESCE(SUM(net_amount), 0) as pending FROM coach_earnings 
             WHERE coach_id = ? AND status = 'pending'`,
          )
          .get(coach.coach_id);

        db.prepare(
          "UPDATE users SET pending_payout = ? WHERE id = ?",
        ).run(newPending.pending, coach.coach_id);

        // Send notification to coach
        try {
          sendNotification("coach.payout_processed", {
            recipient: coach.coach_id,
            data: {
              amount: netAmount,
              gross_amount: amount,
              fee: fee,
              status: "settled",
              message: `💰 自動結算：你嘅 HK$${netAmount} 收入已轉為待出糧狀態（手續費 HK$${fee}）`,
              class_count: coach.earning_count,
            },
          });
        } catch (notifErr) {
          console.error(
            `   ⚠️ 發送結算通知失敗 (coach=${coach.coach_id}): ${notifErr.message}`,
          );
        }

        // Also insert in-app notification
        db.prepare(
          `INSERT INTO notifications (id, user_id, type, title, message, data, is_read, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
        ).run(
          `settle-coach-${payoutId}`,
          coach.coach_id,
          "coach.settlement",
          "💰 收入已自動結算",
          `你嘅 HK$${netAmount} 收入已轉為待出糧狀態（共 ${coach.earning_count} 筆紀錄，手續費 HK$${fee}）`,
          JSON.stringify({
            payout_id: payoutId,
            amount: netAmount,
            gross_amount: amount,
            fee: fee,
            earning_count: coach.earning_count,
          }),
        );

        console.log(
          `   ✅ ${coach.coach_name} → HK$${netAmount} (${coach.earning_count} 筆)`,
        );
        settled++;
      } catch (e) {
        console.error(
          `   ❌ 結算失敗 (coach=${coach.coach_id}): ${e.message}`,
        );
      }
    }

    console.log(
      `[${ts}] 📊 已結算 ${settled}/${coaches.length} 位教練收入`,
    );
    return { settled, coaches: coaches.length };
  } catch (err) {
    console.error(`[${ts}] ❌ 教練結算腳本錯誤:`, err.message);
    return { settled: 0, coaches: 0, error: err.message };
  } finally {
    db.close();
  }
}

/**
 * 商戶自動結算
 * 找出 attended booking 中未有 payout 記錄嘅，計算分成
 */
function settlePartnerVenues() {
  const db = new Database(DB_PATH);
  const ts = new Date().toISOString();
  let settled = 0;

  try {
    db.pragma("journal_mode = WAL");

    // 找出 active 嘅 partner venues
    const venues = db
      .prepare(
        `
      SELECT pv.id, pv.name, pv.commission_rate, pv.user_id,
        COALESCE(u.name, pv.contact_person) as owner_name
      FROM partner_venues pv
      LEFT JOIN users u ON pv.user_id = u.id
      WHERE pv.status = 'active'
    `,
      )
      .all();

    if (venues.length === 0) {
      console.log(`[${ts}] ✅ 沒有活躍嘅合作商戶`);
      return { settled: 0, venues: 0 };
    }

    for (const venue of venues) {
      try {
        // Find attended bookings linked to this venue that have no payout record yet
        const bookings = db
          .prepare(
            `
          SELECT b.id, b.amount, b.platform_commission_rate, b.venue_earned_amount,
            b.platform_earned_amount, c.title as class_title
          FROM bookings b
          JOIN classes c ON b.class_id = c.id
          WHERE b.status = 'attended'
            AND (b.venue_partner_id = ? OR c.partner_venue_id = ?)
            AND (b.venue_earned_amount IS NOT NULL AND b.venue_earned_amount > 0)
            AND b.id NOT IN (
              SELECT pp.reference_id FROM partner_payouts pp 
              WHERE pp.notes LIKE '%booking:' || b.id || '%'
            )
        `,
          )
          .all(venue.id, venue.id);

        if (bookings.length === 0) continue;

        // Calculate totals
        let totalRevenue = 0;
        let venueEarned = 0;
        let platformCommission = 0;
        const bookingIds = [];

        for (const b of bookings) {
          totalRevenue += b.amount || 0;
          venueEarned += b.venue_earned_amount || 0;
          platformCommission += b.platform_earned_amount || 0;
          bookingIds.push(b.id);
        }

        // Create payout record
        const payoutId = uuidv4();
        const now = ts;

        db.prepare(
          `INSERT INTO partner_payouts 
           (id, venue_id, period_start, period_end, total_revenue, 
            platform_commission, venue_earned, status, notes, paid_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, datetime('now'))`,
        ).run(
          payoutId,
          venue.id,
          "auto",
          "auto",
          Math.round(totalRevenue * 100) / 100,
          Math.round(platformCommission * 100) / 100,
          Math.round(venueEarned * 100) / 100,
          `auto-settlement:${bookingIds.length} bookings:${bookingIds.join(",")}`,
        );

        // Send notification to venue owner
        if (venue.user_id) {
          try {
            sendNotification("payment.received", {
              recipient: venue.user_id,
              data: {
                amount: venueEarned,
                method: "Auto Settlement",
                reference: payoutId,
                message: `🏢 商戶分潤自動結算：「${venue.name}」HK$${venueEarned}（共 ${bookingIds.length} 筆課堂收入）`,
              },
            });
          } catch (notifErr) {
            console.error(
              `   ⚠️ 發送商戶通知失敗 (venue=${venue.id}): ${notifErr.message}`,
            );
          }

          // In-app notification
          db.prepare(
            `INSERT INTO notifications (id, user_id, type, title, message, data, is_read, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
          ).run(
            `settle-partner-${payoutId}`,
            venue.user_id,
            "partner.settlement",
            `🏢 商戶分潤已結算`,
            `「${venue.name}」HK$${venueEarned} 收入已結算（共 ${bookingIds.length} 筆課堂）`,
            JSON.stringify({
              payout_id: payoutId,
              venue_id: venue.id,
              venue_name: venue.name,
              amount: venueEarned,
              total_revenue: totalRevenue,
              platform_commission: platformCommission,
              booking_count: bookingIds.length,
            }),
          );
        } else {
          console.log(
            `   ⚠️ 商戶 ${venue.name} 無綁定用戶，跳過通知`,
          );
        }

        console.log(
          `   ✅ ${venue.name} → HK$${venueEarned} (${bookingIds.length} 筆)`,
        );
        settled++;
      } catch (e) {
        console.error(
          `   ❌ 商戶結算失敗 (venue=${venue.id}): ${e.message}`,
        );
      }
    }

    console.log(
      `[${ts}] 📊 已結算 ${settled}/${venues.length} 間商戶分潤`,
    );
    return { settled, venues: venues.length };
  } catch (err) {
    console.error(`[${ts}] ❌ 商戶結算腳本錯誤:`, err.message);
    return { settled: 0, venues: 0, error: err.message };
  } finally {
    db.close();
  }
}

/**
 * 執行全部結算
 */
function runAutoSettlement() {
  console.log("=".repeat(50));
  console.log("💰 ZenPass 自動結算排程");
  console.log("=".repeat(50));

  const coachResult = settleCoachEarnings();
  const partnerResult = settlePartnerVenues();

  console.log("-".repeat(50));
  console.log("📊 結算摘要");
  console.log(`教練結算: ${coachResult.settled}/${coachResult.coaches}`);
  console.log(`商戶結算: ${partnerResult.settled}/${partnerResult.venues}`);
  console.log("-".repeat(50));

  return { coach: coachResult, partner: partnerResult };
}

// 直接執行
if (require.main === module) {
  runAutoSettlement();
}

module.exports = {
  runAutoSettlement,
  settleCoachEarnings,
  settlePartnerVenues,
};
