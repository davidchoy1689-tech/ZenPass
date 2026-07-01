/**
 * ZenPass 禪流 — 管理員路由 (精簡版)
 * Business logic 已移至 services/admin-service.js
 */

const express = require("express");
const { getDb } = require("../services/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { queryAudit } = require("../services/audit");
const adminService = require("../services/admin-service");

const router = express.Router();

// ===== GET /api/admin/pending-payments =====
router.get("/pending-payments", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.listPendingPayments();
    res.json(result);
  } catch (err) {
    console.error("取待確認付款錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得待確認付款" });
  }
});

// ===== POST /api/admin/approve-payment =====
router.post("/approve-payment", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.approvePayment(req.body.booking_id, req.user.id, req);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("確認付款錯誤:", err);
    res.status(500).json({ success: false, error: "確認付款失敗" });
  }
});

// ===== POST /api/admin/reject-payment =====
router.post("/reject-payment", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.rejectPayment(req.body.booking_id, req.body.reason, req.user.id, req);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("拒絕付款錯誤:", err);
    res.status(500).json({ success: false, error: "拒絕付款失敗" });
  }
});

// ===== GET /api/admin/stats =====
router.get("/stats", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.getDashboardStats();
    res.json(result);
  } catch (err) {
    console.error("取統計錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得統計資料" });
  }
});

// ===== GET /api/admin/bookings =====
router.get("/bookings", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.listAllBookings(req.query);
    res.json(result);
  } catch (err) {
    console.error("取預約記錄錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得預約記錄" });
  }
});

// ===== GET /api/admin/users =====
router.get("/users", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.listAllUsers();
    res.json(result);
  } catch (err) {
    console.error("取用戶列表錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得用戶列表" });
  }
});

// ===== GET /api/admin/classes =====
router.get("/classes", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.listAllClasses();
    res.json(result);
  } catch (err) {
    console.error("取課程列表錯誤:", err);
    res.status(500).json({ success: false, error: "無法取得課程列表" });
  }
});

// ===== GET /api/admin/db/:table & /api/admin/db =====
router.get("/db/:table", async (req, res) => {
  try {
    const { getSupabase } = require("../services/supabase");
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });

    const { table } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const { data, error } = await supabase.from(table).select("*").limit(limit);
    if (error) throw error;
    const { count, error: countErr } = await supabase.from(table).select("*", { count: "exact", head: true });

    res.json({ data: data || [], count: count || 0, error: countErr?.message || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/db", async (req, res) => {
  try {
    const { getSupabase } = require("../services/supabase");
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });

    const tables = [
      "system_config", "system_backups", "courses", "course_sessions", "course_categories",
      "bookings", "transactions", "settlements", "users", "profiles", "coaches", "students",
      "membership_plans", "user_memberships", "payments", "commissions", "payouts",
      "venues", "partners", "attendance", "reviews", "notifications", "waitlist", "promotions",
    ];

    const result = [];
    for (const t of tables) {
      try {
        const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
        result.push({ table: t, count: count || 0 });
      } catch (e) {
        result.push({ table: t, count: -1, error: e.message });
      }
    }

    res.json({ tables: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST /api/admin/process-payouts =====
router.post("/process-payouts", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.processCoachPayouts(req.user.id, req);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("批量出糧錯誤:", err);
    res.status(500).json({ success: false, error: "出糧處理失敗" });
  }
});

// ===== GET /api/admin/payouts =====
router.get("/payouts", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.listPayouts(req.query);
    res.json(result);
  } catch (err) {
    console.error("取 payout 記錄錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取出糧記錄" });
  }
});

// ===== Coach applications =====
router.get("/coach-applications", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.listCoachApplications(req.query.status);
    res.json(result);
  } catch (err) {
    console.error("取教練申請錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取教練申請" });
  }
});

router.post("/coach-approve", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.approveCoach(req.body.application_id, req.user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("審批教練錯誤:", err);
    res.status(500).json({ success: false, error: "審批失敗" });
  }
});

router.post("/coach-reject", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.rejectCoach(req.body.application_id, req.body.reason, req.user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("拒絕教練錯誤:", err);
    res.status(500).json({ success: false, error: "操作失敗" });
  }
});

// ===== GET /api/admin/course-detail/:id =====
router.get("/course-detail/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.getCourseDetail(req.params.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("取課程詳情錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取課程詳情" });
  }
});

// ===== GET /api/admin/user-detail/:id =====
router.get("/user-detail/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.getUserDetail(req.params.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("取用戶詳情錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取用戶詳情" });
  }
});

// ===== GET /api/admin/coach-detail/:id =====
router.get("/coach-detail/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.getCoachDetail(req.params.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("取教練詳情錯誤:", err);
    res.status(500).json({ success: false, error: "無法獲取教練詳情" });
  }
});

// ===== POST /api/admin/assign-coach =====
router.post("/assign-coach", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.assignCoach(req.body.class_id, req.body.coach_id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("指派教練錯誤:", err);
    res.status(500).json({ success: false, error: "指派教練失敗" });
  }
});

