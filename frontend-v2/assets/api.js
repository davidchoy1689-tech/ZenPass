/* ZenPass v2 — API client
 * - same-origin /api, JWT (cookie + Bearer), CSRF double-submit, Idempotency-Key
 * - responses are {success:true, ...originalKeys} (see backend response-normalizer)
 */
(function () {
  const API_BASE = "/api";
  let _csrf = null;

  function getToken() { return localStorage.getItem("zenpass_token") || ""; }
  function setToken(t) { if (t) localStorage.setItem("zenpass_token", t); }
  function getUser() { try { return JSON.parse(localStorage.getItem("zenpass_user") || "null"); } catch (e) { return null; } }
  function setUser(u) { if (u) localStorage.setItem("zenpass_user", JSON.stringify(u)); }
  function logout() { localStorage.removeItem("zenpass_token"); localStorage.removeItem("zenpass_user"); location.href = "index.html"; }
  function uuid() { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : ("id-" + Date.now() + "-" + Math.random().toString(16).slice(2)); }

  async function csrf() {
    if (_csrf) return _csrf;
    try {
      const r = await fetch(API_BASE + "/csrf-token", { credentials: "include" });
      const j = await r.json();
      _csrf = j.token || "";
    } catch (e) { _csrf = ""; }
    return _csrf;
  }

  async function req(method, path, body) {
    const headers = {};
    const t = getToken();
    if (t) headers["Authorization"] = "Bearer " + t;
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
      headers["Idempotency-Key"] = uuid();
      headers["x-csrf-token"] = await csrf();
    }
    let res, data = null;
    try {
      res = await fetch(API_BASE + path, {
        method, headers, credentials: "include",
        body: body != null ? JSON.stringify(body) : undefined,
      });
      data = await res.json().catch(() => null);
    } catch (e) {
      return { ok: false, status: 0, data: { error: "網絡錯誤，請重試" } };
    }
    return { ok: res.ok, status: res.status, data };
  }

  const api = {
    get: (p) => req("GET", p),
    post: (p, b) => req("POST", p, b),
    put: (p, b) => req("PUT", p, b),
    me: () => req("GET", "/users/me"),
    login: async (email, password) => {
      const r = await req("POST", "/auth/login", { email, password });
      // login 係 public path，唔需要 CSRF；但 req() 會照攞，無害
      if (r.ok && r.data) {
        if (r.data.token) setToken(r.data.token);
        if (r.data.user) setUser(r.data.user);
      }
      return r;
    },
    logout,
    getToken, setToken, getUser, setUser,
    isLoggedIn: () => !!getToken(),
    // 需要登入先做 -> 未登入跳去 login
    requireLogin: (next) => {
      if (!api.isLoggedIn()) { location.href = "login.html?next=" + encodeURIComponent(next || "my.html"); return false; }
      return true;
    },
  };

  // helpers
  window.api = api;
  window.esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  window.cr = (hkd) => (hkd == null ? "" : Math.round(Number(hkd) / 10)); // price_hkd → credits
  window.hkd = (n) => (n == null ? "" : "HK$" + Number(n).toLocaleString());
  window.fmtTime = (s) => {
    if (!s) return "";
    const d = new Date(s.replace(" ", "T"));
    if (isNaN(d)) return s;
    const wd = ["日","一","二","三","四","五","六"][d.getDay()];
    const p = (n) => String(n).padStart(2, "0");
    return `週${wd} ${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  // 完整日期（年月日）+ 時間，例：2026年10月20日（週二）19:00–20:00
  window.fmtDateTime = (s, e) => {
    if (!s) return "";
    const d = new Date(String(s).replace(" ", "T"));
    if (isNaN(d)) return s;
    const wd = ["日","一","二","三","四","五","六"][d.getDay()];
    const p = (n) => String(n).padStart(2, "0");
    let out = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（週${wd}） ${p(d.getHours())}:${p(d.getMinutes())}`;
    if (e) {
      const d2 = new Date(String(e).replace(" ", "T"));
      if (!isNaN(d2)) out += `–${p(d2.getHours())}:${p(d2.getMinutes())}`;
    }
    return out;
  };
})();
