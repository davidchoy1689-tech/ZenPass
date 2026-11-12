#!/usr/bin/env node
/**
 * Phase 5.9 — 共用 Filter Store（純 reducer）單元測試
 * 對應 David 2026-11-13 的 TypeScript spec，移植成 vanilla JS 後的等價驗證
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "../../frontend-v2/assets/filter-store.js"), "utf8");
const sandbox = { window: {}, module: { exports: {} }, URLSearchParams };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "filter-store.js" });
const FS = sandbox.window.ZPFilterStore;

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  c ? (pass++, console.log("  ✅ " + m)) : (bad++, console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)));
};

const DICT = {
  regions: [{ k: "", l: "全港" }, { k: "kowloon", l: "九龍" }],
  districts: [{ k: "kt", l: "觀塘" }, { k: "ssp", l: "深水埗" }],
  times: [{ k: "", l: "任何時段" }, { k: "weekend", l: "週末" }],
};

console.log("🧪 1. 預設與開啟");
let st = FS.createInitialStore();
ok(st.draft.region === "" && st.draft.zone === "" && st.draft.cats.length === 0, "預設＝全港／任何時段／全部運動");
ok(FS.hasActiveFilters(st.draft) === false, "預設無 active filter");
st = FS.reducer(st, { type: "PATCH", state: { zone: "kt", date: "weekend", cats: ["芬蘭木柱"] } });
ok(st.draft.isDirty === true, "改動會標 dirty");
st = FS.reducer(st, { type: "APPLY" });
ok(st.applied.zone === "kt" && st.applied.isDirty === false, "APPLY 提交並清 dirty");
st = FS.reducer(st, { type: "PATCH", state: { zone: "ssp" } });
st = FS.reducer(st, { type: "DISCARD_DRAFT" });
ok(st.draft.zone === "kt", "DISCARD 回到 applied");
const reopened = FS.reducer(st, { type: "OPEN_PANEL" });
ok(reopened.draft.zone === "kt" && reopened.draft.isDirty === false, "OPEN_PANEL 由 applied 開新 draft");
ok(st.applied.zone === "kt", "OPEN_PANEL 唔會改 applied");

console.log("\n🧪 2. 選取規則");
st = FS.reducer(FS.createInitialStore(), { type: "TOGGLE_ACTIVITY", activityId: "瑜伽" });
ok(st.draft.cats.length === 1, "多選：加入");
st = FS.reducer(st, { type: "TOGGLE_ACTIVITY", activityId: "瑜伽" });
ok(st.draft.cats.length === 0, "多選：再撳取消");
st = FS.reducer(st, { type: "TOGGLE_ACTIVITY", activityId: "布袋球" });
st = FS.reducer(st, { type: "SET_ACTIVITY_ALL" });
ok(st.draft.cats.length === 0 && FS.isAllActivities(st.draft), "SET_ACTIVITY_ALL 清空");
st = FS.reducer(FS.createInitialStore(), { type: "PATCH", state: { region: "kowloon", zone: "kt" } });
st = FS.reducer(st, { type: "SET_REGION", region: "" });
ok(st.draft.region === "" && st.draft.zone === "", "設回全港會清地區");

console.log("\n🧪 3. RESET / REMOVE_CHIP");
st = FS.reducer(FS.createInitialStore(), { type: "PATCH", state: { zone: "kt", date: "weekend", cats: ["瑜伽"], onlyAvailable: true } });
const reset = FS.reducer(st, { type: "RESET" });
ok(!reset.draft.zone && !reset.draft.date && !reset.draft.cats.length && !reset.draft.onlyAvailable, "RESET 清空所有欄位");
ok(reset.draft.isDirty === true, "RESET 標 dirty（未套用）");
const c1 = FS.reducer(st, { type: "REMOVE_CHIP", chip: { type: "district" } });
ok(c1.draft.zone === "", "REMOVE_CHIP district 清 zone");
const c2 = FS.reducer(st, { type: "REMOVE_CHIP", chip: { type: "time" } });
ok(c2.draft.date === "", "REMOVE_CHIP time 清 date");
const c3 = FS.reducer(st, { type: "REMOVE_CHIP", chip: { type: "activity", value: "瑜伽" } });
ok(c3.draft.cats.length === 0, "REMOVE_CHIP activity 只清該項");
const c4 = FS.reducer(st, { type: "REMOVE_CHIP", chip: { type: "advanced", key: "onlyAvailable" } });
ok(c4.draft.onlyAvailable === false, "REMOVE_CHIP advanced 清 flag");

console.log("\n🧪 4. 進階 flags");
st = FS.reducer(FS.createInitialStore(), { type: "TOGGLE_ADVANCED", key: "familyFriendly" });
ok(st.draft.familyFriendly === true && FS.hasActiveFilters(st.draft), "TOGGLE_ADVANCED 生效並計入 active");

console.log("\n🧪 5. Hydrate / 摘要 / chips");
st = FS.reducer(FS.createInitialStore(), { type: "HYDRATE", state: { zone: "kt", date: "weekend", cats: ["芬蘭木柱"] } });
ok(st.draft.zone === "kt" && st.applied.zone === "kt", "HYDRATE 同時寫 draft+applied");
ok(FS.getSummaryText(st.applied, DICT) === "觀塘 · 週末 · 芬蘭木柱", "摘要文字正確");
const chips = FS.getActiveChips(st.applied, DICT);
ok(chips.length === 3 && chips[0].type === "district" && chips[2].type === "activity", "chips 對應三個 filter");

console.log("\n🧪 6. URL 映射");
const qs = FS.toQuery(st.applied);
ok(/zone=kt/.test(qs) && /date=weekend/.test(qs) && /cats=/.test(qs), "toQuery 帶 zone/date/cats");
const back = FS.fromQuery(qs);
ok(back.zone === "kt" && back.date === "weekend" && back.cats[0] === "芬蘭木柱", "fromQuery 還原");
const adv = FS.fromQuery("available=1&offer=1&family=1&senior=1");
ok(adv.onlyAvailable && adv.newUserOffer && adv.familyFriendly && adv.seniorFriendly, "進階 flags 可由 URL 讀入");

console.log(`\n📊 結果: ${pass} passed / ${bad} failed`);
process.exit(bad ? 1 : 0);
