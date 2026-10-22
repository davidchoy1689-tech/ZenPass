/**
 * Test: 首頁「按場景搵堂」快捷 Filter + explore.html 場景過濾
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "../../frontend-v2");
const idx = fs.readFileSync(path.join(root, "index.html"), "utf8");
const exp = fs.readFileSync(path.join(root, "explore.html"), "utf8");
const css = fs.readFileSync(path.join(root, "assets/v2.css"), "utf8");

const fails = [];
const has = (s, m, label) => { if (!s.includes(m)) fails.push("missing " + (label || "") + ": " + m); };

// 首頁場景 chips
has(idx, "按場景搵堂", "scene title");
has(idx, 'id="scenes"', "scenes row");
["family", "office", "burn", "beginner"].forEach(s => has(idx, "explore.html?scene=" + s, "scene link " + s));
has(idx, "親子 / 樂齡好去處", "family label");
has(idx, "放工放鬆 / 辦公室伸展", "office label");
has(idx, "高效燃脂 / 減脂汗水", "burn label");
has(idx, "新手友善 / 無需經驗", "beginner label");

// explore 場景過濾
has(exp, "const SCENES", "SCENES map");
has(exp, 'get("scene")', "reads scene param");
has(exp, "function matchScene", "matchScene filter");
if (!/matchScene\(c\)/.test(exp)) fails.push("view() should filter by scene");
has(exp, 'on.push(["scene"', "scene active tag");

// CSS：anchor chip 可點
if (!/a\.chip/.test(css)) fails.push("a.chip style");
if (!/\.chip\s*\{[^}]*text-decoration:\s*none/.test(css)) fails.push(".chip should have text-decoration:none for anchors");

if (fails.length) { console.error("❌ FAILED:\n" + fails.join("\n")); process.exit(1); }
console.log("✅ 場景快捷 Filter tests passed");
