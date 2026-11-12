/**
 * ZenPass — 共用 Filter Store（vanilla JS 版，對應 2026-11-13 spec 的 TS reducer）
 *
 * 為何唔直接用 TS：frontend-v2 係純靜態 HTML，冇 build step（無 TypeScript／React）。
 * 所以呢個檔案係 spec 嘅 1:1 移植：純 reducer + 純 derived helpers，行為完全一致。
 *
 * 鍵值沿用現有 UI（zone／date／cats），避免兩套命名要互相 mapping 造成 bug：
 *   region  → 現有 'region'（'' = 全港）
 *   zone    → 單一選區（spec 嘅 districts[] 只有一個元素）
 *   date    → spec 嘅 time
 *   cats    → spec 嘅 activities
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZPFilterStore = api;
})(typeof window !== "undefined" ? window : null, function () {
  var DEFAULT_STATE = {
    region: "",
    zone: "",
    date: "",
    cats: [],
    onlyAvailable: false,
    newUserOffer: false,
    familyFriendly: false,
    seniorFriendly: false,
    isDirty: false,
    resultCount: null,
    isLoadingCount: false,
  };

  function clone(state) {
    return {
      region: state.region || "",
      zone: state.zone || "",
      date: state.date || "",
      cats: (state.cats || []).slice(),
      onlyAvailable: !!state.onlyAvailable,
      newUserOffer: !!state.newUserOffer,
      familyFriendly: !!state.familyFriendly,
      seniorFriendly: !!state.seniorFriendly,
      isDirty: !!state.isDirty,
      resultCount: state.resultCount == null ? null : state.resultCount,
      isLoadingCount: !!state.isLoadingCount,
    };
  }

  function createInitialStore() {
    return { draft: clone(DEFAULT_STATE), applied: clone(DEFAULT_STATE) };
  }

  function markDirty(state) {
    var n = clone(state);
    n.isDirty = true;
    return n;
  }

  function toggle(list, item) {
    var i = list.indexOf(item);
    if (i >= 0) {
      var copy = list.slice();
      copy.splice(i, 1);
      return copy;
    }
    return list.concat([item]);
  }

  function reducer(store, action) {
    var draft = store.draft;
    var applied = store.applied;
    switch (action.type) {
      case "OPEN_PANEL":
        return { draft: clone(applied), applied: applied };

      case "PATCH": {
        // UI adapter：一次過改多個欄位（例如清 zone 同時清 region）
        var p = clone(draft);
        var src = action.state || {};
        Object.keys(src).forEach(function (k) {
          if (k === "cats") p.cats = (src.cats || []).slice();
          else if (k in p) p[k] = src[k];
        });
        return { applied: applied, draft: markDirty(p) };
      }

      case "SET_REGION": {
        var region = action.region || "";
        return {
          applied: applied,
          draft: markDirty({
            region: region,
            zone: region ? draft.zone : "",
            date: draft.date,
            cats: draft.cats,
            onlyAvailable: draft.onlyAvailable,
            newUserOffer: draft.newUserOffer,
            familyFriendly: draft.familyFriendly,
            seniorFriendly: draft.seniorFriendly,
            resultCount: draft.resultCount,
            isLoadingCount: draft.isLoadingCount,
          }),
        };
      }

      case "SET_ZONE": {
        var zone = action.zone || "";
        var next = clone(draft);
        next.zone = zone;
        if (zone && !next.region) next.region = draft.region || "";
        return { applied: applied, draft: markDirty(next) };
      }

      case "SET_TIME": {
        var nt = clone(draft);
        nt.date = action.time || "";
        return { applied: applied, draft: markDirty(nt) };
      }

      case "TOGGLE_ACTIVITY": {
        var na = clone(draft);
        na.cats = toggle(draft.cats || [], action.activityId);
        return { applied: applied, draft: markDirty(na) };
      }

      case "SET_ACTIVITY_ALL": {
        var all = clone(draft);
        all.cats = [];
        return { applied: applied, draft: markDirty(all) };
      }

      case "TOGGLE_ADVANCED": {
        var adv = clone(draft);
        adv[action.key] = !adv[action.key];
        return { applied: applied, draft: markDirty(adv) };
      }

      case "REMOVE_CHIP": {
        var c = clone(draft);
        var chip = action.chip || {};
        if (chip.type === "region") { c.region = ""; c.zone = ""; }
        else if (chip.type === "district") c.zone = "";
        else if (chip.type === "time") c.date = "";
        else if (chip.type === "activity") c.cats = (c.cats || []).filter(function (x) { return x !== chip.value; });
        else if (chip.type === "advanced" && chip.key) c[chip.key] = false;
        return { applied: applied, draft: markDirty(c) };
      }

      case "RESET": {
        var r = clone(DEFAULT_STATE);
        r.resultCount = draft.resultCount;
        r.isDirty = true;
        return { applied: applied, draft: r };
      }

      case "APPLY": {
        var committed = clone(draft);
        committed.isDirty = false;
        return { draft: committed, applied: committed };
      }

      case "DISCARD_DRAFT":
        return { draft: clone(applied), applied: applied };

      case "SET_RESULT_COUNT": {
        var sc = clone(draft);
        sc.resultCount = action.count;
        sc.isLoadingCount = false;
        return { applied: applied, draft: sc };
      }

      case "SET_LOADING_COUNT": {
        var sl = clone(draft);
        sl.isLoadingCount = !!action.loading;
        return { applied: applied, draft: sl };
      }

      case "HYDRATE": {
        var h = clone(DEFAULT_STATE);
        var src = action.state || {};
        Object.keys(src).forEach(function (k) {
          if (k === "cats") h.cats = (src.cats || []).slice();
          else if (k in h) h[k] = src[k];
        });
        h.isDirty = false;
        return { draft: h, applied: h };
      }

      default:
        return store;
    }
  }

  // ---------- derived ----------
  function hasActiveFilters(s) {
    return !!(s.region || s.zone || s.date || (s.cats && s.cats.length) ||
      s.onlyAvailable || s.newUserOffer || s.familyFriendly || s.seniorFriendly);
  }

  function isAllActivities(s) {
    return !(s.cats && s.cats.length);
  }

  function labelOf(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].k === key) return list[i].l;
    return "";
  }

  /**
   * @param {object} state
   * @param {{regions:Array,districts:Array,times:Array}} dict
   */
  function getSummaryText(state, dict) {
    var d = dict || {};
    var zone = state.zone ? labelOf(d.districts || [], state.zone) : "";
    var region = zone || (state.region ? labelOf(d.regions || [], state.region) : "");
    var time = labelOf(d.times || [], state.date) || "任何時段";
    var acts = (state.cats || []).length ? state.cats.join("／") : "全部運動";
    return [region || "全港", time, acts].join(" · ");
  }

  function getActiveChips(state, dict) {
    var d = dict || {};
    var chips = [];
    if (state.zone) chips.push({ type: "district", value: state.zone, label: "📍 " + (labelOf(d.districts || [], state.zone) || state.zone) });
    else if (state.region) chips.push({ type: "region", value: state.region, label: "📍 " + (labelOf(d.regions || [], state.region) || state.region) });
    if (state.date) chips.push({ type: "time", value: state.date, label: labelOf(d.times || [], state.date) || state.date });
    (state.cats || []).forEach(function (c) { chips.push({ type: "activity", value: c, label: c }); });
    if (state.onlyAvailable) chips.push({ type: "advanced", key: "onlyAvailable", label: "只顯示有位" });
    if (state.newUserOffer) chips.push({ type: "advanced", key: "newUserOffer", label: "新客優惠" });
    if (state.familyFriendly) chips.push({ type: "advanced", key: "familyFriendly", label: "親子友善" });
    if (state.seniorFriendly) chips.push({ type: "advanced", key: "seniorFriendly", label: "樂齡友善" });
    return chips;
  }

  // ---------- URL / storage ----------
  function toQuery(state) {
    var p = [];
    if (state.zone) p.push("zone=" + encodeURIComponent(state.zone));
    if (state.date) p.push("date=" + encodeURIComponent(state.date));
    if (state.cats && state.cats.length) p.push("cats=" + encodeURIComponent(state.cats.join(",")));
    if (state.onlyAvailable) p.push("available=1");
    if (state.newUserOffer) p.push("offer=1");
    if (state.familyFriendly) p.push("family=1");
    if (state.seniorFriendly) p.push("senior=1");
    return p.join("&");
  }

  function fromQuery(qs) {
    var P = new URLSearchParams(qs || "");
    return {
      region: P.get("region") || "",
      zone: P.get("zone") || "",
      date: P.get("date") || P.get("time") || "",
      cats: (P.get("cats") || P.get("activities") || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean),
      onlyAvailable: P.get("available") === "1",
      newUserOffer: P.get("offer") === "1",
      familyFriendly: P.get("family") === "1",
      seniorFriendly: P.get("senior") === "1",
      isDirty: false,
      resultCount: null,
      isLoadingCount: false,
    };
  }

  return {
    DEFAULT_STATE: DEFAULT_STATE,
    createInitialStore: createInitialStore,
    reducer: reducer,
    hasActiveFilters: hasActiveFilters,
    isAllActivities: isAllActivities,
    getSummaryText: getSummaryText,
    getActiveChips: getActiveChips,
    toQuery: toQuery,
    fromQuery: fromQuery,
  };
});
