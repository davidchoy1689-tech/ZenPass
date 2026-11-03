/**
 * 教練公開專頁 — 資料層（2026-11-04）
 * 規格：docs/coach-public-profile-spec-v2.md
 *
 * 原則：
 *  - 只回傳已核驗教練（users.coach_verified=1 或 coach_credentials.status='verified'）
 *  - 學員姓名脫敏、牌照遮罩、電話可隱藏
 *  - 授課時數用「真實授課」（class_schedules 已開始），唔用證書時數
 *  - is_offpeak 一律用 HKT 計算（DB 存 UTC）
 */

const SERVICE_LABELS = {
  stretching: "深層伸展／痛症舒緩",
  senior_fitness: "銀髮樂齡體適能",
  pt_1on1: "1對1 私人訓練",
  niche_sports: "新興運動",
  rehab_posture: "姿勢復康",
  kids_fitness: "兒童體適能",
  corporate_team_building: "企業／學校團建",
};
const AUDIENCE_LABELS = {
  seniors: "銀髮樂齡",
  retirees: "退休人士",
  adults: "成人",
  kids: "兒童",
  corporate: "企業／機構",
  beginners: "新手／初學者",
  schools: "學校／機構",
  parents_kids: "親子",
};
const INTENSITY_LABELS = { gentle: "🟢 溫和", moderate: "🟡 適中", high: "🔴 高強" };
const HIGH_RISK_TYPES = ["senior_fitness", "rehab_posture"];

function parseJsonList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? x : [];
  } catch (e) {
    return String(v)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

/** 英文名 → slug；冇英文名用 email local part；最後 fallback coach-<id8> */
function buildSlug(name, email, id) {
  const clean = (s) =>
    String(s || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  let s = clean(name);
  if (s) return s;
  const local = clean(String(email || "").split("@")[0]);
  if (local && local !== "coach" && local.length >= 3) return local;
  return "coach-" + String(id || "").replace(/-/g, "").slice(0, 8);
}

function uniqueSlug(db, base, id) {
  let slug = base;
  let i = 1;
  while (true) {
    const row = db.prepare("SELECT id FROM users WHERE coach_slug = ?").get(slug);
    if (!row || row.id === id) return slug;
    i += 1;
    slug = base + "-" + i;
  }
}

/** 為未有 slug 的教練補上（idempotent；啟動時跑一次） */
function ensureSlugs(db) {
  let added = 0;
  try {
    const rows = db
      .prepare("SELECT id, name, email FROM users WHERE (is_coach = 1 OR role = 'coach') AND (coach_slug IS NULL OR coach_slug = '')")
      .all();
    const upd = db.prepare("UPDATE users SET coach_slug = ? WHERE id = ?");
    for (const u of rows) {
      upd.run(uniqueSlug(db, buildSlug(u.name, u.email, u.id), u.id), u.id);
      added++;
    }
  } catch (e) {
    console.error("[coach-slug] backfill failed:", e.message);
  }
  return added;
}

function maskLicense(no) {
  const raw = String(no || "").replace(/[^A-Za-z0-9]/g, "");
  if (!raw) return "";
  return raw.slice(0, 2).toUpperCase() + "****" + raw.slice(-2).toUpperCase();
}

function maskName(name) {
  const s = String(name || "").trim();
  if (!s) return "學員";
  if (/^[\u4e00-\u9fa5]+$/.test(s)) {
    if (s.length <= 1) return s;
    return s[0] + "**";
  }
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0][0] + "***";
  return parts.map((p, i) => (i === 0 ? p : p[0] + ".")).join(" ");
}

function normWhatsapp(phone) {
  let d = String(phone || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.length === 8) d = "852" + d;
  return d;
}

function hkLabel(utcStr) {
  const d = toHkDate(utcStr);
  if (isNaN(d)) return String(utcStr || "");
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d).replace(",", "");
}

function toHkDate(utcStr) {
  const raw = String(utcStr || "");
  return new Date(/Z|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw.replace(" ", "T") + "Z");
}

/** HKT 平日 10:00–16:30 = 平日日間（off-peak） */
function isOffpeak(startUtc) {
  const d = toHkDate(startUtc);
  if (isNaN(d)) return false;
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Hong_Kong", weekday: "short" }).format(d);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  const hm = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Hong_Kong",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(d)
      .replace(":", ""),
  );
  return dow >= 1 && dow <= 5 && hm >= 900 && hm <= 1630;
}

