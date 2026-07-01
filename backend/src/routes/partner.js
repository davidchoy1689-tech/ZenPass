/**
 * ZenPass 禪流 — 商戶加盟系統路由 (精簡版)
 * Business logic 已移至 services/partner-service.js
 */

const express = require("express");
const { getDb } = require("../services/database");
const {
  authenticateToken,
  requireRole,
  requireOwnInstitution,
  ROLE_HIERARCHY,
  hasMinimumRole,
} = require("../middleware/auth");
const { ok, fail, notFound, created, serverError } = require("../services/response");
const { writeBlock } = require("../services/blockchain-audit");
const partnerService = require("../services/partner-service");

const router = express.Router();

// ===== POST /api/partner/apply — 公開申請 =====
router.post("/apply", (req, res) => {
  try {
    const result = partnerService.applyPartner(req);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ partner/apply error:", err.message);
    return serverError(res, "申請提交失敗，請稍後再試");
  }
});

// ===== GET /api/partner/status — 查詢申請狀態 =====
router.get("/status", authenticateToken, requireRole("user"), (req, res) => {
  try {
    const result = partnerService.getPartnerStatus(req.user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ partner/status error:", err.message);
    return serverError(res, "查詢申請狀態失敗");
  }
});

// ===== GET /api/partner/commission-plans =====
router.get("/commission-plans", (req, res) => {
  try {
    const result = partnerService.listCommissionPlans();
    return ok(res, result.body);
  } catch (err) {
    return serverError(res, "載入佣金計劃失敗");
  }
});

// ===== GET /api/partner/dashboard — 商戶儀表板 =====
router.get("/dashboard", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const result = partnerService.partnerDashboard(req.user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ partner/dashboard error:", err.message);
    return serverError(res, "載入儀表板失敗");
  }
});

// ===== GET /api/partner/revenue-report =====
router.get("/revenue-report", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const result = partnerService.revenueReport(req.user.id, req.query);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ partner/revenue-report error:", err.message);
    return serverError(res, "載入收入報表失敗");
  }
});

// ===== GET /api/partner/bookings — 商戶預約 =====
router.get("/bookings", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const result = partnerService.partnerBookings(req.user.id, req.query);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ partner/bookings error:", err.message);
    return serverError(res, "查詢預約記錄失敗");
  }
});

// ===== POST /api/partner/courses — 開新班 =====
router.post("/courses", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const result = partnerService.createCourse(req.user.id, req.body);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ partner/courses POST error:", err.message);
    return serverError(res, "建立課程失敗");
  }
});

// ===== GET /api/partner/courses =====
router.get("/courses", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const result = partnerService.listCourses(req.user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ partner/courses GET error:", err.message);
    return serverError(res, "查詢課程失敗");
  }
});

// ===== PUT /api/partner/courses/:id =====
router.put("/courses/:id", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const result = partnerService.updateCourse(req.user.id, req.params.id, req.body);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ partner/courses PUT error:", err.message);
    return serverError(res, "更新課程失敗");
  }
});

// ===== GET /api/partner/payouts =====
router.get("/payouts", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const result = partnerService.listPayouts(req.user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ partner/payouts error:", err.message);
    return serverError(res, "查詢結算記錄失敗");
  }
});

// ===== POST /api/partner/book — 場地預約 =====
router.post("/book", authenticateToken, requireRole("user"), (req, res) => {
  try {
    const result = partnerService.partnerBook(req.body, req.user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ partner/book error:", err.message);
    return serverError(res, "建立預約失敗");
  }
});

// ===== GET /api/partner/list — 公開場地列表 =====
router.get("/list", (req, res) => {
  try {
    const db = getDb();
    const partners = db.prepare(
      `SELECT id, name, description, category, district, logo_url, commission_plan, owner_id
       FROM partner_venues WHERE status = 'active' ORDER BY created_at DESC`
    ).all();
    res.json({ partners });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== GET /api/partner/roles =====
router.get("/roles", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    return ok(res, {
      hierarchy: ROLE_HIERARCHY,
      roles: Object.entries(ROLE_HIERARCHY)
        .map(([role, level]) => ({
          role, level,
          label: role.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        }))
        .sort((a, b) => a.level - b.level),
    });
  } catch (err) {
    return serverError(res, "載入角色層級失敗");
  }
});

// ===== PUT /api/partner/users/:id/role =====
router.put("/users/:id/role", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const { id } = req.params;
    const { role, partner_id } = req.body;

    if (!role || !ROLE_HIERARCHY[role]) {
      return fail(res, `無效角色。可用角色: ${Object.keys(ROLE_HIERARCHY).join(", ")}`, 400);
    }

    const db = getDb();
    const user = db.prepare("SELECT id, email, role, partner_id FROM users WHERE id = ?").get(id);
    if (!user) return notFound(res, "用戶不存在");

    if (hasMinimumRole(role, "admin") && !hasMinimumRole(req.user.role, "platform_manager")) {
      return fail(res, "你無法設定管理層級角色", 403);
    }

    db.prepare("UPDATE users SET role = ?, partner_id = COALESCE(?, partner_id), updated_at = datetime('now') WHERE id = ?")
      .run(role, partner_id || null, id);

    const updated = db.prepare("SELECT id, email, name, role, partner_id FROM users WHERE id = ?").get(id);

    try {
      writeBlock({
        entityType: "user_role_change", entityId: id,
        data: { user_id: id, old_role: user.role, new_role: role, changed_by: req.user.id, reason: `Role changed by ${req.user.role}` },
      });
    } catch (bcErr) { console.error("⚠️ Blockchain write failed (role change):", bcErr.message); }

    return ok(res, { message: `已更新用戶 ${updated.name} 角色為 ${role}`, user: updated });
  } catch (err) {
    console.error("❌ partner/users/:id/role error:", err.message);
    return serverError(res, "設定用戶角色失敗");
  }
});

