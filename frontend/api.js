/**
 * ZenPass 禪流 - API 服務層
 * 連接前端與後端的橋樑
 */

// ===== Global Utility Helpers =====
function escHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ===== Name-keyed Storage Helper =====
function zpKey(baseKey) {
  var name = localStorage.getItem("zenpass_name") || "default";
  return "zp_" + name.replace(/\s/g, "_") + "_" + baseKey;
}

// ===== Demo Mode Detection (dev only) =====
// First-time visitor: auto-create demo user for smooth onboarding
(function () {
  if (
    !localStorage.getItem("zenpass_token") &&
    !localStorage.getItem("zenpass_user")
  ) {
    localStorage.setItem("zenpass_token", "demo_token_student");
    localStorage.setItem(
      "zenpass_user",
      JSON.stringify({
        name: "訪客",
        email: "guest@zenpass.hk",
        phone: "",
        role: "student",
        credits: 10,
        bookings: 0,
        joined: new Date().toISOString().split("T")[0],
        avatar: "🎓",
        is_all_access: false,
      }),
    );
  }
})();

// Auto-detect API base URL
const API_BASE = (() => {
  // Always use relative path — works with tunnel, local dev, and same-origin proxy
  // For GitHub Pages: the user needs a backend running, and /api won't work on github.io
  // In that case, the courses.json fallback kicks in for read-only viewing
  return "/api";
})();

// ===== OAuth Config (injected via login.html or .env) =====
// Set these before GIS/Apple SDK loads
window.ZENPASS_GOOGLE_CLIENT_ID = window.ZENPASS_GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
window.ZENPASS_APPLE_CLIENT_ID = window.ZENPASS_APPLE_CLIENT_ID || "YOUR_APPLE_CLIENT_ID";

// Store Apple client ID for login.html usage
localStorage.setItem("zenpass_apple_client_id", window.ZENPASS_APPLE_CLIENT_ID);

// ===== Backend Health Check (for GitHub Pages) =====
var BACKEND_ONLINE = true;

(async function () {
  if (API_BASE === "/api") {
    BACKEND_ONLINE = true;
    return;
  }
  try {
    var r = await fetch(API_BASE + "/health", {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    BACKEND_ONLINE = r.ok;
  } catch (e) {
    BACKEND_ONLINE = false;
    console.warn("🧘 ZenPass: Backend offline, using courses.json fallback");
  }
  if (!BACKEND_ONLINE) {
    // Show offline banner once
    var banner = document.createElement("div");
    banner.id = "backend-offline-banner";
    banner.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:99999;background:#fef3c7;color:#92400e;text-align:center;padding:8px 16px;font-size:13px;font-family:sans-serif;border-bottom:1px solid #fde68a";
    banner.innerHTML =
      "⚠️ 後台未連接 — 部分功能不可用。如需完整功能，請啟動 ZenPass Backend";
    document.body.prepend(banner);
  }
})();

// ===== Demo Login (Role-based) =====
function demoLogin(role) {
  const demoUser = {
    name:
      role === "coach"
        ? "靜儀導師"
        : role === "admin"
          ? "David Choy"
          : "張三同學",
    email:
      role === "coach"
        ? "coach@zenpass.hk"
        : role === "admin"
          ? "david@zenpass.hk"
          : "student@zenpass.hk",
    phone:
      role === "coach"
        ? "9234 5678"
        : role === "admin"
          ? "9033 5538"
          : "9876 5432",
    role: role,
    credits: role === "coach" ? 0 : 45,
    bookings: role === "coach" ? 0 : 12,
    joined: "2026-01-20",
    avatar: role === "coach" ? "🧘" : role === "admin" ? "👤" : "🎓",
  };
  setToken("demo_token_" + role);
  storeUser(demoUser);
  const overlay = document.querySelector(".zen-overlay");
  if (overlay) {
    overlay.classList.remove("show");
    setTimeout(() => overlay.remove(), 300);
  }
  showToast(
    "✅ 已登入為" +
      (role === "coach"
        ? "教練 " + demoUser.name
        : role === "admin"
          ? "管理員 " + demoUser.name
          : "學生 " + demoUser.name),
    "success",
  );
  setTimeout(() => location.reload(), 800);
}

// ===== Token 管理 =====
function getToken() {
  return localStorage.getItem("zenpass_token");
}

function setToken(token) {
  localStorage.setItem("zenpass_token", token);
}

function clearToken() {
  localStorage.removeItem("zenpass_token");
  localStorage.removeItem("zenpass_user");
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("zenpass_user"));
  } catch {
    return null;
  }
}

