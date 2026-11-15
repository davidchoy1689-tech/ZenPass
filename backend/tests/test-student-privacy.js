/**
 * 教練視角學員私隱：私域全顯示 / 公域遮罩（姓氏 + 電話後 4 位）
 */
process.env["JWT" + "_SECRET"] = "test-secret-privacy-0123456789-abcdef";

const path = require("path");
const fs = require("fs");
const Database = require(path.join(__dirname, "..", "node_modules", "better-sqlite3"));

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, phone TEXT, email TEXT, role TEXT, is_coach INTEGER,
    lead_source TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE student_coach_affiliations (student_user_id TEXT PRIMARY KEY, origin_coach_id TEXT NOT NULL,
    bound_at TEXT, commission_rate REAL DEFAULT 0.05, status TEXT DEFAULT 'active');
  CREATE TABLE student_onboarding_invites (id TEXT PRIMARY KEY, coach_id TEXT, student_name TEXT, phone TEXT,
    matched_user_id TEXT, archived_at TEXT, token TEXT);
`);
db.prepare("INSERT INTO users VALUES ('coach1','靜儀','90000001','c1@x.com','coach',1,'',datetime('now'))").run();
db.prepare("INSERT INTO users VALUES ('own1','陳大文','91234567','own@x.com','user',0,'',datetime('now'))").run();
db.prepare("INSERT INTO users VALUES ('pub1','李小明','98765432','pub@x.com','user',0,'',datetime('now'))").run();
db.prepare("INSERT INTO student_coach_affiliations (student_user_id, origin_coach_id) VALUES ('own1','coach1')").run();
db.prepare("INSERT INTO student_onboarding_invites (id,coach_id,student_name,phone,matched_user_id,token) VALUES ('i2','coach1','王伯','92345678','pub2','t')").run();
db.prepare("INSERT INTO users VALUES ('pub2','王伯','92345678','p2@x.com','user',0,'',datetime('now'))").run();

const p = require("../src/services/student-privacy");

let passed = 0, failed = 0;
const ok = (n, c, x) => { c ? (passed++, console.log("  ✅", n)) : (failed++, console.log("  ❌", n, x || "")); };

console.log("\n🧪 1. 遮罩格式");
ok("陳大文 → 陳＊＊", p.maskName("陳大文") === "陳＊＊", p.maskName("陳大文"));
ok("歐陽娜娜 → 歐陽＊＊", p.maskName("歐陽娜娜") === "歐陽＊＊", p.maskName("歐陽娜娜"));
ok("英文名 → 首字", p.maskName("Michael") === "M＊＊", p.maskName("Michael"));
ok("空名 → 學員", p.maskName("") === "學員");
ok("91234567 → ＊＊＊＊ 4567", p.maskPhone("91234567") === "＊＊＊＊ 4567", p.maskPhone("91234567"));
ok("+852 9123-4567 → 後 4 位", p.maskPhone("+852 9123-4567") === "＊＊＊＊ 4567", p.maskPhone("+852 9123-4567"));
ok("太短 → 空", p.maskPhone("12") === "");

console.log("\n🧪 2. 邊個係私域學生");
ok("affiliation 綁定 → own", p.isOwnStudent(db, "coach1", "own1") === true);
ok("平台學員 → 唔係 own", p.isOwnStudent(db, "coach1", "pub1") === false);
ok("名冊已相認 → own", p.isOwnStudent(db, "coach1", "pub2") === true);
ok("其他教練 → 唔係 own", p.isOwnStudent(db, "coach2", "own1") === false);

console.log("\n🧪 3. maskStudent");
const own = p.maskStudent(db, "coach1", { user_id: "own1", name: "陳大文", phone: "91234567", email: "own@x.com" });
ok("私域保留全名", own.name === "陳大文");
ok("私域保留電話", own.phone === "91234567");
ok("私域標記 is_private", own.is_private === true);

const pub = p.maskStudent(db, "coach1", { user_id: "pub1", name: "李小明", phone: "98765432", email: "pub@x.com", emergency_name: "李太", emergency_phone: "92345678" });
ok("公域姓名遮罩", pub.name === "李＊＊", pub.name);
ok("公域電話遮罩", pub.phone === "＊＊＊＊ 5432", pub.phone);
ok("公域 email 清空", pub.email === "");
ok("公域緊急聯絡人遮罩", pub.emergency_name === "李＊＊" && pub.emergency_phone === "＊＊＊＊ 5678", JSON.stringify([pub.emergency_name, pub.emergency_phone]));
ok("公域標記 masked", pub.masked === true && pub.is_private === false);

console.log("\n🧪 4. 教練端接線（不可再洩露全份 PII）");
const cc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "coach-checkin.js"), "utf8");
ok("點名名冊有套用私隱", cc.includes("buildRoster(db, ctx.schedule.id, ctx.v.coachId)") && cc.includes("student-privacy"));
ok("簽到回應姓名會遮罩", cc.includes("privacy.maskName(studentName)"));

const coach = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "coach.js"), "utf8");
ok("教練學生名單有遮罩", coach.includes("maskStudent(db, req.user.id"));

const cr = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "coach-roster.js"), "utf8");
ok("教練名冊有遮罩", cr.includes("privacy.maskName"));

const ro = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "roster-offline.js"), "utf8");
ok("離線名冊傳教練身份", ro.includes("loadRoster(db, sched.id, req.user"));

const fe = fs.readFileSync(path.join(__dirname, "..", "..", "frontend-v2", "coach-checkin.html"), "utf8");
ok("名冊顯示「平台學員」標籤", fe.includes("🔒 平台學員"));

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
