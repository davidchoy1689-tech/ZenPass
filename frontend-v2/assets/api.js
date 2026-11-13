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
    const idem = method !== "GET" ? uuid() : null;
    const csrfToken = method !== "GET" ? await csrf() : null;
    async function attempt(useToken) {
      const headers = {};
      if (useToken) {
        const t = getToken();
        if (t) headers["Authorization"] = "Bearer " + t;
      }
      if (method !== "GET") {
        headers["Content-Type"] = "application/json";
        headers["Idempotency-Key"] = idem;
        headers["x-csrf-token"] = csrfToken;
      }
      try {
        const res = await fetch(API_BASE + path, {
          method, headers, credentials: "include",
          body: body != null ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => null);
        return { res, data };
      } catch (e) {
        return { res: { ok: false, status: 0 }, data: { error: "網絡錯誤，請重試" } };
      }
    }
    let out = await attempt(true);
    // 舊／失效 localStorage token：清走，改用 HTTP-only cookie 重試一次（同一 Idempotency-Key）
    const authErr = out.data && (out.data.error === "認證無效或已過期" || out.data.error === "需要登入認證");
    if (authErr && getToken()) {
      try { localStorage.removeItem("zenpass_token"); localStorage.removeItem("zenpass_user"); } catch (e) {}
      out = await attempt(false);
    }
    return { ok: out.res.ok, status: out.res.status, data: out.data };
  }

  const api = {
    get: (p) => req("GET", p),
    post: (p, b) => req("POST", p, b),
    put: (p, b) => req("PUT", p, b),
    patch: (p, b) => req("PATCH", p, b),
    del: (p, b) => req("DELETE", p, b),
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
  window.cr = (hkd) => (hkd == null ? "" : String(Math.round((Number(hkd) / 10) * 10) / 10)); // price_hkd → credits（$95→9.5cr，保留 1 位小數）
  window.hkd = (n) => (n == null ? "" : "HK$" + Number(n).toLocaleString());
  // ── 時間正規化（2026-11-13 統一）────────────────────────────────
  // DB 內有兩種格式：帶 Z（UTC）同無時區（舊資料）。無時區一律當 UTC，
  // 再用 Asia/Hong_Kong 輸出，避免「10:30 顯示成 02:30」。
  window.zpParseTime = (s) => {
    if (s == null || s === "") return null;
    let t = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(t)) t = t.replace(" ", "T");
    if (!/Z|[+-]\d{2}:?\d{2}$/.test(t)) t += "Z";
    const d = new Date(t);
    return isNaN(d) ? null : d;
  };
  const _zpMD = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", month: "2-digit", day: "2-digit" });
  const _zpHM = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hour12: false });
  window.zpTime = (s, e) => {
    const d = window.zpParseTime(s);
    if (!d) return s == null ? "" : String(s);
    const p = {};
    for (const x of _zpMD.formatToParts(d)) p[x.type] = x.value;
    let out = `${p.month}/${p.day} ${_zpHM.format(d)}`;
    const d2 = window.zpParseTime(e);
    if (d2) out += `–${_zpHM.format(d2)}`;
    return out;
  };
  // 短格式（週X M/D HH:MM–HH:MM），有 end 就自動顯示完堂時間
  window.fmtTime = (s, e) => {
    if (!s) return "";
    const d = new Date(String(s).replace(" ", "T"));
    if (isNaN(d)) return s;
    const wd = ["日","一","二","三","四","五","六"][d.getDay()];
    const p = (n) => String(n).padStart(2, "0");
    let out = `週${wd} ${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    if (e) {
      const d2 = new Date(String(e).replace(" ", "T"));
      if (!isNaN(d2)) out += `–${p(d2.getHours())}:${p(d2.getMinutes())}`;
    }
    return out;
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