// ===== GET /api/partner/members =====
router.get("/members", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const result = partnerService.listMembers(req.user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ partner/members error:", err.message);
    return serverError(res, "查詢成員失敗");
  }
});

// ===== POST /api/partner/members =====
router.post("/members", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    const result = partnerService.addMember(req.user.id, req.body);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ partner/members POST error:", err.message);
    return serverError(res, "新增成員失敗");
  }
});

// ===== DELETE /api/partner/members/:userId =====
router.delete("/members/:userId", authenticateToken, requireOwnInstitution, (req, res) => {
  try {
    if (!hasMinimumRole(req.user.role, "partner_admin")) {
      return fail(res, "需要管理權限先可移除成員", 403);
    }
    const result = partnerService.removeMember(req.user.id, req.params.userId);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ partner/members DELETE error:", err.message);
    return serverError(res, "移除成員失敗");
  }
});

// ===== Admin routes =====

router.get("/admin/partner-applications", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const result = partnerService.adminListApplications(req.query.status);
    return ok(res, result.body);
  } catch (err) {
    console.error("❌ admin/partner-applications error:", err.message);
    return serverError(res, "查詢申請列表失敗");
  }
});

router.post("/admin/partner-approve", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const result = partnerService.adminApprovePartner(req.body, req.user);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ admin/partner-approve error:", err.message);
    return serverError(res, "審批操作失敗");
  }
});

router.put("/admin/partner/:id", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const result = partnerService.adminUpdatePartner(req.params.id, req.body);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ admin/partner update error:", err.message);
    return serverError(res, "更新商戶設定失敗");
  }
});

router.get("/admin/partner-list", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const result = partnerService.adminListPartners(req.query.status);
    return ok(res, result.body);
  } catch (err) {
    console.error("❌ admin/partner-list error:", err.message);
    return serverError(res, "查詢商戶列表失敗");
  }
});

router.get("/admin/partner/:id/revenue", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const result = partnerService.adminRevenueReport(req.params.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ admin/partner revenue error:", err.message);
    return serverError(res, "查詢收入報表失敗");
  }
});

router.post("/admin/process-partner-payouts", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const result = partnerService.adminProcessPartnerPayouts(req.body);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ admin/process-partner-payouts error:", err.message);
    return serverError(res, "處理結算失敗");
  }
});

router.put("/admin/partner/:id/status", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const result = partnerService.adminSetPartnerStatus(req.params.id, req.body.status);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ admin/partner status error:", err.message);
    return serverError(res, "更新狀態失敗");
  }
});

router.get("/admin/partner/:id/courses", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const result = partnerService.adminPartnerCourses(req.params.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ admin/partner courses error:", err.message);
    return serverError(res, "查詢課程失敗");
  }
});

router.get("/admin/partner/:id/owner", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const result = partnerService.adminGetPartnerOwner(req.params.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ admin/partner owner error:", err.message);
    return serverError(res, "查詢負責人資訊失敗");
  }
});

router.put("/admin/partner/:id/owner", authenticateToken, requireRole("admin"), (req, res) => {
  try {
    const result = partnerService.adminSetPartnerOwner(req.params.id, req.body.owner_id, req.user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("❌ admin/partner owner assign error:", err.message);
    return serverError(res, "指派負責人失敗");
  }
});

module.exports = router;
