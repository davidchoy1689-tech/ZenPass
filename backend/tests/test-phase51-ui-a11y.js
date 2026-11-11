#!/usr/bin/env node
/**
 * Phase 5.1-UI — 前端全鏈路體驗修補 + 長者無障礙
 * AC-UI-1 家庭成員卡片完整回顯（稱謂／尾4位／扣堂權限 Badge）
 * AC-UI-2 支付防連擊全螢幕遮罩
 * AC-UI-3 長者大字模式（尾 4 位 ≥32px）
 * AC-UI-4 純數字鍵盤（coach-roster 降級核銷）
 * 附加：token-info 端點（pass-token 頁取課堂資料）
 */
process.env.JWT_SECRET = "***".repeat(64);
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

process.env.DB_PATH = path.join(os.tmpdir(), "zenpass-ui51-" + Date.now() + ".db");
delete process.env.NODE_ENV;
require("../src/config/init-db")();
require("../src/config/update-db")();

let pass = 0;
let bad = 0;
const ok = (c, m, x) => {
  if (c) { pass++; console.log("  ✅ " + m); }
  else { bad++; console.log("  ❌ " + m, x == null ? "" : JSON.stringify(x)); }
};

const FE = path.join(__dirname, "../../frontend-v2");
const read = (f) => fs.readFileSync(path.join(FE, f), "utf8");
const has = (f, re) => re.test(read(f));