// ===== POST /api/admin/notify-course-spots =====
router.post("/notify-course-spots", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.notifyCourseSpots(req.body.class_id, req.body.message);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("通知課程空位錯誤:", err);
    res.status(500).json({ success: false, error: "通知失敗" });
  }
});

// ===== PUT /api/admin/update-course/:id =====
router.put("/update-course/:id", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.updateCourse(req.params.id, req.body);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("更新課程錯誤:", err);
    res.status(500).json({ success: false, error: "更新課程失敗" });
  }
});

// ===== POST /api/admin/generate-description =====
// AI 描述生成 - 範本系統（保留喺 route 因為係 UI helper）
const DESCRIPTION_TEMPLATES = {
  瑜伽: {
    keywords: {
      空中: ["%s 利用空中瑜伽吊床（Hammock）進行懸吊練習，透過反重力動作幫助脊柱減壓、改善血液循環。由導師從基本掛布動作教起，適合想挑戰新事物嘅學員。","%s 喺空中吊床上進行各種瑜伽動作，利用地心引力進行深度伸展同核心鍛鍊。課程由經驗導師指導，確保安全同正確姿勢。"],
      熱: ["%s 喺溫暖嘅課室中進行瑜伽練習，幫助肌肉更容易放鬆伸展。課堂包含流暢嘅體位法串聯，適合想排毒出汗、提升柔軟度嘅學員。"],
      "哈達|Hatha": ["%s 以傳統哈達瑜伽為基礎，每個動作停留幾個呼吸，專注於正確對位同身體覺察。課堂節奏較慢，適合想深入了解瑜伽基礎嘅學員。"],
      "Flow|流": ["%s 以流暢嘅動作串聯（Vinyasa）為主，將呼吸與動作同步，喺動態練習中提升肌力、柔韌度同心肺功能。"],
      "陰|Yin|深|深層": ["%s 以長時間停留的被動伸展為主，針對深層結締組織進行放鬆。課堂節奏緩慢，配合靜態保持，幫助釋放身體深層嘅緊張。"],
      "冥想|Meditation": ["%s 結合格位法練習與冥想引導，喺動與靜之間尋找平衡。課堂包含呼吸練習、體位法同靜坐環節，幫助身心整合。"],
      "初學|基礎|入門|Beginner": ["%s 專為瑜伽初學者設計，由基本體位法（Asana）開始教起，逐步建立正確姿勢同呼吸習慣。小班教學，確保每位學員得到足夠指導。"],
      "孕|產前|Prenatal": ["%s 專為孕期婦女設計，透過安全嘅瑜伽動作幫助舒緩懷孕期間嘅身體不適，強化骨盆底肌，為生產做好準備。"],
    },
    default: ["%s 透過瑜伽體位法、呼吸練習與放鬆技巧，幫助學員提升身體柔軟度、增強核心力量，同時舒緩壓力，讓身心達到平衡。","%s 由經驗導師帶領，透過流暢嘅動作串聯與靜態伸展，改善身體靈活性同姿勢，帶給你身心舒暢嘅體驗。","%s 融合傳統瑜伽練習與現代運動概念，幫助你喺安全嘅環境中探索身體嘅潛能，提升柔韌度與肌力。","%s 課堂包含呼吸協調、體位法練習同深層放鬆，適合任何程度嘅學員參加。由導師循序漸進引導，讓身體慢慢打開。","%s 透過有系統嘅瑜伽練習，逐步提升身體覺察力同控制能力。每堂課都會因應學員狀況調整內容，確保安全有效。","%s 提供一個寧靜嘅空間讓你暫時遠離日常煩囂，專注於身體同呼吸。適合任何想透過瑜伽放鬆身心嘅人士。"],
  },
  健身: {
    keywords: {
      "HIIT|高強度|間歇|燃脂": ["%s 以高強度間歇訓練（HIIT）為核心，短時間內進行高強度動作配合短暫休息，有效提升代謝率同燃脂效果。","%s 透過短時間高強度訓練，讓身體喺運動後持續燃燒卡路里。適合想用最短時間達到最佳效果嘅學員。"],
      "TRX|懸吊": ["%s 利用 TRX 懸吊系統，以自身體重進行多平面訓練，重點鍛鍊核心穩定性同全身肌力。"],
      "跑步|Run|Running": ["%s 由專業跑步教練帶領，學習正確跑姿、呼吸節奏同訓練方法，適合想提升跑步表現或開始跑步嘅學員。"],
      "CrossFit|Crossfit|綜合體能": ["%s 結合多種功能性動作，喺高效嘅訓練中全面提升肌力、爆發力、耐力同心肺功能。課堂氣氛積極，適合喜歡挑戰嘅學員。"],
      "街頭|Street|Calisthenics|徒手": ["%s 以自身體重進行街頭健身訓練，包括掌上壓、引體上升等經典動作，由教練從基本動作教起，逐步提升難度。"],
      "拳擊|Boxing|搏擊": ["%s 透過基本拳擊動作同組合訓練，有效提升心肺功能、手眼協調同全身協調性。由專業教練從基本拳法教起。"],
      "初學|入門|基礎|Beginner|新手": ["%s 專為健身初學者設計，從基本動作模式（深蹲、推拉、核心穩定）開始教起，建立安全有效嘅訓練基礎。"],
    },
    default: ["%s 透過不同訓練模式，幫助學員提升肌力、耐力同心肺功能。課堂由專業教練帶領，適合想改善體能同建立運動習慣嘅人士。","%s 結合多種訓練方式，包括肌力訓練、心肺訓練同核心鍛鍊，全面提升體能水平。每堂課都會因應學員程度調整強度。","%s 專為想提升體能嘅學員設計，透過系統化訓練提升肌力、爆發力同耐力。無論你係初學者定有經驗，都能搵到適合嘅挑戰。","%s 由教練根據學員能力設計訓練內容，確保每位學員都喺安全嘅環境中逐步進步。適合想持續鍛鍊嘅人士。","%s 課堂包含動態熱身、主訓練同靜態伸展，完整嘅訓練流程幫助學員有效提升體能同時預防受傷。","%s 透過團體訓練嘅互動氣氛，讓運動變得更有趣。教練會從旁指導動作，確保正確姿勢，適合任何程度學員。"],
  },
  default: {
    keywords: {},
    default: ["%s 由專業教練帶領，透過系統化教學幫助學員掌握基本技巧與知識。課程適合任何程度嘅參加者。","%s 專為對運動有興趣嘅人士設計，由教練循序漸進指導，讓學員喺安全嘅環境中學習同進步。","%s 透過實際練習與專業指導，幫助學員了解基本技巧與要領。課堂注重正確姿勢同安全。","%s 由經驗導師設計課程內容，按學員程度調整教學進度。適合想建立運動習慣嘅你。","%s 喺輕鬆嘅課堂氣氛中學習，由教練從旁指導矯正。無論你嘅目標係乜，我哋都會幫你一步步達成。"],
  },
};