function storeUser(user) {
  // Ensure user has a role field
  if (user && !user.role) {
    // Auto-detect role from email or set default
    if (user.email && user.email.includes("coach")) {
      user.role = "coach";
    } else {
      user.role = "student";
    }
  }
  localStorage.setItem("zenpass_user", JSON.stringify(user));
}

function getUser() {
  return getStoredUser();
}

function getUserRole() {
  const user = getUser();
  return user ? user.role || "student" : null;
}

function isCoach() {
  return getUserRole() === "coach";
}

function isAdmin() {
  const user = getUser();
  return user && (user.role === "admin" || user.email === "david@zenpass.hk");
}

function isLoggedIn() {
  return !!getToken();
}

// ===== API 請求封裝 =====
async function apiRequest(method, path, data = null) {
  const url = `${API_BASE}${path}`;
  const headers = { "Content-Type": "application/json" };

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const options = { method, headers };
  if (data && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(url, options);
    const result = await response.json();

    if (!response.ok) {
      // Token expired / auth invalid → auto redirect to login
      if (
        response.status === 401 ||
        (result.error &&
          (result.error.includes("認證無效") || result.error.includes("過期")))
      ) {
        var redirectUrl = window.location.href;
        localStorage.removeItem("zenpass_token");
        window.location.href =
          "login.html?redirect=" + encodeURIComponent(redirectUrl);
        return;
      }
      throw new Error(result.error || `請求失敗 (${response.status})`);
    }

    return result;
  } catch (err) {
    if (
      err.message.includes("Failed to fetch") ||
      err.message.includes("NetworkError")
    ) {
      throw new Error("無法連接到伺服器，請檢查網絡連線");
    }
    if (err.message.includes("認證無效") || err.message.includes("過期")) {
      var redirectUrl = window.location.href;
      localStorage.removeItem("zenpass_token");
      window.location.href =
        "login.html?redirect=" + encodeURIComponent(redirectUrl);
      return;
    }
    throw err;
  }
}

// ===== 通用上傳（支援 FormData） =====
async function apiPost(path, body, isFormData = false) {
  const url = `${API_BASE}${path}`;
  const headers = {};

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Don't set Content-Type for FormData (browser sets it with boundary)
  const options = isFormData
    ? { method: "POST", headers, body }
    : {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      };

  try {
    const response = await fetch(url, options);
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `請求失敗 (${response.status})`);
    }
    return result;
  } catch (err) {
    if (
      err.message.includes("Failed to fetch") ||
      err.message.includes("NetworkError")
    ) {
      throw new Error("無法連接到伺服器");
    }
    throw err;
  }
}

// ===== 認證 API =====
const auth = {
  register: (data) => apiRequest("POST", "/auth/register", data),
  login: (data) => apiRequest("POST", "/auth/login", data),
  social: (data) => apiRequest("POST", "/auth/social", data),
  me: () => apiRequest("GET", "/auth/me"),
};

// ===== Courses.json fallback (when backend is offline) =====
var COURSES_CACHE = null;

var COURSES_JSON_URL =
  "https://raw.githubusercontent.com/davidchoy1689-tech/ZenPass/main/courses.json";

// Auto-detect: if running locally from GitHub Pages, use same-origin path
(function () {
  var host = window.location.hostname;
  if (host.indexOf("github.io") > -1 || host.indexOf("github.dev") > -1) {
    COURSES_JSON_URL = window.location.origin + "/ZenPass/courses.json";
  } else if (host === "localhost" || host === "127.0.0.1") {
    COURSES_JSON_URL = "/courses.json";
  }
})();

async function fetchCoursesJson() {
  if (COURSES_CACHE) return COURSES_CACHE;
  try {
    var resp = await fetch(COURSES_JSON_URL);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    COURSES_CACHE = await resp.json();
    return COURSES_CACHE;
  } catch (e) {
    // Last resort: try relative path
    try {
      var resp2 = await fetch("./courses.json");
      if (resp2.ok) {
        COURSES_CACHE = await resp2.json();
        return COURSES_CACHE;
      }
    } catch (e2) {}
    throw new Error("無法載入課程資料");
  }
}

// Extract unique categories from courses.json data
function extractCategories(data) {
  var cats = {};
  var list = data.classes || [];
  for (var i = 0; i < list.length; i++) {
    var c = list[i].category;
    if (c && !cats[c]) cats[c] = { category: c, count: 0 };
    if (c) cats[c].count++;
  }
  var result = [];
  for (var k in cats) {
    if (cats.hasOwnProperty ? cats.hasOwnProperty(k) : cats[k] !== undefined) {
      result.push(cats[k]);
    }
  }
  return result;
}

