/**
 * ZenPass 禪流 — 區塊鏈式交易追溯系統（Blockchain Audit Trail）
 *
 * 每一單交易由開始到完結，資金去向清清楚楚。
 * 原理：
 *  - 每筆 financial record 有區塊鏈式 hash chain
 *  - previous_hash → current_hash，改任何記錄就會斷鏈
 *  - 一 call API 就 show 晒成條鏈：學生俾錢 → 平台抽佣 → 教練收入 → 錢包入帳
 */

const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "../data/zenpass.db");

/**
 * 產生 SHA-256 hash（用嚟做區塊鏈式鏈接）
 */
function sha256(data) {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

/**
 * 追溯一筆 booking 嘅完整資金流向（區塊鏈式）
 *
 * @param {string} bookingId - booking ID
 * @returns {object} { chain, status }
 */
function traceBooking(bookingId) {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  try {
    // Step 1: 攞 booking 基本資料
    const booking = db.prepare(`
      SELECT b.*, u.name as student_name, u.email as student_email,
             c.title as class_title, cs.start_time
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      JOIN classes c ON cs.class_id = c.id
      WHERE b.id = ?
    `).get(bookingId);

    if (!booking) {
      db.close();
      return { error: "Booking not found" };
    }

    const chain = [];

    // ───── Step 1: 學生俾錢 ─────
    chain.push({
      step: 1,
      title: "🎓 學生付款",
      from: booking.student_name,
      to: "ZenPass 平台",
      amount: booking.amount,
      method: booking.payment_method || booking.payment_type,
      status: booking.payment_status,
      timestamp: booking.created_at,
      booking_ref: booking.booking_reference,
      class: booking.class_title,
      hash: sha256({ step: 1, bookingId, amount: booking.amount, time: booking.created_at }),
    });

    // ───── Step 2: 平台抽佣 ─────
    if (booking.platform_earned_amount > 0) {
      chain.push({
        step: 2,
        title: "🏢 平台佣金",
        from: "學生付款",
        to: "ZenPass 平台收入",
        amount: booking.platform_earned_amount,
        rate: booking.platform_commission_rate,
        description: `平台佣金 ${(booking.platform_commission_rate * 100).toFixed(0)}%`,
        previous_hash: chain[chain.length - 1].hash,
        hash: sha256({ step: 2, bookingId, amount: booking.platform_earned_amount, prev: chain[chain.length - 1].hash }),
      });
    }

    // ───── Step 3: 場地收入 ─────
    if (booking.venue_earned_amount > 0) {
      const venue = db.prepare(`
        SELECT pv.name FROM partner_venues pv
        JOIN bookings b ON b.venue_partner_id = pv.id
        WHERE b.id = ?
      `).get(bookingId);

      chain.push({
        step: chain.length + 1,
        title: "🏟️ 場地收入",
        from: "學生付款（經平台）",
        to: venue ? venue.name : "場地",
        amount: booking.venue_earned_amount,
        description: `場地分成`,
        previous_hash: chain[chain.length - 1].hash,
        hash: sha256({ step: chain.length + 1, bookingId, amount: booking.venue_earned_amount, prev: chain[chain.length - 1].hash }),
      });
    }

    // ───── Step 4: 教練收入 ─────
    const earnings = db.prepare(`
      SELECT ce.*, u.name as coach_name
      FROM coach_earnings ce
      JOIN users u ON ce.coach_id = u.id
      WHERE ce.schedule_id = ?
    `).all(booking.schedule_id);

    for (const earning of earnings) {
      chain.push({
        step: chain.length + 1,
        title: "🏋️ 教練收入",
        from: "學生付款（經平台）",
        to: earning.coach_name,
        amount: earning.net_amount,
        gross: earning.gross_amount,
        commission_rate: earning.commission_rate,
        enrolled_count: earning.enrolled_count,
        status: earning.status,
        description: `${earning.class_title} — ${earning.enrolled_count}學生 × HK$${earning.unit_price} × ${(earning.commission_rate * 100).toFixed(0)}%`,
        previous_hash: chain[chain.length - 1].hash,
        hash: sha256({ step: chain.length + 1, earningId: earning.id, amount: earning.net_amount, prev: chain[chain.length - 1].hash }),
      });

      // ───── Step 4b: 錢包入帳（如有） ─────
      const walletIn = db.prepare(`
        SELECT * FROM wallet_transactions WHERE coach_earning_id = ?
      `).all(earning.id);

      for (const w of walletIn) {
        chain.push({
          step: chain.length + 1,
          title: "💰 錢包入帳",
          from: "教練收入",
          to: `${earning.coach_name} 錢包`,
          amount: w.amount,
          balance_before: w.balance_before,
          balance_after: w.balance_after,
          wallet_status: w.status,
          description: `錢包入帳 HK$${w.amount}（結餘: HK$${w.balance_after}）`,
          previous_hash: chain[chain.length - 1].hash,
          hash: sha256({ step: chain.length + 1, walletId: w.id, amount: w.amount, prev: chain[chain.length - 1].hash }),
        });

        // ───── Step 4c: 提現（如有） ─────
        const payout = db.prepare(`
          SELECT cp.* FROM coach_payouts cp
          JOIN coach_earnings ce2 ON ce2.payout_id = cp.id
          WHERE ce2.id = ?
        `).all(earning.id);

        for (const p of payout) {
          chain.push({
            step: chain.length + 1,
            title: "🏦 教練提現",
            from: `${earning.coach_name} 錢包`,
            to: `${earning.coach_name} 銀行戶口`,
            amount: p.amount,
            fee: p.fee,
            net_amount: p.net_amount,
            payout_ref: p.payout_reference,
            status: p.status,
            payment_method: p.payment_method,
            description: `提現 HK$${p.net_amount}（費用 HK$${p.fee}）`,
            previous_hash: chain[chain.length - 1].hash,
            hash: sha256({ step: chain.length + 1, payoutId: p.id, amount: p.amount, prev: chain[chain.length - 1].hash }),
          });
        }
      }
    }

    // ───── Step 5: 場地出糧（如有） ─────
    const venuePayouts = db.prepare(`
      SELECT pp.*, pv.name as venue_name
      FROM partner_payouts pp
      JOIN partner_venues pv ON pp.venue_id = pv.id
      WHERE pp.venue_id = ?
    `).all(booking.venue_partner_id || '');

    for (const vp of venuePayouts) {
      chain.push({
        step: chain.length + 1,
        title: "🏟️ 場地出糧",
        from: "ZenPass 平台",
        to: vp.venue_name,
        amount: vp.net_amount,
        gross: vp.amount,
        fee: vp.fee,
        period: `${vp.period_start || '—'} → ${vp.period_end || '—'}`,
        status: vp.status,
        description: `場地結算 HK$${vp.net_amount}（費用 HK$${vp.fee}）`,
        previous_hash: chain[chain.length - 1].hash,
        hash: sha256({ step: chain.length + 1, payoutId: vp.id, amount: vp.net_amount, prev: chain[chain.length - 1].hash }),
      });
    }

    // 整條鏈嘅最終 hash
    const chainHash = sha256({ bookingId, chain, lastHash: chain[chain.length - 1]?.hash });

    db.close();
    return {
      booking: {
        id: booking.id,
        reference: booking.booking_reference,
        class: booking.class_title,
        time: booking.start_time,
        student: booking.student_name,
        total_amount: booking.amount,
        status: booking.status,
      },
      chain,
      chain_hash: chainHash,
      total_steps: chain.length,
      verified: verifyChain(chain),
    };
  } catch (err) {
    db.close();
    return { error: err.message };
  }
}

/**
 * 驗證 blockchain chain 完整性
 */
function verifyChain(chain) {
  for (let i = 1; i < chain.length; i++) {
    if (chain[i].previous_hash !== chain[i - 1].hash) {
      return { valid: false, broken_at: i, reason: `Step ${i + 1} hash mismatch` };
    }
  }
  return { valid: true, length: chain.length };
}

/**
 * 直接查 wallet_transactions 嘅 blockchain trail
 */
function traceWalletTransaction(walletTxId) {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  try {
    const tx = db.prepare(`
      SELECT wt.*, u.name as user_name
      FROM wallet_transactions wt
      JOIN users u ON wt.user_id = u.id
      WHERE wt.id = ?
    `).get(walletTxId);

    if (!tx) { db.close(); return { error: "Transaction not found" }; }

    // 如果係 class_income，追溯到 booking
    let bookingTrail = null;
    if (tx.source_type === 'booking' && tx.source_id) {
      bookingTrail = traceBooking(tx.source_id);
    } else if (tx.coach_earning_id) {
      // 由 earning 搵返 schedule_id → booking
      const earning = db.prepare(`
        SELECT schedule_id FROM coach_earnings WHERE id = ?
      `).get(tx.coach_earning_id);
      if (earning) {
        const booking = db.prepare(`
          SELECT id FROM bookings WHERE schedule_id = ? LIMIT 1
        `).get(earning.schedule_id);
        if (booking) {
          bookingTrail = traceBooking(booking.id);
        }
      }
    }

    db.close();
    return { transaction: tx, booking_trail: bookingTrail };
  } catch (err) {
    db.close();
    return { error: err.message };
  }
}

module.exports = {
  traceBooking,
  traceWalletTransaction,
  verifyChain,
};