router.post("/generate-description", authenticateToken, requireAdmin, (req, res) => {
  try {
    const { title, category, difficulty, venue_name } = req.body;
    if (!title) return res.status(400).json({ success: false, error: "請提供課程名稱" });

    let catData = DESCRIPTION_TEMPLATES.default;
    if (category) {
      for (const [key, val] of Object.entries(DESCRIPTION_TEMPLATES)) {
        const keys = key.split("|");
        if (keys.some((k) => category.includes(k.trim()))) {
          catData = val;
          break;
        }
      }
    }

    let matchedTemplates = null;
    for (const [keyword, templates] of Object.entries(catData.keywords)) {
      const words = keyword.split("|");
      if (words.some((w) => title.toLowerCase().includes(w.toLowerCase().trim()))) {
        matchedTemplates = templates;
        break;
      }
    }

    const primaryPool = matchedTemplates || catData.default;
    let pool = primaryPool;
    if (primaryPool.length < 3 && catData.default) {
      pool = primaryPool.concat(catData.default);
    }

    let seed = 0;
    for (let chi = 0; chi < title.length; chi++) seed += title.charCodeAt(chi);

    const descriptions = [];
    const usedIndices = [];
    for (let gi = 0; gi < 3 && gi < pool.length; gi++) {
      let idx = (seed + gi * 7 + gi * gi) % pool.length;
      let attempts = 0;
      while (usedIndices.indexOf(idx) !== -1 && attempts < pool.length) {
        idx = (idx + 1) % pool.length;
        attempts++;
      }
      usedIndices.push(idx);
      let desc = pool[idx].replace("%s", title);
      if (venue_name) desc += " 📍 " + venue_name;
      if (difficulty === "beginner") desc = "【初學者友善】" + desc;
      else if (difficulty === "intermediate") desc = "【中級強度】" + desc;
      else if (difficulty === "advanced") desc = "【高階挑戰】" + desc;
      descriptions.push(desc);
    }

    res.json({ descriptions, generated: true });
  } catch (err) {
    console.error("生成描述錯誤:", err);
    res.status(500).json({ success: false, error: "生成描述失敗" });
  }
});

// ===== GET /api/admin/audit-log =====
router.get("/audit-log", authenticateToken, requireAdmin, (req, res) => {
  try {
    const entries = queryAudit({
      limit: parseInt(req.query.limit) || 200,
      offset: parseInt(req.query.offset) || 0,
    });
    res.json({ entries });
  } catch (err) {
    console.error("[ADMIN] audit-log error:", err.message);
    res.status(500).json({ success: false, error: "load audit log failed" });
  }
});

// ===== GET /api/admin/revenue-dashboard =====
router.get("/revenue-dashboard", authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = adminService.getRevenueDashboard();
    res.json(result);
  } catch (err) {
    console.error("[REVENUE DASHBOARD] Error:", err.message);
    res.status(500).json({ success: false, error: "讀取收入 Dashboard 失敗" });
  }
});

module.exports = router;