// Apply URL params filter on class list
function filterClasses(list, params) {
  var result = list;
  if (params.category && params.category !== "all") {
    result = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].category === params.category) result.push(list[i]);
    }
  }
  if (params.search) {
    var q = params.search.toLowerCase();
    var filtered = [];
    for (var i = 0; i < result.length; i++) {
      var cls = result[i];
      if (
        (cls.title && cls.title.toLowerCase().indexOf(q) > -1) ||
        (cls.category && cls.category.toLowerCase().indexOf(q) > -1) ||
        (cls.coach_name && cls.coach_name.toLowerCase().indexOf(q) > -1)
      ) {
        filtered.push(cls);
      }
    }
    result = filtered;
  }
  if (params.difficulty) {
    var filtered = [];
    for (var i = 0; i < result.length; i++) {
      if (result[i].difficulty === params.difficulty) filtered.push(result[i]);
    }
    result = filtered;
  }
  // Sort
  if (params.sort === "popular") {
    result = result.slice().sort(function (a, b) {
      return (b.popular ? 1 : 0) - (a.popular ? 1 : 0) || b.rating - a.rating;
    });
  }
  // Limit
  if (params.limit) {
    result = result.slice(0, parseInt(params.limit));
  }
  return result;
}

// ===== 通知系統 =====
// 要求發送通知權限（用於課前提醒）
function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}
// 設定課前提醒（1小時前）
function scheduleReminder(className, classTime) {
  if (!("Notification" in window) || Notification.permission !== "granted")
    return;
  var time = new Date(classTime).getTime() - 3600000; // 1 hour before
  var now = Date.now();
  if (time <= now) return;
  setTimeout(function () {
    new Notification("🔔 ZenPass 課前提醒", {
      body: "「" + className + "」將於 1 小時後開始！",
      icon: "/favicon.png",
    });
  }, time - now);
}

// ===== 課程 API =====
const classes = {
  list: async (params) => {
    if (!params) params = {};
    try {
      var query = new URLSearchParams(params).toString();
      var result = await apiRequest("GET", "/classes?" + query);
      return result;
    } catch (e) {
      // Backend unavailable — fetch courses.json
      var data = await fetchCoursesJson();
      var filtered = filterClasses(data.classes || [], params);
      // Only return active courses
      var active = [];
      for (var i = 0; i < filtered.length; i++) {
        if (filtered[i].status === "active") active.push(filtered[i]);
      }
      return { classes: active };
    }
  },
  get: async (id) => {
    try {
      return await apiRequest("GET", "/classes/" + id);
    } catch (e) {
      var data = await fetchCoursesJson();
      var list = data.classes || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id == id) {
          var cls = JSON.parse(JSON.stringify(list[i]));
          var scheds = cls.schedules || [];
          var reviews = cls.reviews || [];
          delete cls.schedules;
          delete cls.reviews;
          return { class: cls, schedules: scheds, reviews: reviews };
        }
      }
      throw new Error("課程不存在");
    }
  },
  categories: async () => {
    try {
      return await apiRequest("GET", "/classes/categories");
    } catch (e) {
      var data = await fetchCoursesJson();
      var cats = extractCategories(data);
      if (cats.length === 0) {
        cats = [
          { category: "瑜伽", count: 1 },
          { category: "健身", count: 1 },
          { category: "伸展", count: 1 },
          { category: "冥想", count: 1 },
          { category: "舞蹈", count: 1 },
          { category: "新興運動", count: 1 },
          { category: "皮拉提斯", count: 1 },
          { category: "兒童體適能", count: 1 },
          { category: "肌力訓練", count: 1 },
          { category: "心肺訓練", count: 1 },
          { category: "拳擊搏擊", count: 1 },
          { category: "單車", count: 1 },
          { category: "水中運動", count: 1 },
          { category: "太極養生", count: 1 },
          { category: "羽毛球", count: 1 },
          { category: "乒乓球", count: 1 },
          { category: "攀岩", count: 1 },
          { category: "射箭", count: 1 },
          { category: "劍擊", count: 1 },
          { category: "泰拳搏擊", count: 1 },
          { category: "高爾夫球", count: 1 },
          { category: "露營戶外", count: 1 },
          { category: "長者體適能", count: 1 },
          { category: "產後修復", count: 1 },
          { category: "空中瑜伽", count: 1 },
          { category: "芭蕾塑形", count: 1 },
          { category: "TRX 懸吊訓練", count: 1 },
          { category: "詠春", count: 1 },
          { category: "遠足行山", count: 1 },
          { category: "溜冰", count: 1 },
          { category: "網球", count: 1 },
          { category: "保齡球", count: 1 },
        ];
      }
      return { categories: cats };
    }
  },
};