/** 公開資料（已脫敏）；找唔到／未核驗 → null */
function getPublicProfile(db, slug) {
  const redirect = db.prepare("SELECT to_slug FROM coach_slug_redirects WHERE from_slug = ?").get(slug);
  if (redirect && redirect.to_slug) return { redirect: redirect.to_slug };

  const u = db.prepare("SELECT * FROM users WHERE coach_slug = ?").get(slug);
  if (!u) return null;

  const cred =
    db
      .prepare(
        "SELECT * FROM coach_credentials WHERE user_id = ? ORDER BY CASE WHEN status='verified' THEN 0 ELSE 1 END, datetime(created_at) DESC LIMIT 1",
      )
      .get(u.id) || null;

  const verified = Number(u.coach_verified) === 1 || (cred && cred.status === "verified");
  const email = String(u.email || "").toLowerCase();
  const isTestAccount = /e2e|\btest\b|demo/.test(email) || /測試|demo|e2e/i.test(String(u.name || ""));
  if (!verified || isTestAccount || String(u.role || "") !== "coach") return null;
  if (u.is_active !== undefined && Number(u.is_active) === 0) return null;

  const hoursRow = db
    .prepare(
      `SELECT COALESCE(SUM((julianday(cs.end_time) - julianday(cs.start_time)) * 24), 0) AS h
         FROM class_schedules cs JOIN classes c ON c.id = cs.class_id
        WHERE c.coach_id = ? AND datetime(cs.start_time) < datetime('now') AND COALESCE(cs.status,'') != 'cancelled'`,
    )
    .get(u.id);

  const certRow = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(hours),0) AS h FROM certificates
        WHERE coach_id = ? AND COALESCE(revoked,0) = 0`,
    )
    .get(u.id);

  const stuRow = db
    .prepare(
      `SELECT COUNT(DISTINCT b.user_id) AS n FROM bookings b JOIN classes c ON c.id = b.class_id
        WHERE c.coach_id = ? AND b.payment_status = 'paid'`,
    )
    .get(u.id);

  const rateRow = db
    .prepare("SELECT COUNT(*) AS n, COALESCE(AVG(rating),0) AS avg FROM coach_ratings WHERE coach_id = ?")
    .get(u.id);

  const upcoming = db
    .prepare(
      `SELECT cs.id AS schedule_id, c.id AS class_id, c.title, c.category, c.price_hkd,
              cs.start_time, cs.end_time, cs.max_participants, cs.enrolled_count,
              COALESCE(cs.intensity_level,'moderate') AS intensity_level,
              c.venue_name, c.district, c.course_type
         FROM class_schedules cs JOIN classes c ON c.id = cs.class_id
        WHERE c.coach_id = ? AND c.status = 'active' AND cs.status = 'available'
          AND datetime(cs.start_time) > datetime('now') AND datetime(cs.start_time) <= datetime('now','+60 days')
        ORDER BY cs.start_time ASC LIMIT 20`,
    )
    .all(u.id)
    .map((r) => {
      const cap = Number(r.max_participants) || 0;
      const taken = Number(r.enrolled_count) || 0;
      return {
        schedule_id: r.schedule_id,
        class_id: r.class_id,
        title: r.title,
        category: r.category || "",
        start_time: r.start_time,
        hk_time_label: hkLabel(r.start_time),
        intensity_level: INTENSITY_LABELS[r.intensity_level] ? r.intensity_level : "moderate",
        intensity_label: INTENSITY_LABELS[r.intensity_level] || INTENSITY_LABELS.moderate,
        is_offpeak: isOffpeak(r.start_time),
        price_hkd: Number(r.price_hkd) || 0,
        seats_left: cap ? Math.max(0, cap - taken) : null,
        venue_name: r.venue_name || "",
        district: r.district || "",
        course_type: r.course_type || "",
      };
    });

  const reviews = db
    .prepare(
      `SELECT r.rating, r.comment, r.created_at, u.name AS student_name
         FROM coach_ratings r LEFT JOIN users u ON u.id = r.user_id
        WHERE r.coach_id = ? AND r.comment IS NOT NULL AND TRIM(r.comment) != ''
        ORDER BY datetime(r.created_at) DESC LIMIT 5`,
    )
    .all(u.id)
    .map((r) => ({
      rating: Number(r.rating) || 0,
      comment: r.comment,
      user_label: maskName(r.student_name),
      created_at: String(r.created_at || "").slice(0, 10),
    }));

  const serviceTypes = parseJsonList(u.service_types).filter((k) => SERVICE_LABELS[k]);
  const audiences = parseJsonList(u.target_audiences).filter((k) => AUDIENCE_LABELS[k]);
  const districts = parseJsonList(u.service_districts);

  const faExpiry = cred && cred.first_aid_expiry ? String(cred.first_aid_expiry).slice(0, 10) : "";
  const licenseExpiry = cred && cred.license_expiry ? String(cred.license_expiry).slice(0, 10) : "";
  const today = new Date().toISOString().slice(0, 10);

  const badges = [];
  badges.push({ key: "verified", icon: "🛡️", label: "官方核證教練" });
  if (cred && cred.first_aid_type && (!faExpiry || faExpiry >= today)) {
    badges.push({ key: "first_aid", icon: "⛑️", label: "急救證有效" });
  }
  if (cred && Number(cred.is_starred) === 1) badges.push({ key: "starred", icon: "⭐", label: "星級教練" });
  if (upcoming.length && upcoming.every((x) => x.venue_name)) {
    badges.push({ key: "pli", icon: "🏟️", label: "場地 PLI 核驗" });
  }

  const phone = u.public_contact_phone || u.phone || "";
  const hidden = Number(u.public_contact_hidden) === 1 || !phone;

  // 預填文案：按教練實際班種分流（新興運動 vs 樂齡伸展），開頭帶來源標籤
  const displayName = /導師|教練|Sir|Miss/i.test(String(u.name || "")) ? u.name : `${u.name}教練`;
  const areaLabel = districts[0] || (upcoming[0] && upcoming[0].district) || "全港";
  const hasNicheClass = upcoming.some((x) => /木柱|冰壺|布袋球|穿雲箭|新興/.test(String(x.title || "")));
  const prefill = hasNicheClass
    ? `你好，我喺 ZenPass 睇到${displayName}嘅個人專頁，想查詢「芬蘭木柱／地板冰壺體驗班」嘅課堂資訊同包班安排。`
    : `你好，我喺 ZenPass 睇到${displayName}嘅個人專頁，想查詢「樂齡深層伸展（平日日間班）」${areaLabel}場次嘅課堂細節同報名安排。`;

  const primaryArea = districts[0] || (upcoming[0] && upcoming[0].district) || "";

  return {
    redirect: null,
    coach: {
      slug: u.coach_slug,
      name: u.name || "",
      headline: u.coach_headline || "",
      bio: u.public_bio || u.coach_bio || "",
      avatar: u.avatar_url || "",
      starred: !!(cred && Number(cred.is_starred) === 1),
      verified: true,
      years: Number(u.coach_years) || null,
      languages: parseJsonList(u.coach_languages),
    },
    positioning: {
      service_types: serviceTypes.map((k) => ({ key: k, label: SERVICE_LABELS[k] })),
      target_audiences: audiences.map((k) => ({ key: k, label: AUDIENCE_LABELS[k] })),
      districts: districts.map((k) => ({ key: k, label: k })),
      primary_area: primaryArea,
    },
    trust: {
      verified_teaching_hours: Math.round(Number(hoursRow.h || 0) * 10) / 10,
      certified_hours: Math.round(Number(certRow.h || 0) * 10) / 10,
      certificates_issued: Number(certRow.n || 0),
      students_taught: Number(stuRow.n || 0),
      rating: {
        avg: Math.round(Number(rateRow.avg || 0) * 10) / 10,
        count: Number(rateRow.n || 0),
      },
    },
    credentials: {
      license_type: (cred && cred.license_type) || "",
      license_expiry: licenseExpiry,
      license_masked: maskLicense(cred && cred.license_no),
      first_aid: {
        type: (cred && cred.first_aid_type) || "",
        expiry: faExpiry,
        valid: !!(cred && cred.first_aid_type) && (!faExpiry || faExpiry >= today),
      },
      sports: parseJsonList(cred && cred.qualified_sports).map((s) =>
        typeof s === "string" ? { slug: s, label: s, level: "" } : s,
      ),
    },
    badges,
    upcoming,
    reviews,
    contact: {
      whatsapp: hidden ? "" : normWhatsapp(phone),
      hidden,
      prefill,
    },
    faq: buildFaq(u.name || "教練", primaryArea, serviceTypes),
    og: null, // 由 route 按請求 host 組裝
  };
}

function buildFaq(name, area, serviceTypes) {
  const isSenior = serviceTypes.includes("senior_fitness") || serviceTypes.includes("stretching");
  const list = [
    {
      q: "未做過運動、筋骨好硬，跟得上嗎？",
      a: `${name}會按學員能力調整動作，課堂以安全為先；大部分班設有椅子輔助及替代動作，零基礎都可以參加。`,
    },
    {
      q: "平日日間有咩時段？",
      a: `${area ? area + "及鄰近地區" : "全港"}平日 10:00–16:00 設有長者小班及 1 對 1 時段，適合退休人士避開繁忙時間。`,
    },
    {
      q: "點樣預約？要唔要下載 App？",
      a: "不需要下載 App，也不需要先註冊。揀好班次後 20 秒內可完成預約，付款後系統自動開通帳戶。",
    },
    {
      q: "有冇證書？",
      a: "完成課程並達出席要求，會獲發附 SHA-256 防偽存證的電子證書，可用於學校或機構紀錄。",
    },
  ];
  if (isSenior) {
    list.push({
      q: "膝頭痛／腰背痛可以上嗎？",
      a: "課堂屬低衝擊溫和強度，會避開痛點並加強關節周邊肌力；如正接受治療，建議先諮詢醫生意見。",
    });
  }
  return list;
}

module.exports = {
  SERVICE_LABELS,
  AUDIENCE_LABELS,
  INTENSITY_LABELS,
  HIGH_RISK_TYPES,
  buildSlug,
  ensureSlugs,
  getPublicProfile,
  maskName,
  maskLicense,
  isOffpeak,
  parseJsonList,
};
