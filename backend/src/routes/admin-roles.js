/**
 * 角色權限總表（後台可視化）
 * GET /api/admin/role-matrix
 *
 * 唯讀：由 config/permissions.js ＋ middleware/auth.js 角色層級 ＋ 前端頁面守衛產生，
 * 唔會改任何權限，只係俾管理員一眼睇清邊個角色做得到咩。
 */
const express = require("express");
const { authenticateToken, requirePermission, ROLE_HIERARCHY, hasMinimumRole } = require("../middleware/auth");
const { PERMISSIONS, ROLE_PERMISSIONS, permissionsFor } = require("../config/permissions");

const router = express.Router();

const ROLE_META = {
  super_admin: { label: "超級管理員", emoji: "👑", home: "admin.html" },
  platform_manager: { label: "平台經理", emoji: "🧭", home: "admin.html" },
  platform_staff: { label: "平台職員", emoji: "🧑‍💼", home: "admin.html" },
  admin: { label: "管理員（客服）", emoji: "🎧", home: "admin.html" },
  auditor: { label: "核數（唯讀）", emoji: "📊", home: "admin.html" },
  partner_owner: { label: "場地負責人", emoji: "🏟️", home: "venue-dashboard.html" },
  partner_admin: { label: "場地管理", emoji: "🏟️", home: "venue-dashboard.html" },
  partner_staff: { label: "場地前台", emoji: "🛎️", home: "venue-reception.html" },
  org_admin: { label: "機構管理員", emoji: "🏫", home: "corporate-dashboard.html" },
  org_member: { label: "機構員工", emoji: "🏫", home: "my.html" },
  coach: { label: "教練", emoji: "🧑‍🏫", home: "coach-hub.html" },
  user: { label: "學員", emoji: "🎫", home: "my.html" },
  guest: { label: "遊客", emoji: "👀", home: "index.html" },
};

const PAGES = {
  super_admin: ["admin.html（全部 tab）", "admin-ops.html", "教練頁", "場地頁", "機構看板", "我的"],
  platform_manager: ["admin.html（除改角色／系統設定）", "admin-ops.html", "教練頁", "場地頁", "機構看板", "我的"],
  platform_staff: ["admin.html（客服 tabs）", "admin-ops.html", "教練頁", "場地頁", "機構看板", "我的"],
  admin: ["admin.html（客服 tabs）", "admin-ops.html", "教練頁", "場地頁", "機構看板", "我的"],
  auditor: ["admin.html（唯讀 tabs）", "我的"],
  partner_owner: ["venue-dashboard.html", "venue-reception.html", "我的"],
  partner_admin: ["venue-dashboard.html", "venue-reception.html", "我的"],
  partner_staff: ["venue-reception.html", "我的"],
  org_admin: ["corporate-dashboard.html", "我的"],
  org_member: ["我的"],
  coach: ["coach-hub.html", "coach-students.html", "coach-dashboard.html", "coach-console.html", "coach-earnings.html", "coach-schedule.html", "coach-attendance.html", "我的"],
  user: ["我的預約", "錢包", "積分", "家人", "通知"],
  guest: ["首頁", "探索課程", "課程詳情", "教練／場地介紹", "企業方案", "證書驗證", "條款"],
};

const GROUP_LABEL = {
  ops: "營運",
  finance: "財務",
  content: "內容",
  users: "用戶",
  system: "系統",
};

function groupOf(code) {
  return String(code).split(".")[0];
}

router.get("/role-matrix", authenticateToken, requirePermission("users.view"), (req, res) => {
  const roles = Object.keys(ROLE_PERMISSIONS).map((key) => {
    const meta = ROLE_META[key] || { label: key, emoji: "•", home: "index.html" };
    const perms = permissionsFor(key);
    const all = perms.includes("*");
    return {
      key,
      label: meta.label,
      emoji: meta.emoji,
      home: meta.home,
      level: ROLE_HIERARCHY[key] != null ? ROLE_HIERARCHY[key] : null,
      is_staff: hasMinimumRole(key, "admin") || key === "auditor",
      permission_count: all ? Object.keys(PERMISSIONS).length : perms.length,
      permissions: all ? Object.keys(PERMISSIONS) : perms,
      pages: PAGES[key] || [],
    };
  });

  const permissions = Object.entries(PERMISSIONS).map(([code, label]) => ({
    code,
    label,
    group: groupOf(code),
    group_label: GROUP_LABEL[groupOf(code)] || groupOf(code),
  }));

  const boundaries = [
    { label: "執行出糧（真正過數）", roles: roles.filter((r) => r.permissions.includes("finance.payout.process")).map((r) => r.key) },
    { label: "修改定價／會籍方案", roles: roles.filter((r) => r.permissions.includes("finance.pricing.write")).map((r) => r.key) },
    { label: "修改角色／停用帳號", roles: roles.filter((r) => r.permissions.includes("users.role.write")).map((r) => r.key) },
    { label: "確認收款", roles: roles.filter((r) => r.permissions.includes("finance.payment.confirm")).map((r) => r.key) },
    { label: "完成退款轉賬", roles: roles.filter((r) => r.permissions.includes("finance.refund.complete")).map((r) => r.key) },
    { label: "瀏覽資料庫（唯讀）", roles: roles.filter((r) => r.permissions.includes("system.db.view")).map((r) => r.key) },
  ];

  res.set("Cache-Control", "no-store");
  res.json({ success: true, roles, permissions, groups: GROUP_LABEL, boundaries });
});

module.exports = router;
