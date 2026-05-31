/**
 * ZenPass 禪流 — 審計日誌服務
 *
 * IPO-ready audit trail: 所有金錢交易、狀態變更、管理員操作
 * 全部記錄，不可刪改，可追溯。
 *
 * 符合：HKICPA 審計要求、上市公司內部監控標準
 *
 * @module services/audit
 */

const Database = require("better-sqlite3");
const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

/**
 * 記錄一筆審計日誌
 *
 * @param {Object} params
 * @param {string} params.actionType - 操作類型
 *   'booking.create' | 'booking.cancel' | 'booking.attend' | 'booking.no_show'
 *   | 'payment.create' | 'payment.confirm' | 'payment.refund' | 'payment.fail'
 *   | 'payout.create' | 'payout.process' | 'payout.complete'
 *   | 'settlement.create' | 'settlement.approve' | 'settlement.pay'
 *   | 'user.update' | 'user.role_change'
 *   | 'admin.action'
 *   | 'partner.create' | 'partner.update' | 'partner.status_change'
 *   | 'class.create' | 'class.update' | 'class.delete'
 *   | 'membership.create' | 'membership.expire' | 'membership.cancel'
 * @param {string} params.entityType - 實體類型 ('booking'|'payment'|'user'|'class'|'partner'|...)
 * @param {string} params.entityId - 實體 ID
 * @param {string|null} params.userId - 操作者 ID (null for system)
 * @param {Object|null} params.oldValues - 變更前值 (JSON)
 * @param {Object|null} params.newValues - 變更後值 (JSON)
 * @param {string} [params.description] - 描述
 * @param {string} [params.ipAddress] - IP 地址
 * @param {string} [params.userAgent] - User-Agent
 * @param {string|null} [params.requestId] - 請求 ID (traceability)
 * @returns {Object} 審計紀錄
 */
function audit({
  actionType,
  entityType,
  entityId,
  userId = null,
  oldValues = null,
  newValues = null,
  description = "",
  ipAddress = "",
  userAgent = "",
  requestId = null,
}) {
  const db = new Database(DB_PATH);
  try {
    const id = require("uuid").v4();
    const timestamp = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO audit_log (
        id, action_type, entity_type, entity_id, user_id,
        old_values, new_values, description,
        ip_address, user_agent, request_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      actionType,
      entityType,
      entityId,
      userId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      description,
      ipAddress,
      userAgent,
      requestId,
      timestamp,
    );

    return {
      id,
      actionType,
      entityType,
      entityId,
      userId,
      description,
      createdAt: timestamp,
    };
  } catch (err) {
    // Audit log must never crash the main operation
    console.error("[AUDIT] Failed to write audit log:", err.message);
    return null;
  } finally {
    db.close();
  }
}

/**
 * 查詢審計日誌（支援多條件過濾）
 *
 * @param {Object} filters
 * @param {string} [filters.entityType] - 按實體類型過濾
 * @param {string} [filters.entityId] - 按實體 ID 過濾
 * @param {string} [filters.userId] - 按操作者過濾
 * @param {string} [filters.actionType] - 按操作類型過濾
 * @param {string} [filters.dateFrom] - 開始日期 (ISO)
 * @param {string} [filters.dateTo] - 結束日期 (ISO)
 * @param {number} [filters.limit=100] - 限制數量
 * @param {number} [filters.offset=0] - 偏移
 * @returns {Array} 審計紀錄陣列
 */
