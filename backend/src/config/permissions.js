/**
 * ZenPass 權限矩陣（Permission-based RBAC）— 2026-10-24
 *
 * 設計原則：
 *  1. 角色（role）只決定「預設有咩權限」，實際檢查一律用 permission code。
 *  2. 後端用 requirePermission() 強制執行；前端只用嚟隱藏冇權限嘅選單（唔可信）。
 *  3. 商戶／教練範圍（partner/coach）仍然要喺 SQL 層加 scope，唔靠前端。
 *
 * 角色層級見 middleware/auth.js（數字越低權限越高）。
 */

const PERMISSIONS = {
  // 營運
  "ops.booking.view": "查看預約",
  "ops.booking.write": "取消／標記出席",
  "ops.class.view": "查看課程",
  "ops.class.write": "新增／修改課程、時段",
  "ops.coach.view": "查看教練",
  "ops.coach.write": "審批教練／分配課程",
  "ops.partner.view": "查看商戶",
  "ops.partner.write": "審批商戶／場地",
  "ops.inquiry.view": "查看查詢",
  "ops.inquiry.write": "回覆查詢",

  // 財務
  "finance.view": "查看收入／報表",
  "finance.payment.confirm": "確認收款",
  "finance.payment.reject": "拒絕付款",
  "finance.refund.view": "查看退款",
  "finance.refund.complete": "完成退款轉賬",
  "finance.payout.view": "查看出糧",
  "finance.payout.process": "執行出糧",
  "finance.pricing.view": "查看定價",
  "finance.pricing.write": "修改定價／會籍方案",
  "finance.penalty.write": "修改罰則",

  // 內容
  "content.class.write": "課程內容（含 AI 開班）",
  "content.marketing.write": "優惠碼／推廣／NPS",
  "content.system.write": "系統內容／遷移工具",

  // 用戶
  "users.view": "查看用戶",
  "users.edit": "修改用戶資料",
  "users.role.write": "修改角色／停用帳號",
  "users.merge": "合併訪客帳號",

  // 系統
  "system.audit.view": "查看審計紀錄",
  "system.db.view": "瀏覽資料庫（唯讀）",
  "system.migrate": "執行資料遷移",
  "system.settings.write": "系統設定",
};

const ALL = Object.keys(PERMISSIONS);

const ROLE_PERMISSIONS = {
  super_admin: ALL,

  platform_manager: ALL.filter((p) => !["users.role.write", "system.settings.write"].includes(p)),

  platform_staff: [
    "ops.booking.view", "ops.booking.write",
    "ops.class.view", "ops.class.write",
    "ops.coach.view", "ops.partner.view",
    "ops.inquiry.view", "ops.inquiry.write",
    "finance.view", "finance.payment.confirm", "finance.payment.reject",
    "finance.refund.view", "finance.refund.complete",
    "finance.payout.view", "finance.pricing.view",
    "content.class.write", "content.marketing.write",
    "users.view", "users.edit", "users.merge",
    "system.audit.view",
  ],

  // 管理員＝客服／營運主管：處理訂單同內容，但唔可以出糧、改價、改角色
  admin: [
    "ops.booking.view", "ops.booking.write",
    "ops.class.view", "ops.class.write",
    "ops.coach.view", "ops.partner.view",
    "ops.inquiry.view", "ops.inquiry.write",
    "finance.view", "finance.payment.confirm", "finance.payment.reject",
    "finance.refund.view", "finance.refund.complete",
    "finance.payout.view", "finance.pricing.view",
    "content.class.write", "content.marketing.write",
    "users.view", "users.edit", "users.merge",
    "system.audit.view",
  ],

  partner_owner: ["ops.booking.view", "ops.class.view", "ops.class.write", "ops.coach.view", "finance.view"],
  partner_admin: ["ops.booking.view", "ops.class.view", "ops.class.write", "ops.coach.view"],
  partner_staff: ["ops.booking.view", "ops.booking.write"],
  coach: ["ops.booking.view", "ops.class.view"],
  user: [],
  guest: [],
};

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function hasPermission(role, perm) {
  const list = permissionsFor(role);
  if (list.includes("*")) return true;
  if (list.includes(perm)) return true;
  // 支援 "finance.*" 萬用字
  const [ns] = String(perm).split(".");
  return list.includes(ns + ".*");
}

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, permissionsFor, hasPermission };