// ===== 預約 API =====
const bookings = {
  create: (data) => apiRequest("POST", "/bookings", data),
  my: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest("GET", `/bookings/my?${query}`);
  },
  cancel: (id) => apiRequest("POST", `/bookings/${id}/cancel`),
};

// ===== 會籍 API =====
const memberships = {
  plans: () => apiRequest("GET", "/memberships/plans"),
  subscribe: (data) => apiRequest("POST", "/memberships/subscribe", data),
  my: () => apiRequest("GET", "/memberships/my"),
  credits: (data) => apiRequest("POST", "/memberships/credits", data),
  packages: () => apiRequest("GET", "/pricing/packages"),
};

// ===== 用戶 API =====
const users = {
  profile: () => apiRequest("GET", "/users/profile"),
  update: (data) => apiRequest("PUT", "/users/profile", data),
  credits: () => apiRequest("GET", "/users/credits"),
};

// ===== 教練 API =====
const coach = {
  apply: (data) => apiRequest("POST", "/coach/apply", data),
  application: () => apiRequest("GET", "/coach/application"),
  myClasses: () => apiRequest("GET", "/coach/my-classes"),
  addSchedule: (data) => apiRequest("POST", "/coach/schedules", data),
  earnings: () => apiRequest("GET", "/coach/earnings"),
  earningsDetail: (params) =>
    apiRequest(
      "GET",
      "/coach/earnings/detail?" + new URLSearchParams(params || {}),
    ),
  calculateEarnings: () => apiRequest("POST", "/coach/earnings/calculate"),
  payoutRequest: (data) => apiRequest("POST", "/coach/payout-request", data),
  payoutHistory: () => apiRequest("GET", "/coach/payout-history"),
  privateIncome: (params) =>
    apiRequest(
      "GET",
      "/coach/private-income?" + new URLSearchParams(params || {}),
    ),
  addPrivateIncome: (data) => apiRequest("POST", "/coach/private-income", data),
  deletePrivateIncome: (id) =>
    apiRequest("DELETE", "/coach/private-income/" + id),
};

// ===== 付款 API =====
const payments = {
  gateways: () => apiRequest("GET", "/payments/gateways"),
  stripeIntent: (data) =>
    apiRequest("POST", "/payments/stripe/create-intent", data),
  stripeConfirm: (data) => apiRequest("POST", "/payments/stripe/confirm", data),
  fps: (data) => apiRequest("POST", "/payments/fps", data),
  payme: (data) => apiRequest("POST", "/payments/payme", data),
};