function queryAudit(filters = {}) {
  const db = new Database(DB_PATH);
  try {
    const conditions = [];
    const params = [];

    if (filters.entityType) {
      conditions.push("entity_type = ?");
      params.push(filters.entityType);
    }
    if (filters.entityId) {
      conditions.push("entity_id = ?");
      params.push(filters.entityId);
    }
    if (filters.userId) {
      conditions.push("user_id = ?");
      params.push(filters.userId);
    }
    if (filters.actionType) {
      conditions.push("action_type = ?");
      params.push(filters.actionType);
    }
    if (filters.dateFrom) {
      conditions.push("created_at >= ?");
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      conditions.push("created_at <= ?");
      params.push(filters.dateTo);
    }

    const where =
      conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const limit = Math.min(filters.limit || 100, 1000);
    const offset = filters.offset || 0;

    return db
      .prepare(
        `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
  } catch (err) {
    console.error("[AUDIT] Failed to query audit log:", err.message);
    return [];
  } finally {
    db.close();
  }
}

/**
 * 取得某個實體的完整變更歷史
 *
 * @param {string} entityType
 * @param {string} entityId
 * @returns {Array}
 */
function getEntityHistory(entityType, entityId) {
  return queryAudit({ entityType, entityId, limit: 500 });
}

/**
 * 統計某段時間內的操作數量（用於 audit reporting）
 *
 * @param {string} [dateFrom]
 * @param {string} [dateTo]
 * @returns {Object}
 */
function getAuditStats(dateFrom, dateTo) {
  const db = new Database(DB_PATH);
  try {
    const stats = db
      .prepare(
        `
      SELECT action_type, COUNT(*) as count
      FROM audit_log
      WHERE (? IS NULL OR created_at >= ?)
        AND (? IS NULL OR created_at <= ?)
      GROUP BY action_type
      ORDER BY count DESC
    `,
      )
      .all(dateFrom, dateFrom, dateTo, dateTo);

    const total = stats.reduce((sum, row) => sum + row.count, 0);

    return { total, breakdown: stats };
  } catch (err) {
    console.error("[AUDIT] Failed to get stats:", err.message);
    return { total: 0, breakdown: [] };
  } finally {
    db.close();
  }
}

/**
 * 快速記錄常用的 booking 狀態變更
 */
function trackBookingChange(
  bookingId,
  userId,
  oldStatus,
  newStatus,
  req = null,
) {
  return audit({
    actionType: `booking.${newStatus}`,
    entityType: "booking",
    entityId: bookingId,
    userId,
    oldValues: oldStatus ? { status: oldStatus } : null,
    newValues: { status: newStatus },
    description: `Booking ${bookingId}: ${oldStatus || "new"} → ${newStatus}`,
    ipAddress: req?.ip || "",
    userAgent: req?.headers?.["user-agent"] || "",
  });
}

/**
 * 快速記錄 payment 狀態變更
 */
function trackPaymentChange(
  bookingId,
  userId,
  oldStatus,
  newStatus,
  amount,
  paymentMethod,
  req = null,
) {
  return audit({
    actionType: `payment.${newStatus}`,
    entityType: "booking",
    entityId: bookingId,
    userId,
    oldValues: oldStatus ? { payment_status: oldStatus } : null,
    newValues: {
      payment_status: newStatus,
      amount,
      payment_method: paymentMethod,
    },
    description: `Payment ${bookingId}: HK$${amount} via ${paymentMethod} — ${oldStatus || "new"} → ${newStatus}`,
    ipAddress: req?.ip || "",
    userAgent: req?.headers?.["user-agent"] || "",
  });
}

/**
 * 快速記錄 admin 操作
 */
function trackAdminAction(adminId, action, details, req = null) {
  return audit({
    actionType: "admin.action",
    entityType: "admin",
    entityId: adminId,
    userId: adminId,
    newValues: { action, details },
    description: `Admin ${adminId}: ${action} — ${JSON.stringify(details)}`,
    ipAddress: req?.ip || "",
    userAgent: req?.headers?.["user-agent"] || "",
  });
}

/**
 * 快速記錄商戶狀態變更
 */
function trackPartnerChange(
  partnerId,
  userId,
  oldStatus,
  newStatus,
  req = null,
) {
  return audit({
    actionType: `partner.${newStatus ? "status_change" : "update"}`,
    entityType: "partner_venue",
    entityId: partnerId,
    userId,
    oldValues: oldStatus ? { status: oldStatus } : null,
    newValues: newStatus ? { status: newStatus } : null,
    description: `Partner ${partnerId}: status ${oldStatus || "-"} → ${newStatus || "updated"}`,
    ipAddress: req?.ip || "",
    userAgent: req?.headers?.["user-agent"] || "",
  });
}

module.exports = {
  audit,
  queryAudit,
  getEntityHistory,
  getAuditStats,
  trackBookingChange,
  trackPaymentChange,
  trackAdminAction,
  trackPartnerChange,
};
