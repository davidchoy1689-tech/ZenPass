/* ZenPass — 角色分流（單一來源）
 *
 * 角色 → 首頁：
 *   super_admin / platform_manager / platform_staff / admin / auditor → admin.html
 *   partner_owner / partner_admin / partner_staff                      → venue-dashboard.html
 *   coach                                                              → coach-hub.html
 *   user                                                               → my.html
 *   guest（未登入）                                                     → index.html
 *
 * 用法（頁面最頂，api.js 之後）：
 *   ZPRoles.guardPage("coach");   // 只准教練＋平台職員
 *   ZPRoles.guardPage("venue");   // 只准場地商戶＋平台職員
 *   ZPRoles.guardPage("staff");   // 只准平台職員
 *
 * 元素層面：
 *   <a data-only-role="coach,super_admin">…</a>   → 其他人自動隱藏
 */
(function () {
  var STAFF = ["super_admin", "platform_manager", "platform_staff", "admin", "auditor"];
  var VENUE = ["partner_owner", "partner_admin", "partner_staff"];
  var COACH = ["coach"].concat(STAFF);

  var HOME = {
    super_admin: "admin.html",
    platform_manager: "admin.html",
    platform_staff: "admin.html",
    admin: "admin.html",
    auditor: "admin.html",
    partner_owner: "venue-dashboard.html",
    partner_admin: "venue-dashboard.html",
    partner_staff: "venue-reception.html",
    coach: "coach-hub.html",
    user: "my.html",
    guest: "index.html",
  };

  function user() {
    try { return JSON.parse(localStorage.getItem("zenpass_user") || "null"); } catch (e) { return null; }
  }
  function role() {
    var u = user();
    if (!u || !u.id) return "guest";
    return String(u.role || "user");
  }
  function isLoggedIn() { return role() !== "guest"; }
  function homeFor(r) { return HOME[r] || "index.html"; }
  function inList(list) { return list.indexOf(role()) >= 0; }
  function isCoach() { return inList(COACH); }
  function isVenue() { return inList(VENUE.concat(STAFF)); }
  function isStaff() { return inList(STAFF); }

  function loginUrl(next) {
    return "login.html?next=" + encodeURIComponent(next || location.pathname.split("/").pop() + location.search);
  }

  function denied(kind) {
    var label = kind === "coach" ? "教練" : kind === "venue" ? "場地商戶" : "平台職員";
    var apply = kind === "coach" ? '<a class="btn btn-secondary" href="coach-apply.html">✍️ 申請成為教練</a>' : "";
    var html =
      '<div id="zpRoleDenied" style="position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;' +
      'background:radial-gradient(900px 500px at 20% -10%,#0f2e25 0%,#0b1220 60%,#080d18 100%);color:#e6edf5;font-family:system-ui,-apple-system,\'PingFang HK\',sans-serif">' +
      '<div style="max-width:360px;width:100%;text-align:center;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:24px 20px">' +
      '<div style="font-size:34px">🔒</div>' +
      '<b style="display:block;font-size:17px;margin-top:8px">此頁只供' + label + '使用</b>' +
      '<div style="font-size:13px;color:#8aa0b8;line-height:1.7;margin-top:8px">你而家嘅身份：' + roleLabel() + "</div>" +
      '<div style="display:grid;gap:9px;margin-top:16px">' +
      '<a class="btn btn-primary" style="display:block;padding:12px;border-radius:12px;text-decoration:none;background:linear-gradient(135deg,#34d399,#10b981);color:#04140f;font-weight:800" href="' + homeFor(role()) + '">去我嘅主頁</a>' +
      apply +
      '<a style="display:block;padding:10px;color:#8aa0b8;font-size:12.5px;text-decoration:none" href="#" onclick="api.logout();return false">登出</a>' +
      "</div></div></div>";
    document.documentElement.innerHTML = "<body>" + html + "</body>";
  }

  function roleLabel() {
    var r = role();
    return (
      {
        super_admin: "超級管理員",
        platform_manager: "平台經理",
        platform_staff: "平台職員",
        admin: "管理員（客服）",
        auditor: "核數",
        partner_owner: "場地負責人",
        partner_admin: "場地管理",
        partner_staff: "場地前台",
        coach: "教練",
        user: "學員",
        guest: "遊客（未登入）",
      }[r] || r
    );
  }

  /** 檢查頁面權限；唔通過會顯示提示或跳登入，回傳 false */
  function guardPage(kind) {
    var r = role();
    if (r === "guest") {
      location.replace(loginUrl());
      return false;
    }
    var allowed = kind === "coach" ? COACH : kind === "venue" ? VENUE.concat(STAFF) : kind === "staff" ? STAFF : null;
    if (allowed && allowed.indexOf(r) < 0) {
      denied(kind);
      return false;
    }
    return true;
  }

  /** 依 data-only-role 隱藏元素（逗號分隔多個角色） */
  function applyNav(root) {
    var r = role();
    (root || document).querySelectorAll("[data-only-role]").forEach(function (el) {
      var list = String(el.getAttribute("data-only-role") || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      if (!list.length) return;
      var show = list.indexOf(r) >= 0 || (list.indexOf("staff") >= 0 && STAFF.indexOf(r) >= 0) || (list.indexOf("member") >= 0 && r !== "guest");
      el.style.display = show ? "" : "none";
      el.setAttribute("aria-hidden", show ? "false" : "true");
    });
  }

  window.ZPRoles = {
    STAFF: STAFF, VENUE: VENUE, COACH: COACH,
    role: role, user: user, isLoggedIn: isLoggedIn,
    homeFor: homeFor, roleLabel: roleLabel,
    isCoach: isCoach, isVenue: isVenue, isStaff: isStaff,
    guardPage: guardPage, applyNav: applyNav, loginUrl: loginUrl,
  };

  document.addEventListener("DOMContentLoaded", function () { try { applyNav(); } catch (e) {} });
})();
