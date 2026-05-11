/**
 * ZenPass 禪流 - API 服務層
 * 連接前端與後端的橋樑
 */

// ===== Name-keyed Storage Helper =====
function zpKey(baseKey) {
  var name = localStorage.getItem("zenpass_name") || "default";
  return "zp_" + name.replace(/\s/g, "_") + "_" + baseKey;
}

// ===== Auto Demo Login (testing — remove for launch) =====
(function () {
  var name = localStorage.getItem("zenpass_name");
  if (!name) {
    name = "David";
    localStorage.setItem("zenpass_name", name);
  }

  // David = all-access: student + coach + admin
  var isDavid = name === "David" || name === "David Choy" || name === "管理員";
  var role = isDavid ? "admin" : "student";
  if (
    !isDavid &&
    (name.indexOf("教練") > -1 ||
      name.indexOf("導師") > -1 ||
      name.indexOf("coach") > -1 ||
      name.indexOf("Coach") > -1)
  ) {
    role = "coach";
  }

  // Set demo token + user for compatibility
  if (!localStorage.getItem("zenpass_token")) {
    localStorage.setItem("zenpass_token", "demo_token_" + role);
    localStorage.setItem(
      "zenpass_user",
      JSON.stringify({
        name: name,
        email:
          (isDavid ? "david" : name.toLowerCase().replace(/\s/g, "")) +
          "@zenpass.hk",
        phone: "",
        role: role,
        credits: isDavid ? 999 : role === "coach" ? 0 : 45,
        bookings: 0,
        joined: new Date().toISOString().split("T")[0],
        avatar: isDavid ? "👤" : role === "coach" ? "🧘" : "🎓",
        is_all_access: isDavid ? true : false,
      }),
    );
  }
})();

// Auto-detect API base URL
const API_BASE = (() => {
  const host = window.location.hostname;
  const port = window.location.port;

  // If loaded through the backend server (localhost:3001), use same origin
  if (port === "3001" || host === "localhost") {
    return "/api";
  }
  // GitHub Pages or other static hosting — points to local backend
  // (for testing, user needs to have backend running on localhost:3001)
  return "http://localhost:3001/api";
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
          { category: "瑜伽", count: 3 },
          { category: "健身", count: 2 },
          { category: "冥想", count: 1 },
          { category: "伸展", count: 1 },
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
  packages: () => apiRequest("GET", "/memberships/credits/packages"),
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

  // Social login placeholder
  overlay.querySelectorAll(".zen-btn-social").forEach((btn) => {
    btn.onclick = () => {
      showToast(
        `${btn.dataset.provider === "apple" ? "Apple" : "Google"} 登入將在正式部署後啟用`,
        "info",
      );
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
      el.innerHTML = `
                <div class="zen-user-badge" onclick="showUserMenu()">
                    <span class="zen-avatar">${user.name.charAt(0)}</span>
                    <span class="zen-user-name">${user.name}</span>
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

// ===== Init on load =====
document.addEventListener("DOMContentLoaded", () => {
  updateNavBar();
});
