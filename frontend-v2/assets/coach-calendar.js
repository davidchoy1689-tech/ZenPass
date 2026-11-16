/**
 * coach-calendar.js — 教練排班大月曆（2026-11-17）
 *
 * 用法：
 *   const cal = CoachCalendar.mount("#calRoot", {
 *     events: [{ id, date: "2026-11-17" | starts_at, title, time, booked, capacity, venue_name, status }],
 *     onSelectDate(iso) {},
 *     onAdd(iso) {},
 *     onOpenSession(sessionEvent) {},
 *   });
 *   cal.setEvents(list); cal.goto(2026, 10 /* 0-11 *\/); cal.select("2026-11-19");
 *
 * 特點：6 行 42 格、跨月淡出、今日／選中高亮、有班日顯示小點（桌面顯示課堂 chip）、
 *      下方當日時段列表 + 「呢日開班」。
 */
(function (global) {
  var DOW = ["日", "一", "二", "三", "四", "五", "六"];

  function pad(n) { return String(n).padStart(2, "0"); }
  function toISO(y, mIdx, d) { return y + "-" + pad(mIdx + 1) + "-" + pad(d); }
  function parseISO(iso) {
    var p = String(iso || "").split("-").map(Number);
    return { y: p[0] || 1970, m: (p[1] || 1) - 1, d: p[2] || 1 };
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /** 由 starts_at / date 取 ISO 日期（本地時間） */
  function isoOf(ev) {
    if (!ev) return "";
    if (ev.date && /^\d{4}-\d{2}-\d{2}$/.test(String(ev.date))) return String(ev.date);
    var raw = ev.starts_at || ev.start_time || "";
    var d = new Date(String(raw).replace(" ", "T"));
    if (isNaN(d)) return "";
    return toISO(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function hmOf(ev) {
    if (ev && ev.time) return String(ev.time).slice(0, 5);
    var d = new Date(String((ev && (ev.starts_at || ev.start_time)) || "").replace(" ", "T"));
    return isNaN(d) ? "" : pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function mount(rootSel, options) {
    options = options || {};
    var root = typeof rootSel === "string" ? document.querySelector(rootSel) : rootSel;
    if (!root) throw new Error("CoachCalendar: root not found");

    var now = new Date();
    var state = {
      y: options.year || now.getFullYear(),
      m: options.month != null ? Number(options.month) : now.getMonth(), // 0-11
      selected: options.selected || toISO(now.getFullYear(), now.getMonth(), now.getDate()),
      events: options.events || [],
    };
    var cbs = {
      onSelectDate: options.onSelectDate || function () {},
      onAdd: options.onAdd || function () {},
      onOpenSession: options.onOpenSession || function () {},
      onReschedule: options.onReschedule || null,
      canDrop: options.canDrop || function () { return true; },
    };

    root.classList.add("cal-app");
    root.innerHTML =
      '<div class="cal-header">' +
        '<button class="cal-nav" data-act="prev" type="button" aria-label="上個月">‹</button>' +
        '<div class="cal-title" data-el="title">—</div>' +
        '<button class="cal-nav" data-act="next" type="button" aria-label="下個月">›</button>' +
        '<button class="cal-today-btn" data-act="today" type="button">今日</button>' +
      "</div>" +
      '<div class="cal-dows" data-el="dows"></div>' +
      '<div class="cal-grid" data-el="grid"></div>' +
      '<div class="cal-legend"><span><i style="background:#059669"></i>已開班</span>' +
        '<span><i style="background:#ff6b35"></i>報名中</span><span><i style="background:#94a3b8"></i>已取消</span></div>' +
      '<div class="cal-day-panel">' +
        '<div class="cal-day-head">' +
          '<div><h3 data-el="dayTitle">—</h3><div class="muted" data-el="daySub"></div></div>' +
          '<button class="cal-add" data-act="add" type="button">＋ 呢日開班</button>' +
        "</div>" +
        '<div data-el="list"></div>' +
      "</div>";

    var q = function (name) { return root.querySelector('[data-el="' + name + '"]'); };
    q("dows").innerHTML = DOW.map(function (d, i) {
      return '<div class="cal-dow' + (i === 0 ? " sun" : i === 6 ? " sat" : "") + '">' + d + "</div>";
    }).join("");

    function eventsOn(iso) {
      return state.events.filter(function (ev) { return isoOf(ev) === iso; });
    }

    function isFull(ev) {
      var b = Number(ev.booked || 0), c = Number(ev.capacity || ev.max_participants || 0);
      return c > 0 && b >= c;
    }

    function render() {
      q("title").textContent = state.y + " 年 " + (state.m + 1) + " 月";
      var first = new Date(state.y, state.m, 1);
      var start = new Date(state.y, state.m, 1 - first.getDay());
      var todayISO = toISO(now.getFullYear(), now.getMonth(), now.getDate());
      var html = "";

      for (var i = 0; i < 42; i++) {
        var dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        var y = dt.getFullYear(), m = dt.getMonth(), d = dt.getDate();
        var iso = toISO(y, m, d);
        var out = m !== state.m;
        var dow = dt.getDay();
        var list = eventsOn(iso);
        var cls = ["cal-cell"];
        if (out) cls.push("out");
        if (iso === todayISO) cls.push("today");
        if (iso === state.selected) cls.push("selected");
        if (list.length) cls.push("has");
        if (dow === 0) cls.push("sun");
        if (dow === 6) cls.push("sat");

        var dots = list.slice(0, 3).map(function (ev) {
          var c = ev.status === "cancelled" ? "muted" : isFull(ev) || (Number(ev.booked || 0) >= Number(ev.min_participants || 1)) ? "" : "warn";
          return '<i class="cal-dot ' + c + '"></i>';
        }).join("");

        var chips = list.slice(0, 2).map(function (ev) {
          return '<span class="cal-chip">' + esc(hmOf(ev) + " " + (ev.title || "")) + "</span>";
        }).join("");

        html += '<div class="' + cls.join(" ") + '" data-iso="' + iso + '" data-out="' + (out ? "1" : "0") + '">' +
          '<div class="cal-daynum">' + d + "</div>" +
          (dots ? '<div class="cal-dots">' + dots + "</div>" : "") +
          chips +
          "</div>";
      }
      q("grid").innerHTML = html;

      // 當日面板
      var sp = parseISO(state.selected);
      var wd = ["日", "一", "二", "三", "四", "五", "六"][new Date(sp.y, sp.m, sp.d).getDay()];
      q("dayTitle").textContent = (sp.m + 1) + " 月 " + sp.d + " 日（" + wd + "）";
      var dayList = eventsOn(state.selected);
      q("daySub").textContent = dayList.length ? dayList.length + " 個時段" : "未有課堂";

      var listEl = q("list");
      if (!dayList.length) {
        listEl.innerHTML = '<div class="cal-empty-day">呢日未開班<br>撳右上「＋ 呢日開班」加時段</div>';
      } else {
        if (cbs.onReschedule) {
          listEl.innerHTML = '<div class="cal-dnd-hint">↕️ 按住課堂卡拖去其他日子即可改期</div>';
        }
        listEl.insertAdjacentHTML("beforeend", dayList.map(function (ev) {
          var cancelled = ev.status === "cancelled";
          var b = Number(ev.booked || 0), c = Number(ev.capacity || ev.max_participants || 0);
          return '<div class="cal-session" data-session-id="' + esc(ev.id || "") + '">' +
            '<div style="min-width:0">' +
              '<div class="t">' + esc(ev.title || "課堂") + (cancelled ? "（已取消）" : "") + "</div>" +
              '<div class="m">🕒 ' + esc(hmOf(ev)) + " · 👥 " + b + "/" + (c || "—") +
                (ev.venue_name ? "<br>📍 " + esc(ev.venue_name) : "") + "</div>" +
              (cbs.onReschedule ? '<div class="grab-hint">⠿ 拖去其他日子改期</div>' : "") +
            "</div>" +
            '<div class="cal-session-actions">' +
              '<button class="primary" data-open-session="' + esc(ev.id || "") + '" type="button">管理</button>' +
            "</div>" +
          "</div>";
        }).join(""));
        bindDragHandles(listEl, dayList);
      }
    }


    /* ── 拖放改期 ───────────────────────────────────── */
    var drag = null;
    var busy = false;

    function clearDropTargets() {
      Array.prototype.forEach.call(root.querySelectorAll(".cal-cell.drop-target,.cal-cell.drop-invalid"), function (c) {
        c.classList.remove("drop-target", "drop-invalid");
      });
    }
    function cellFromPoint(x, y) {
      var node = document.elementFromPoint(x, y);
      return node && node.closest ? node.closest(".cal-cell[data-iso]") : null;
    }
    function endDrag(commit) {
      if (!drag) return;
      var d = drag;
      drag = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      clearDropTargets();
      if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
      if (d.el) d.el.classList.remove("dragging");
      if (!commit || !d.dropIso || d.dropIso === d.fromIso) return;
      if (!cbs.canDrop(d.session, d.dropIso)) { alert("呢日唔可以改期（已過或不可用）。"); return; }
      var label = String(d.session.title || "課堂");
      var t = hmOf(d.session) || "";
      // 系列課堂：由 onReschedule 彈範圍選擇（本身就係確認），唔重複問兩次
      if (!d.session.series_id) {
        if (!window.confirm("將「" + label + "」改去 " + d.dropIso + (t ? "（時間維持 " + t + "）" : "") + "？")) return;
      }
      doReschedule(d.session, d.dropIso);
    }
    function doReschedule(session, newDate) {
      if (busy) return;
      busy = true;
      Promise.resolve()
        .then(function () { return cbs.onReschedule(session, newDate); })
        .then(function () {
          state.events = state.events.map(function (ev) {
            return String(ev.id) === String(session.id) ? Object.assign({}, ev, { date: newDate }) : ev;
          });
          state.selected = newDate;
          var p = parseISO(newDate);
          state.y = p.y; state.m = p.m;
          render();
        })
        .catch(function (e) { alert((e && e.message) || "改期失敗"); render(); })
        .then(function () { busy = false; });
    }
    function onMove(e) {
      if (!drag) return;
      if (!drag.active) {
        if (Math.abs(e.clientX - drag.x) < 8 && Math.abs(e.clientY - drag.y) < 8) return;
        drag.active = true;
        if (drag.el) drag.el.classList.add("dragging");
        var g = document.createElement("div");
        g.className = "cal-drag-ghost";
        g.textContent = (hmOf(drag.session) ? hmOf(drag.session) + " " : "") + (drag.session.title || "課堂");
        document.body.appendChild(g);
        drag.ghost = g;
      }
      if (drag.ghost) { drag.ghost.style.left = e.clientX + "px"; drag.ghost.style.top = e.clientY + "px"; }
      clearDropTargets();
      var cell = cellFromPoint(e.clientX, e.clientY);
      if (!cell) { drag.dropIso = null; return; }
      var iso = cell.getAttribute("data-iso");
      drag.dropIso = iso;
      var ok = iso !== drag.fromIso && cbs.canDrop(drag.session, iso);
      cell.classList.add(ok ? "drop-target" : "drop-invalid");
    }
    function onUp() { endDrag(true); }

    function bindDragHandles(listEl, dayList) {
      if (!cbs.onReschedule) return;
      Array.prototype.forEach.call(listEl.querySelectorAll(".cal-session[data-session-id]"), function (node) {
        var id = node.getAttribute("data-session-id");
        var session = null;
        for (var i = 0; i < dayList.length; i++) if (String(dayList[i].id) === String(id)) { session = dayList[i]; break; }
        if (!session) return;
        node.addEventListener("pointerdown", function (e) {
          if (e.target.closest("[data-open-session]")) return;
          if (e.button != null && e.button !== 0) return;
          var fromIso = isoOf(session) || state.selected;
          drag = { session: session, el: node, fromIso: fromIso, dropIso: null, x: e.clientX, y: e.clientY, active: false, ghost: null };
          document.addEventListener("pointermove", onMove);
          document.addEventListener("pointerup", onUp);
          document.addEventListener("pointercancel", onUp);
        });
      });
    }

    root.addEventListener("click", function (e) {
      if (drag) return;
      var t = e.target;
      var act = t.closest("[data-act]");
      if (act) {
        var a = act.getAttribute("data-act");
        if (a === "prev") {
          state.m -= 1;
          if (state.m < 0) { state.m = 11; state.y -= 1; }
          render();
        } else if (a === "next") {
          state.m += 1;
          if (state.m > 11) { state.m = 0; state.y += 1; }
          render();
        } else if (a === "today") {
          var n = new Date();
          state.y = n.getFullYear(); state.m = n.getMonth();
          state.selected = toISO(state.y, state.m, n.getDate());
          render();
          cbs.onSelectDate(state.selected);
        } else if (a === "add") {
          cbs.onAdd(state.selected);
        }
        return;
      }

      var cell = t.closest(".cal-cell[data-iso]");
      if (cell) {
        state.selected = cell.getAttribute("data-iso");
        if (cell.getAttribute("data-out") === "1") {
          var p = parseISO(state.selected);
          state.y = p.y; state.m = p.m;
        }
        render();
        cbs.onSelectDate(state.selected);
        return;
      }

      var open = t.closest("[data-open-session]");
      if (open) {
        var id = open.getAttribute("data-open-session");
        var ev = state.events.filter(function (x) { return String(x.id) === String(id); })[0];
        if (ev) cbs.onOpenSession(ev);
      }
    });

    render();
    return {
      setEvents: function (list) { state.events = list || []; render(); },
      goto: function (y, m) { state.y = y; state.m = m; render(); },
      select: function (iso) {
        state.selected = iso;
        var p = parseISO(iso); state.y = p.y; state.m = p.m;
        render();
      },
      getSelected: function () { return state.selected; },
      refresh: render,
      root: root,
    };
  }

  global.CoachCalendar = { mount: mount, toISO: toISO, isoOf: isoOf };
})(window);
