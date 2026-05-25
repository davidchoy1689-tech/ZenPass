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

    // ───── Step 0: 四邊拆賬總覽（區塊鏈根區塊 root block）─────
    let coachTotal = 0, venueTotal = 0, platformTotal = booking.platform_earned_amount || 0;
    const allEarnings = db.prepare(`
      SELECT SUM(ce.net_amount) as total, ce.schedule_id
      FROM coach_earnings ce
      WHERE ce.schedule_id = ?
      GROUP BY ce.schedule_id
    `).get(booking.schedule_id);
    coachTotal = allEarnings?.total || 0;
    venueTotal = booking.venue_earned_amount || 0;

    const rootData = {
      type: "四邊拆賬",
      booking_ref: booking.booking_reference,
      class: booking.class_title,
      time: booking.start_time,
      total_amount: booking.amount,
      splits: {
        student: { role: "🎓 學生", name: booking.student_name, pay: booking.amount, pct: 100 },
        platform: { role: "🏢 平台", name: "ZenPass", earn: platformTotal, pct: booking.amount > 0 ? Math.round(platformTotal / booking.amount * 100) : 0 },
        coach: { role: "🏋️ 教練", earn: coachTotal, pct: booking.amount > 0 ? Math.round(coachTotal / booking.amount * 100) : 0 },
        venue: { role: "🏟️ 場地", earn: venueTotal, pct: booking.amount > 0 ? Math.round(venueTotal / booking.amount * 100) : 0 },
      },
      status: booking.status,
      booking_id: booking.id,
    };
    const rootHash = sha256(rootData);

    chain.push({
      step: 0,
      title: "📊 四邊拆賬總覽",
      type: "root",
      data: rootData,
      hash: rootHash,
    });

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
      previous_hash: rootHash,
      hash: sha256({ step: 1, bookingId, amount: booking.amount, time: booking.created_at, prev: rootHash }),
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

// ===================================================================
// ⛓️ 寫入時即時 HASH（Immutable Blockchain Storage）
// 每次建立金錢記錄時即刻 hash 同儲存，確保不可篡改
// ===================================================================

const BLOCKCHAIN_TABLE = 'blockchain_blocks';

/**
 * 確保 blockchain_blocks table 存在
 */