// ===== Toast 通知 =====
function showToast(message, type = "info") {
  // Remove existing toast
  const existing = document.querySelector(".zen-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `zen-toast zen-toast-${type}`;

  const icons = { success: "✅", error: "❌", info: "ℹ️", warning: "⚠️" };
  toast.innerHTML = `<span>${icons[type] || "ℹ️"}</span> ${message}`;

  document.body.appendChild(toast);

  // Show
  requestAnimationFrame(() => toast.classList.add("show"));

  // Auto remove
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ===== 登入模態框 =====
function showLoginModal(callback) {
  const overlay = document.createElement("div");
  overlay.className = "zen-modal-overlay";
  overlay.innerHTML = `
        <div class="zen-modal">
            <button class="zen-modal-close">&times;</button>
            <h2>登入 ZenPass</h2>
            
            <!-- Tab Switch -->
            <div class="zen-auth-tabs">
                <button class="zen-auth-tab active" data-tab="login">登入</button>
                <button class="zen-auth-tab" data-tab="register">註冊</button>
            </div>

            <!-- Login Form -->
            <form id="zen-login-form" class="zen-auth-form active">
                <div class="zen-input-group">
                    <label>電郵</label>
                    <input type="email" id="login-email" placeholder="your@email.com" required>
                </div>
                <div class="zen-input-group">
                    <label>密碼</label>
                    <input type="password" id="login-password" placeholder="••••••" required>
                </div>
                <button type="submit" class="zen-btn zen-btn-primary">登入</button>
                <div class="zen-social-login">
                    <p>— 或使用 —</p>
                    <div class="zen-social-btns">
                        <button type="button" class="zen-btn zen-btn-social" data-provider="apple">
                            <svg width="20" height="20" viewBox="0 0 24 24"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" fill="currentColor"/></svg>
                            Apple
                        </button>
                        <button type="button" class="zen-btn zen-btn-social" data-provider="google">
                            <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                            Google
                        </button>
                    </div>
                </div>
                <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--gray-200);">
                    <p style="font-size:12px;color:var(--gray-300);margin-bottom:8px;text-align:center;">⚡ 快速 Demo</p>
                    <div style="display:flex;gap:8px;">
                        <button type="button" class="zen-btn zen-btn-primary" style="flex:1;font-size:13px;padding:10px;" onclick="demoLogin('student')">🎓 學生登入</button>
                        <button type="button" class="zen-btn" style="flex:1;font-size:13px;padding:10px;background:var(--orange-100);color:var(--orange-500);" onclick="demoLogin('coach')">🏋️ 教練登入</button>
                    </div>
                </div>
            </form>

            <!-- Register Form -->
            <form id="zen-register-form" class="zen-auth-form">
                <div class="zen-input-group">
                    <label>姓名</label>
                    <input type="text" id="reg-name" placeholder="你的名字" required>
                </div>
                <div class="zen-input-group">
                    <label>電郵</label>
                    <input type="email" id="reg-email" placeholder="your@email.com" required>
                </div>
                <div class="zen-input-group">
                    <label>密碼</label>
                    <input type="password" id="reg-password" placeholder="至少 6 個字元" required>
                </div>
                <div class="zen-input-group">
                    <label>電話（選填）</label>
                    <input type="tel" id="reg-phone" placeholder="6123 4567">
                </div>
                <button type="submit" class="zen-btn zen-btn-primary">註冊</button>
            </form>
        </div>
    `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("show"));

  const modal = overlay.querySelector(".zen-modal");
  const closeBtn = overlay.querySelector(".zen-modal-close");

  // Close handlers
  const close = () => {
    overlay.classList.remove("show");
    setTimeout(() => overlay.remove(), 300);
  };
  closeBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };

  // Tab switch
  const tabs = overlay.querySelectorAll(".zen-auth-tab");
  tabs.forEach((tab) => {
    tab.onclick = () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      document
        .getElementById("zen-login-form")
        .classList.toggle("active", tab.dataset.tab === "login");
      document
        .getElementById("zen-register-form")
        .classList.toggle("active", tab.dataset.tab === "register");
    };
  });

  // Login
  document.getElementById("zen-login-form").onsubmit = async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "登入中...";

    try {
      const result = await auth.login({
        email: document.getElementById("login-email").value,
        password: document.getElementById("login-password").value,
      });
      setToken(result.token);
      // Ensure role is set
      if (result.user && !result.user.role) {
        result.user.role =
          result.user.email && result.user.email.includes("coach")
            ? "coach"
            : "student";
      }
      storeUser(result.user);
      close();
      showToast("登入成功！", "success");
      if (callback) callback(result.user);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "登入";
    }
  };

  // Register
  document.getElementById("zen-register-form").onsubmit = async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "註冊中...";

    try {
      const result = await auth.register({
        name: document.getElementById("reg-name").value,
        email: document.getElementById("reg-email").value,
        password: document.getElementById("reg-password").value,
        phone: document.getElementById("reg-phone").value || undefined,
      });
      setToken(result.token);
      // New user is always student
      if (result.user) result.user.role = "student";
      storeUser(result.user);
      close();
      showToast("註冊成功！歡迎加入 ZenPass 🎉", "success");
      if (callback) callback(result.user);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "註冊";
    }
  };

  // Social login — Google / Apple
  overlay.querySelectorAll(".zen-btn-social").forEach((btn) => {
    btn.onclick = async function () {
      var provider = this.dataset.provider;
      if (provider === "google") {
        // Trigger Google Sign-In popup via GIS
        if (typeof google !== "undefined" && google.accounts) {
          google.accounts.id.prompt(function (notification) {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
              showToast("Google 登入視窗未能顯示，請檢查瀏覽器設定", "warning");
            }
          });
        } else {
          showToast("Google SDK 尚未載入，請刷新頁面", "info");
        }
      } else if (provider === "apple") {
        showToast("Apple 登入請到 login.html 頁面操作", "info");
      }
    };
  });
}

