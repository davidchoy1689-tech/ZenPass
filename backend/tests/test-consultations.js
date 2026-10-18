/** ZenPass — 一對一健康諮詢／身體評估 tests */
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

process.env.JWT_SECRET = "test_s…mnop";
const tmp = path.join(os.tmpdir(), "zenpass-consult-" + Date.now() + ".db");
process.env.DB_PATH = tmp;

let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✅ " + m); else { console.log("  ❌ " + m); fail++; } };

(async () => {
  const pre = new Database(tmp);
  pre.exec(`
  CREATE TABLE partner_venues (id TEXT PRIMARY KEY, name TEXT, district TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, password_hash TEXT,
    role TEXT DEFAULT 'user', credits INTEGER DEFAULT 0, membership_type TEXT DEFAULT 'none',
    membership_expires_at TEXT, loyalty_tier TEXT DEFAULT 'bronze', loyalty_tier_manual INTEGER DEFAULT 0,
    is_coach INTEGER DEFAULT 0, coach_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')));
  `);
  const u = (id, mt) => pre.prepare("INSERT INTO users (id,name,email,membership_type,membership_expires_at) VALUES (?,?,?,?,?)")
    .run(id, id, id + "@x.com", mt, mt === "none" ? null : "2099-12-31");
  u("silver_u", "silver");
  u("gold_u", "gold");
  u("lite_u", "lite");
  u("none_u", "none");
  pre.close();

  const initDatabase = require("../src/config/init-db");
  await initDatabase();

  const { getDb } = require("../src/services/database");
  const db = getDb();
  const { requestConsultation, getQuotaSummary, listMine, listForAdmin, updateByAdmin } = require("../src/services/consultations");

  console.log("🧪 健康諮詢／身體評估 tests");

  console.log("── 會籍資格 ──");
  ok(getQuotaSummary("gold_u").plan === "gold", "VIP Pass 有資格");
  ok(getQuotaSummary("silver_u").plan === "silver", "高階 Pass 有資格");
  ok(getQuotaSummary("lite_u").plan === null, "輕量 Pass 冇資格");
  ok(getQuotaSummary("none_u").plan === null, "非會員冇資格");
  const noPlan = (() => { try { requestConsultation("none_u", {}); return null; } catch (e) { return e; } })();
  ok(noPlan && noPlan.status === 403, "非會員申請 → 403");

  console.log("── 高階 Pass：每月 1 次 ──");
  const s1 = requestConsultation("silver_u", { notes: "想改善肩頸" });
  ok(s1.kind === "member" && s1.status === "pending", "提交本人諮詢成功");
  ok(s1.remaining.member === 0, "剩餘 0 次");
  const s2 = (() => { try { requestConsultation("silver_u", {}); return null; } catch (e) { return e; } })();
  ok(s2 && s2.status === 409, "同一月第二次 → 409");
  const sg = (() => { try { requestConsultation("silver_u", { kind: "vip_guest", guest_name: "朋友" }); return null; } catch (e) { return e; } })();
  ok(sg && sg.status === 403, "高階 Pass 冇邀請朋友名額");

  console.log("── VIP Pass：1 次 + 1 次邀請 ──");
  const quota = getQuotaSummary("gold_u");
  ok(quota.quota.member === 1 && quota.quota.vip_guest === 1, "配額 1 + 1");
  requestConsultation("gold_u", { notes: "第一次" });
  const g2 = (() => { try { requestConsultation("gold_u", {}); return null; } catch (e) { return e; } })();
  ok(g2 && g2.status === 409, "第二次本人諮詢 → 409（每月 1 次）");
  const noName = (() => { try { requestConsultation("gold_u", { kind: "vip_guest" }); return null; } catch (e) { return e; } })();
  ok(noName && noName.status === 400, "邀請朋友冇姓名 → 400");
  const guest = requestConsultation("gold_u", { kind: "vip_guest", guest_name: "陳大文", guest_phone: "91234567" });
  ok(guest.kind === "vip_guest" && guest.remaining.vip_guest === 0, "邀請朋友成功（剩 0）");

  console.log("── 取消可釋放名額 ──");
  const mine = listMine("silver_u");
  const rid = mine.records[0].id;
  updateByAdmin(rid, { status: "cancelled", adminId: "admin1", admin_note: "會員臨時有事" });
  ok(getQuotaSummary("silver_u").remaining.member === 1, "取消後名額回復");
  const again = requestConsultation("silver_u", { notes: "重新預約" });
  ok(again.status === "pending", "取消後可重新提交（新申請）");
  ok(getQuotaSummary("silver_u").remaining.member === 0, "重新提交後再用 1 次");

  console.log("── Admin 流程 ──");
  const pending = listForAdmin("pending");
  ok(pending.length >= 3, "admin 睇到待安排申請");
  ok(pending[0].user_name, "有會員名稱");
  const upd = updateByAdmin(again.id, { status: "scheduled", scheduled_at: "2026-11-01 15:00", adminId: "admin1", admin_note: "中環工作室" });
  ok(upd.status === "scheduled" && upd.scheduled_at === "2026-11-01 15:00", "安排時間成功");
  const bad = (() => { try { updateByAdmin(again.id, { status: "weird" }); return null; } catch (e) { return e; } })();
  ok(bad && bad.status === 400, "無效狀態 → 400");
  const nf = (() => { try { updateByAdmin("nope", { status: "completed" }); return null; } catch (e) { return e; } })();
  ok(nf && nf.status === 404, "不存在 → 404");

  console.log("── 接線 / 前端 ──");
  const root = path.join(__dirname, "..");
  const idx = fs.readFileSync(path.join(root, "src/index.js"), "utf8");
  const initSrc = fs.readFileSync(path.join(root, "src/config/init-db.js"), "utf8");
  const web = path.join(root, "..", "frontend-v2");
  const page = fs.readFileSync(path.join(web, "consultations.html"), "utf8");
  const my = fs.readFileSync(path.join(web, "my.html"), "utf8");
  const admin = fs.readFileSync(path.join(web, "admin.html"), "utf8");
  const memSrc = fs.readFileSync(path.join(root, "src/routes/memberships.js"), "utf8");
  ok(/app\.use\("\/api\/consultations"/.test(idx), "route 已 mount");
  ok(/CREATE TABLE IF NOT EXISTS consultations/.test(initSrc), "init-db 建 consultations 表");
  ok(/migration\.plan_features_20261018/.test(initSrc), "init-db 同步 pricing_config 會籍文案");
  ok(/一對一健康諮詢／身體評估/.test(initSrc), "文案遷移包含健康諮詢");
  ok(/consultations\.html/.test(my), "我的頁有入口");
  ok(/consultations\/my/.test(page) && /consultations\/request/.test(page), "前端呼叫正確 API");
  ok(/健康諮詢/.test(admin) && /consultationsTab/.test(admin), "admin 有健康諮詢 tab");
  ok(/一對一健康諮詢／身體評估/.test(memSrc), "計劃文案已改為健康諮詢／身體評估");
  ok(/免費邀請朋友/.test(memSrc), "VIP 文案有免費邀請朋友");

  console.log(fail === 0 ? "\n🎉 全部通過" : `\n❌ ${fail} 項失敗`);
  process.exit(fail === 0 ? 0 : 1);
})();