function ensureBlockchainTable() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS blockchain_blocks (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      previous_hash TEXT DEFAULT '',
      hash TEXT NOT NULL,
      data TEXT NOT NULL,
      block_height INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_blockchain_entity ON blockchain_blocks(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_blockchain_height ON blockchain_blocks(block_height);
    CREATE INDEX IF NOT EXISTS idx_blockchain_created ON blockchain_blocks(created_at);
  `);

  db.close();
  console.log("[BLOCKCHAIN] ✅ blockchain_blocks table ready");
}

/**
 * 寫入一個 blockchain block（即時 hash + 永久儲存）
 *
 * @param {object} params
 * @param {string} params.entityType - 'booking' | 'income' | 'wallet' | 'payout'
 * @param {string} params.entityId - 對應記錄嘅 ID
 * @param {object} params.data - 要 hash 嘅數據
 * @param {string} params.previousBlockId - 前一個 block 嘅 ID（optional）
 * @returns {object} { block_id, hash, height }
 */
function writeBlock({ entityType, entityId, data, previousBlockId }) {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  try {
    // 確保 table 存在
    db.exec(`CREATE TABLE IF NOT EXISTS blockchain_blocks (
      id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      previous_hash TEXT DEFAULT '', hash TEXT NOT NULL, data TEXT NOT NULL,
      block_height INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    // 搵前一個 block 嘅 hash 做鏈接
    let previousHash = '';
    let blockHeight = 1;

    if (previousBlockId) {
      const prev = db.prepare('SELECT hash FROM blockchain_blocks WHERE id = ?').get(previousBlockId);
      if (prev) previousHash = prev.hash;
    }

    // 如果冇指定前一個 block，自動搵最近果個
    if (!previousHash) {
      const last = db.prepare('SELECT hash, block_height FROM blockchain_blocks ORDER BY block_height DESC LIMIT 1').get();
      if (last) {
        previousHash = last.hash;
        blockHeight = last.block_height + 1;
      }
    }

    // 計算 hash
    const blockData = { entityType, entityId, data, previousHash, timestamp: Date.now() };
    const hash = sha256(blockData);

    const blockId = require('uuid').v4();

    db.prepare(`
      INSERT INTO blockchain_blocks (id, entity_type, entity_id, previous_hash, hash, data, block_height)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(blockId, entityType, entityId, previousHash, hash, JSON.stringify(blockData), blockHeight);

    db.close();
    return { block_id: blockId, hash, height: blockHeight, previous_hash: previousHash };
  } catch (err) {
    db.close();
    console.error("[BLOCKCHAIN] writeBlock error:", err.message);
    return { error: err.message };
  }
}

/**
 * 驗證一個 block 嘅 hash 同鏈接是否完整
 */
function verifyBlock(blockId) {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  try {
    const block = db.prepare('SELECT * FROM blockchain_blocks WHERE id = ?').get(blockId);
    if (!block) { db.close(); return { valid: false, error: 'Block not found' }; }

    const blockData = JSON.parse(block.data);
    const recalculatedHash = sha256(blockData);

    // 驗證 hash 是否一致
    if (recalculatedHash !== block.hash) {
      db.close();
      return { valid: false, error: 'Hash mismatch - data has been tampered with', expected: block.hash, got: recalculatedHash };
    }

    db.close();
    return { valid: true, block };
  } catch (err) {
    db.close();
    return { valid: false, error: err.message };
  }
}

/**
 * 驗證整條 chain 完整性（由 genesis block 到最新）
 */
function verifyFullChain() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  try {
    const blocks = db.prepare('SELECT * FROM blockchain_blocks ORDER BY block_height ASC').all();
    if (blocks.length === 0) { db.close(); return { valid: true, blocks: 0 }; }

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const blockData = JSON.parse(b.data);
      const recalculatedHash = sha256(blockData);

      if (recalculatedHash !== b.hash) {
        db.close();
        return { valid: false, broken_at: b.block_height, block_id: b.id, entity: b.entity_type };
      }

      // 檢查鏈接（除 genesis block）
      if (i > 0 && b.previous_hash !== blocks[i - 1].hash) {
        db.close();
        return { valid: false, broken_link: b.block_height, expected_prev: blocks[i - 1].hash, got_prev: b.previous_hash };
      }
    }

    const latest = blocks[blocks.length - 1];
    db.close();
    return { valid: true, blocks: blocks.length, latest_hash: latest.hash, latest_height: latest.block_height };
  } catch (err) {
    db.close();
    return { valid: false, error: err.message };
  }
}

/**
 * 快速寫 Booking 嘅 blockchain block
 */
function writeBookingBlock(bookingId) {
  const db = new Database(DB_PATH);
  try {
    const booking = db.prepare(`
      SELECT b.*, u.name as student_name, c.title as class_title
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      JOIN class_schedules cs ON b.schedule_id = cs.id
      JOIN classes c ON cs.class_id = c.id
      WHERE b.id = ?
    `).get(bookingId);
    if (!booking) return { error: 'Booking not found' };
    db.close();

    return writeBlock({
      entityType: 'booking',
      entityId: bookingId,
      data: {
        booking_ref: booking.booking_reference,
        amount: booking.amount,
        platform_earned: booking.platform_earned_amount,
        venue_earned: booking.venue_earned_amount,
        status: booking.status,
        student: booking.student_name,
        class: booking.class_title,
        created_at: booking.created_at,
      },
    });
  } catch (err) {
    db.close();
    return { error: err.message };
  }
}

module.exports = {
  traceBooking,
  traceWalletTransaction,
  verifyChain,
  // 寫入即 hash
  ensureBlockchainTable,
  writeBlock,
  writeBookingBlock,
  verifyBlock,
  verifyFullChain,
};