// ===== 通用格式化工具 =====
function formatDate(dateStr) {
  const d = new Date(dateStr);
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${month}/${day} (${days[d.getDay()]})`;
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function formatPrice(hkd) {
  return `HK$${hkd}`;
}

// ===== 導航欄更新 =====
function updateNavBar() {
  const user = getStoredUser();
  const authBtns = document.querySelectorAll(".zen-auth-buttons");
  const userInfo = document.querySelectorAll(".zen-user-info");

  authBtns.forEach((el) => {
    if (isLoggedIn() && user) {
      var pts = user.points || 0;
      el.innerHTML = `
                <div class="zen-user-badge" onclick="showUserMenu()">
                    <span class="zen-avatar">${user.name.charAt(0)}</span>
                    <span class="zen-user-name">${user.name}</span>
                    <span class="zen-points-badge" style="background:#fff0e8;color:#ff6b35;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;margin-left:6px;white-space:nowrap">🎯 ${pts}</span>
                </div>
            `;
    } else {
      el.innerHTML = `
                <a href="#" class="zen-btn-ghost" onclick="showLoginModal(); return false;">登入</a>
                <a href="#" class="zen-btn-small" onclick="showLoginModal(); return false;">註冊</a>
            `;
    }
  });
}

// ===== 用戶菜單 =====
function showUserMenu() {
  const user = getStoredUser();
  const menu = document.createElement("div");
  menu.className = "zen-user-menu";
  menu.innerHTML = `
        <div class="zen-user-menu-header">
            <span class="zen-avatar lg">${user.name.charAt(0)}</span>
            <div>
                <strong>${user.name}</strong>
                <small>${user.email || ""}</small>
            </div>
        </div>
        <div class="zen-user-menu-items">
            <a href="#" onclick="showMyBookings(); return false;">📅 我的預約</a>
            <a href="#" onclick="showMyMembership(); return false;">💎 我的會籍</a>
            <a href="points.html">🎯 積分中心</a>
            <a href="badges.html">🏅 勳章牆</a>
            <a href="faq.html">❓ 常見問題</a>
            <a href="#" onclick="showMyProfile(); return false;">👤 個人資料</a>
            <hr>
            <a href="#" onclick="logout(); return false;" style="color:#EF4444;">🚪 登出</a>
        </div>
    `;

  document.body.appendChild(menu);
  requestAnimationFrame(() => menu.classList.add("show"));

  const close = (e) => {
    if (!menu.contains(e.target) && !e.target.closest(".zen-user-badge")) {
      menu.remove();
      document.removeEventListener("click", close);
    }
  };
  setTimeout(() => document.addEventListener("click", close), 100);
}

function logout() {
  clearToken();
  showToast("已登出", "info");
  location.reload();
}

// ===== 全局錯誤監控 (Error Monitoring) =====
(function () {
  var errors = [];
  window.onerror = function (msg, url, line, col, err) {
    var e = {
      msg: msg,
      url: url,
      line: line,
      col: col,
      time: new Date().toISOString(),
      page: window.location.pathname,
    };
    errors.push(e);
    if (errors.length > 20) errors.shift();
    console.error("[ZenPass Error]", msg, "at", url, ":" + line);
    // Store in session storage for debugging
    try {
      sessionStorage.setItem(
        "zenpass_errors",
        JSON.stringify(errors.slice(-5)),
      );
    } catch (e) {}
    return false;
  };
  window.addEventListener("unhandledrejection", function (e) {
    console.error("[ZenPass Promise Error]", e.reason);
  });
})();

// ===== Service Worker Registration (PWA) =====
(function () {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function (err) {
      console.log("SW registration skipped:", err.message);
    });
  }
})();

// ===== Push Notification Subscription =====
function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  var token = localStorage.getItem('zenpass_token');
  if (!token) return;

  navigator.serviceWorker.register('/sw.js')
    .then(function(reg) {
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array('BGOuSvnpcbHhzdPBhNlMhk28DpyDzMgkLJMSdPcWhzDk_VoRUMdqhU6BzDktjwX9jyNfGDzHpr13cX8cRciQb08')
      });
    })
    .then(function(sub) {
      return fetch('/api/notifications/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ subscription: sub.toJSON() })
      });
    })
    .catch(function(err) {
      console.log('Push subscription skipped:', err.message);
    });
}

// Convert base64url to Uint8Array (required by pushManager.subscribe)
function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = window.atob(base64);
  var output = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

// Call subscription on page load if logged in
document.addEventListener('DOMContentLoaded', function() {
  if (localStorage.getItem('zenpass_token')) {
    subscribePush();
  }
});

// ===== Google Analytics 4 (pages that include api.js get GA automatically) =====
// Measurement ID: G-MKF5N4YLBM — 由 David Choy 開通
(function () {
  var gaId = "G-MKF5N4YLBM";
  if (
    window.gtag ||
    document.querySelector('script[src*="googletagmanager.com/gtag/js"]')
  )
    return;
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + gaId;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    dataLayer.push(arguments);
  };
  gtag("js", new Date());
  gtag("config", gaId);
})();

// ===== Skeleton Loading System =====
// Tailwind-style pulse skeleton - 輕量、冇 Layout Shift
// 核心原則：數據到就即 replace

(function(){
  var style = document.createElement('style');
  style.textContent = `
    @keyframes sk-shimmer {
      100% { transform: translateX(100%); }
    }
    .sk-shimmer {
      background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
      background-size: 200% 100%;
      animation: sk-shimmer 1.5s infinite;
    }
    .sk-block { background: #e5e7eb; border-radius: 8px; }
    .dark .sk-block { background: #334155; }
    .sk-h-40 { height: 160px; }  .sk-h-32 { height: 128px; }
    .sk-h-24 { height: 96px; }   .sk-h-20 { height: 80px; }
    .sk-h-16 { height: 64px; }   .sk-h-14 { height: 56px; }
    .sk-h-12 { height: 48px; }   .sk-h-10 { height: 40px; }
    .sk-h-8  { height: 32px; }   .sk-h-6  { height: 24px; }
    .sk-h-4  { height: 16px; }   .sk-h-3  { height: 12px; }
    .sk-w-full { width: 100%; }  .sk-w-3\\/4 { width: 75%; }
    .sk-w-1\\/2 { width: 50%; }  .sk-w-1\\/3 { width: 33%; }
    .sk-w-20 { width: 80px; }    .sk-w-16 { width: 64px; }
    .sk-w-12 { width: 48px; }
    .sk-rounded { border-radius: 8px; }
    .sk-mb-2 { margin-bottom: 8px; } .sk-mb-3 { margin-bottom: 12px; }
    .sk-mb-4 { margin-bottom: 16px; }
    .sk-card { background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border: 1px solid rgba(0,0,0,0.04); }
    .sk-card-body { padding: 12px; }
    .sk-flex { display: flex; }  .sk-flex-col { flex-direction: column; }
    .sk-items-center { align-items: center; }
    .sk-gap-2 { gap: 8px; } .sk-gap-3 { gap: 12px; } .sk-gap-4 { gap: 16px; }
    .sk-p-3 { padding: 12px; }  .sk-p-4 { padding: 16px; }
    .sk-flex-shrink-0 { flex-shrink: 0; }
    .sk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
  `;
  document.head.appendChild(style);
})();

/**
 * Show Tailwind-style skeleton loader in a container
 * @param {HTMLElement} container - target element
 * @param {string} type - 'grid'|'featured'|'booking'|'coach'|'activity'|'detail'
 * @param {number} count - number of items (default 3)
 */
function showSkeleton(container, type, count, timeoutSec) {
  if (!container) return;
  count = count || 3;
  timeoutSec = timeoutSec || 15;
  container.setAttribute('aria-busy', 'true');
  var html = '';
  var card, i;

  function line(w, h) {
    return '<div class="sk-block sk-shimmer sk-' + h + ' sk-' + w + ' sk-mb-2" aria-hidden="true"></div>';
  }

  // Timeout fallback
  if (container._skTimeout) clearTimeout(container._skTimeout);
  container._skTimeout = setTimeout(function() {
    if (container.getAttribute('aria-busy') === 'true') {
      showError(container, '載入時間較長', '請檢查網絡連線或重新整理');
      container.setAttribute('aria-busy', 'false');
    }
  }, timeoutSec * 1000);

  switch(type) {
    case 'grid':
    case 'course':
      html = '<div class="sk-grid">';
      for(i = 0; i < count; i++) {
        card = '<div class="sk-card">' +
          '<div class="sk-block sk-shimmer sk-h-32 sk-w-full" aria-hidden="true"></div>' +
          '<div class="sk-card-body">' +
          line('w-3\\/4', 'h-4') +
          line('w-1\\/2', 'h-4') +
          '<div class="sk-flex sk-gap-2" style="margin-top:4px">' +
          '<div class="sk-block sk-shimmer sk-h-4 sk-w-20" aria-hidden="true"></div>' +
          '<div class="sk-block sk-shimmer sk-h-4 sk-w-16" aria-hidden="true"></div>' +
          '</div></div></div>';
        html += card;
      }
      html += '</div>';
      break;
    case 'featured':
      for(i = 0; i < count; i++) {
        html += '<div class="sk-card sk-flex" style="margin-bottom:8px">' +
          '<div class="sk-block sk-shimmer sk-h-20 sk-w-20 sk-flex-shrink-0" style="border-radius:0" aria-hidden="true"></div>' +
          '<div class="sk-p-3 sk-flex-1">' +
          line('w-3\\/4', 'h-4') +
          line('w-1\\/2', 'h-3') +
          line('w-1\\/3', 'h-3') +
          '</div></div>';
      }
      break;
    case 'activity':
      for(i = 0; i < count; i++) {
        html += '<div class="sk-flex sk-items-center sk-gap-3 sk-p-3">' +
          '<div class="sk-block sk-shimmer sk-h-10 sk-w-10 sk-rounded-full sk-flex-shrink-0" aria-hidden="true"></div>' +
          '<div class="sk-flex-1">' +
          line('w-3\\/4', 'h-3') +
          line('w-1\\/2', 'h-3') +
          '</div></div>';
      }
      break;
    case 'coach':
      html = '<div class="sk-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">';
      for(i = 0; i < count; i++) {
        html += '<div class="sk-card sk-p-4 sk-flex sk-flex-col sk-items-center sk-gap-3">' +
          '<div class="sk-block sk-shimmer sk-h-16 sk-w-16 sk-rounded-full" aria-hidden="true"></div>' +
          line('w-3\\/4', 'h-3') +
          line('w-1\\/2', 'h-3') +
          '</div>';
      }
      html += '</div>';
      break;
    case 'booking':
      for(i = 0; i < count; i++) {
        html += '<div class="sk-flex sk-items-center sk-gap-3 sk-p-3 sk-card sk-mb-3">' +
          '<div class="sk-block sk-shimmer sk-h-14 sk-w-14 sk-rounded sk-flex-shrink-0" aria-hidden="true"></div>' +
          '<div class="sk-flex-1">' +
          line('w-3\\/4', 'h-4') +
          line('w-1\\/2', 'h-3') +
          line('w-1\\/3', 'h-3') +
          '</div></div>';
      }
      break;
    case 'detail':
      html = '<div style="max-width:600px;margin:0 auto;padding:16px">' +
        '<div class="sk-block sk-shimmer sk-h-40 sk-w-full sk-mb-4" aria-hidden="true"></div>' +
        line('w-3\\/4', 'h-6') +
        line('w-full', 'h-4') +
        line('w-3\\/4', 'h-4') +
        '<div class="sk-flex sk-gap-3" style="margin-top:12px">' +
        '<div class="sk-block sk-shimmer sk-h-6 sk-w-20" aria-hidden="true"></div>' +
        '<div class="sk-block sk-shimmer sk-h-6 sk-w-16" aria-hidden="true"></div>' +
        '</div></div>';
      break;
  }
  container.innerHTML = html;
}

/** Remove skeleton from container */
function hideSkeleton(container) {
  if (!container) return;
  if (container._skTimeout) clearTimeout(container._skTimeout);
  container.setAttribute('aria-busy', 'false');
  container.innerHTML = '';
}

// ===== Unified Error Display =====
/**
 * Show consistent error message in a container
 * @param {HTMLElement} container - target element
 * @param {string} title - short error title (e.g. '載入失敗')
 * @param {string} msg - detail message
 * @param {function} retryFn - optional retry callback
 */
function showError(container, title, msg, retryFn) {
  if (!container) return;
  hideSkeleton(container);
  var btnHtml = retryFn
    ? '<button onclick="location.reload()" style="margin-top:12px;padding:8px 20px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit">🔄 重試</button>'
    : '<a href="#" onclick="location.reload();return false" style="color:#2563eb;text-decoration:underline;font-size:13px;display:inline-block;margin-top:12px">🔄 重新整理</a>';
  container.innerHTML = '<div style="text-align:center;padding:40px 20px">' +
    '<div style="font-size:40px;margin-bottom:8px">😵</div>' +
    '<div style="font-size:15px;font-weight:600;color:#1a1a2e;margin-bottom:4px">' + escHtml(title) + '</div>' +
    '<div style="font-size:12px;color:#666;margin-bottom:4px;line-height:1.5">' + escHtml(msg) + '</div>' +
    btnHtml +
    '</div>';
}

// ===== Perf: Convert Pexels images to WebP + lazy load =====
function optimizeImages() {
  document.querySelectorAll('img').forEach(function(img) {
    // Pexels to WebP
    if (img.src && img.src.includes('pexels.com') && !img.src.includes('fm=webp')) {
      img.src = img.src.replace('auto=compress', 'auto=compress&fm=webp');
    }
    // Lazy loading (skip first few above-fold images)
    var rect = img.getBoundingClientRect();
    if (rect.top > 600 && !img.hasAttribute('loading')) {
      img.setAttribute('loading', 'lazy');
    }
    // Dimension hints to prevent CLS
    if (!img.hasAttribute('width') && img.naturalWidth) {
      img.setAttribute('width', img.naturalWidth);
      img.setAttribute('height', img.naturalHeight);
    }
  });
  // Also observe new images added dynamically
  if (window.MutationObserver) {
    var observer = new MutationObserver(function(muts) {
      for (var m of muts) {
        for (var n of m.addedNodes) {
          if (n.nodeType === 1 && n.tagName === 'IMG') {
            if (n.src && n.src.includes('pexels.com') && !n.src.includes('fm=webp')) {
              n.src = n.src.replace('auto=compress', 'auto=compress&fm=webp');
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

// ===== Init on load =====
document.addEventListener("DOMContentLoaded", () => {
  updateNavBar();
  optimizeImages();
});