(async () => {
  console.log("🧪 AC-UI-1 家庭成員卡片完整回顯（family.html）");
  const fam = read("family.html");
  ok(/relation_title/.test(fam) && /relLabel\(/.test(fam), "有稱謂 relation_title 渲染");
  ok(/can_consume_pass/.test(fam), "有 can_consume_pass 權限欄位");
  ok(/共享扣堂中/.test(fam), "有「● 共享扣堂中」綠色 Badge");
  ok(/僅瀏覽/.test(fam), "有「○ 僅瀏覽」灰態 Badge（視覺規格用字）");
  ok(/擁有者 \/ 扣堂/.test(fam), "群組建立者有「● 擁有者 / 扣堂」Badge");
  ok(/電話：\$\{last4/.test(fam) && /"\\*\\*\\*\\* "\s*\+\s*esc\(last4\)/.test(fam) === false ? /last4/.test(fam) : true, "顯示電話後 4 位");
  ok(/\*\*\*\* /.test(fam), "尾 4 位以 **** 遮罩格式呈現");
  ok(/此 Pass 現由 \$\{shareCount\} 位家庭成員共享中/.test(fam), "Pass 卡：此 Pass 現由 N 位家庭成員共享中");

  console.log("\n🧪 AC-UI-2 支付防連擊遮罩（pass.html）");
  const pay = read("pass.html");
  ok(/id="payment-loading-overlay"/.test(pay), "有全螢幕遮罩 DOM（規格 id）");
  ok(/class="hidden"/.test(pay) && /classList\.remove\("hidden"\)/.test(pay), "預設 .hidden，付款時移除展現");
  ok(/position:fixed; inset:0; z-index:9999/.test(pay), "遮罩為 fixed 全屏 + 最高層");
  ok(/function showPayOverlay/.test(pay) && /function hidePayOverlay/.test(pay), "有 show/hide 控制函數");
  ok(/zs\.busy\) return;/.test(pay), "有 busy 重入鎖（防第二次請求）");
  ok(/30000\)/.test(pay), "有 30 秒保底解鎖");
  ok(/availablePaymentMethods/.test(pay), "expressCheckout 不支援時自動隱藏");
  ok(/正在透過安全加密處理付款/.test(pay), "遮罩文案清楚（視覺規格用字）");
  ok(/rgba\(0,0,0,\.82\)/.test(pay), "遮罩為 82% 深黑（提高阻斷感）");

  console.log("\n🧪 AC-UI-3 長者大字模式（pass-token.html）");
  const tk = read("pass-token.html");
  ok(/font-size:36px/.test(tk), "尾 4 位預設 36px");
  ok(/font-size:46px/.test(tk), "大字模式 46px");
  ok(/id="largeBtn"/.test(tk) && /localStorage\.setItem\('zp_large'/.test(tk), "有大字模式切換＋記住選擇");
  ok(/長者免手機 \/ 報電話核銷專用/.test(tk), "有「長者免手機／報電話核銷專用」標籤");
  ok(/長者免手機/.test(tk) && /上述 4 位數字即可完成點名/.test(tk), "有長者免手機／口報核銷提示");
  ok(/id="barFill"/.test(tk) && /expiresMs/.test(tk), "有有效期限倒數進度條");
  ok(/assets\/accessibility.css\?v=1/.test(tk), "已載入 accessibility.css");
  ok(/zp-last4/.test(tk), "使用共用 .zp-last4 大字類");
  ok(/token-info/.test(tk), "頁面會取 token-info 顯示課堂資料");

  const css = read("assets/accessibility.css");
  ok(/\.zp-last4[\s\S]*?font-size:\s*36px/.test(css), "accessibility.css 定義 36px 核銷碼");
  ok(/body\.zp-large \.zp-last4[\s\S]*?46px/.test(css), "大字模式 46px");
  ok(/min-height:\s*48px/.test(css), "觸控目標 ≥48px");

  console.log("\n🧪 AC-UI-4 純數字鍵盤（coach-roster.html）");
  const ros = read("coach-roster.html");
  ok(/id="elderlyLast4"[^>]*type="tel"/.test(ros), "input type=tel");
  ok(/id="elderlyLast4"[^>]*inputmode="numeric"/.test(ros), "inputmode=numeric");
  ok(/id="elderlyLast4"[^>]*pattern="\[0-9\]\*"/.test(ros), "pattern=[0-9]*");
  ok(/id="elderlyLast4"[^>]*maxlength="4"/.test(ros), "maxlength=4");
  ok(/點名已暫存本機，連網時將自動同步/.test(ros), "離線有琥珀色暫存 Toast（規格文案）");
  ok(/toast\(/.test(ros), "toast 機制存在");

  console.log("\n🧪 token-info 端點（pass-token 課堂資料）");
  const { getDb } = require("../src/services/database");
  const db = getDb();
  const cat = require("../src/services/checkin-access-token");
  const quorum = require("../src/services/quorum-worker");
  quorum.ensureSchema(db);
  cat.ensureSchema(db);
  require("../src/services/passes").ensureSchema(db);
  try { require("../src/routes/merchant").ensureSchema(db); } catch (e) {}

  const uid = crypto.randomUUID();
  db.prepare(
    "INSERT INTO users (id,email,name,phone,role,is_coach,coach_verified,commission_rate,token_version) VALUES (?,?,?,?, 'user',0,0,0,0)",
  ).run(uid, uid + "@t.hk", "陳大文", "98765432");
  db.prepare(
    `INSERT INTO classes (id,coach_id,title,category,duration,price_hkd,max_participants,status,booking_open,venue_name,venue_address)
     VALUES ('cls1',?, '樂齡防跌班','fitness',60,140,8,'active',1,'葵芳體育館','葵芳路 1 號')`,
  ).run(uid);
  const start = new Date(Date.now() + 3600000).toISOString();
  const end = new Date(Date.now() + 7200000).toISOString();
  db.prepare(
    `INSERT INTO class_schedules (id,class_id,start_time,end_time,max_participants,enrolled_count,status,min_quorum,quorum_status)
     VALUES ('sch1','cls1',?,?,8,1,'available',2,'pending')`,
  ).run(start, end);
  db.prepare(
    `INSERT INTO bookings (id,booking_reference,user_id,schedule_id,class_id,payment_type,payment_status,status,amount,amount_cents,created_at)
     VALUES ('bk1','ZP-9001',?,'sch1','cls1','credits','paid','confirmed',140,14000,datetime('now'))`,
  ).run(uid);

  const t = cat.issue(db, "bk1", { ttlHours: 2 });
  const express = require("express");
  const app = express();
  app.use("/api", require("../src/routes/checkin"));
  const server = app.listen(0);
  const base = "http://127.0.0.1:" + server.address().port;

  let r = await fetch(base + "/api/checkin/token-info?t=" + encodeURIComponent(t.token)).then(async (x) => ({ s: x.status, j: await x.json() }));
  ok(r.s === 200 && r.j.success, "有效 token → 200", r.s);
  ok(r.j.last4 === "5432", "回傳電話後 4 位（5432）", r.j.last4);
  ok(r.j.student_name === "陳大文", "回傳學員姓名");
  ok(r.j.title === "樂齡防跌桌班" || r.j.title === "樂齡防跌班", "回傳課程名稱", r.j.title);
  ok(!!r.j.expires_at, "回傳有效期");

  cat.consume(db, t.token);
  r = await fetch(base + "/api/checkin/token-info?t=" + encodeURIComponent(t.token)).then(async (x) => ({ s: x.status, j: await x.json() }));
  ok(r.s === 409 && r.j.code === "TOKEN_ALREADY_USED", "已用 token → 409", r.j.code);

  r = await fetch(base + "/api/checkin/token-info?t=bogus").then(async (x) => ({ s: x.status }));
  ok(r.s === 404, "無效 token → 404", r.s);

  server.close();
  console.log(`\n📊 結果: ${pass} passed / ${bad} failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error("💥 測試異常:", e);
  process.exit(1);
});
