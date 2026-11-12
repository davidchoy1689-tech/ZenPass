#!/usr/bin/env node
/**
 * Phase 6.0 — 驗收後安全封網與測試帳目隔離
 *
 * 用法（週一驗收全綠、簽核完之後）：
 *   node scripts/post-acceptance-lockdown.js            # 預覽（dry-run，唔會改任何嘢）
 *   node scripts/post-acceptance-lockdown.js --confirm  # 真正執行
 *   node scripts/post-acceptance-lockdown.js --undo --confirm  # 取消隔離（旗標歸 0）
 *
 * 會做三件事（--confirm 時）：
 *   1) 跑 Phase 6.0 migration（加 is_acceptance_test 欄＋建平帳稽核表）
 *   2) 將陳氏家庭驗收帳目標記 is_acceptance_test = 1（軟隔離，永不 DELETE）
 *   3) backend/.env 的 PHONE_VERIFY_ENFORCE 改回 1（並備份原檔）
 *
 * 安全紀律：
 *   • 冇 --confirm 一定係唯讀
 *   • 只做 UPDATE 旗標，冇任何 DELETE
 *   • 改 .env 前先寫 .env.lockdown-bak-<timestamp>
 */

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const CONFIRM = argv.includes("--confirm");
const UNDO = argv.includes("--undo");

const SANDBOX_USER_IDS = ["seed-sandbox-stu-a", "seed-sandbox-stu-b"];
const SANDBOX_PHONES = ["91234567", "98765432"];
const ENV_PATH = process.env.ZP_ENV_FILE || path.resolve(__dirname, "../.env");

function hasColumn(db, table, col) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  } catch (e) {
    return false;
  }
}

function bumpEnv(content, target) {
  if (/^PHONE_VERIFY_ENFORCE=/m.test(content)) {
    return content.replace(/^PHONE_VERIFY_ENFORCE=.*$/m, `PHONE_VERIFY_ENFORCE=${target}`);
  }
  return content.replace(/\s*$/, `\nPHONE_VERIFY_ENFORCE=${target}\n`);
}

function main() {
  const { getDb } = require("../src/services/database");
  const db = getDb();

  console.log("🔒 ZenPass Phase 6.0 — 驗收後安全封網" + (CONFIRM ? "（執行模式）" : "（預覽模式，唔會改任何嘢）"));
  console.log("   DB:", process.env.DB_PATH || "(services/database 預設)");
  console.log("   ENV:", ENV_PATH);

  // ---------- 1) Migration ----------
  if (CONFIRM) {
    const mig = require("../src/config/migrate-phase60").run(db);
    console.log(
      "① Migration：新增欄位 " +
        (mig.addedColumns.length ? mig.addedColumns.join(", ") : "（已存在）") +
        "；daily_reconciliation_logs 已就緒",
    );
  } else {
    const pending = require("../src/config/migrate-phase60").ADDED_COLUMNS.filter(
      ([t, c]) => !hasColumn(db, t, c),
    ).map(([t, c]) => `${t}.${c}`);
    console.log("① Migration：待加欄位 " + (pending.length ? pending.join(", ") : "（已存在）"));
  }

  // ---------- 2) 帳目隔離 ----------
  const idList = SANDBOX_USER_IDS.map(() => "?").join(",");
  const phList = SANDBOX_PHONES.map(() => "?").join(",");
  const flag = UNDO ? 0 : 1;

  const selectPasses = `SELECT COUNT(*) c FROM user_passes WHERE (user_id IN (${idList}) OR user_phone IN (${phList}) OR owner_user_id IN (${idList}) OR created_by IN (${idList}))`;
  const selectBookings = `SELECT COUNT(*) c FROM bookings WHERE (user_id IN (${idList}) OR parent_phone IN (${phList}))`;
  const selectEarnings = `SELECT COUNT(*) c FROM coach_earnings WHERE schedule_id IN (SELECT DISTINCT schedule_id FROM bookings WHERE (user_id IN (${idList}) OR parent_phone IN (${phList})))`;

  const nPass = db.prepare(selectPasses).get(...SANDBOX_USER_IDS, ...SANDBOX_PHONES, ...SANDBOX_USER_IDS, ...SANDBOX_USER_IDS).c;
  const nBook = db.prepare(selectBookings).get(...SANDBOX_USER_IDS, ...SANDBOX_PHONES).c;
  const nEarn = db.prepare(selectEarnings).get(...SANDBOX_USER_IDS, ...SANDBOX_PHONES).c;

  console.log(`② 帳目隔離：將標記 is_acceptance_test=${flag} → Passes ${nPass}、Bookings ${nBook}、Earnings ${nEarn}`);

  if (CONFIRM) {
    const apply = db.transaction(() => {
      const p = db
        .prepare(
          `UPDATE user_passes SET is_acceptance_test = ?
            WHERE user_id IN (${idList}) OR user_phone IN (${phList})
               OR owner_user_id IN (${idList}) OR created_by IN (${idList})`,
        )
        .run(flag, ...SANDBOX_USER_IDS, ...SANDBOX_PHONES, ...SANDBOX_USER_IDS, ...SANDBOX_USER_IDS);
      const b = db
        .prepare(
          `UPDATE bookings SET is_acceptance_test = ?
            WHERE user_id IN (${idList}) OR parent_phone IN (${phList})`,
        )
        .run(flag, ...SANDBOX_USER_IDS, ...SANDBOX_PHONES);
      const e = db
        .prepare(
          `UPDATE coach_earnings SET is_acceptance_test = ?
            WHERE schedule_id IN (
              SELECT DISTINCT schedule_id FROM bookings
               WHERE user_id IN (${idList}) OR parent_phone IN (${phList}))`,
        )
        .run(flag, ...SANDBOX_USER_IDS, ...SANDBOX_PHONES);
      return { p: p.changes, b: b.changes, e: e.changes };
    });
    const r = apply();
    console.log(`   ✅ 已更新：Passes(${r.p})、Bookings(${r.b})、Earnings(${r.e})`);
    try {
      require("../src/services/audit").audit({
        actionType: UNDO ? "phase60.lockdown_undo" : "phase60.lockdown_isolate",
        entityType: "system",
        entityId: "post-acceptance-lockdown",
        userId: null,
        newValues: { flag, passes: r.p, bookings: r.b, earnings: r.e },
        description: UNDO ? "取消驗收帳目隔離" : "驗收後測試帳目軟隔離（is_acceptance_test=1）",
      });
    } catch (e) {}
  }

  // ---------- 3) .env 安全閘門 ----------
  if (UNDO) {
    console.log("③ ENFORCE：--undo 模式唔改 .env");
  } else if (!fs.existsSync(ENV_PATH)) {
    console.log("③ ENFORCE：找不到 " + ENV_PATH + "，請手動設定 PHONE_VERIFY_ENFORCE=1");
  } else {
    const content = fs.readFileSync(ENV_PATH, "utf8");
    const current = (content.match(/^PHONE_VERIFY_ENFORCE=(.*)$/m) || [])[1];
    if (String(current).trim() === "1") {
      console.log("③ ENFORCE：已經是 1，無需變更");
    } else if (!CONFIRM) {
      console.log(`③ ENFORCE：現時 ${current === undefined ? "(未設定)" : current} → 將會改成 1（並備份 .env）`);
    } else {
      fs.writeFileSync(`${ENV_PATH}.lockdown-bak-${Date.now()}`, content, "utf8");
      fs.writeFileSync(ENV_PATH, bumpEnv(content, 1), "utf8");
      console.log(`③ ENFORCE：${current === undefined ? "(未設定)" : current} → 1（已備份 .env）`);
    }
  }

  // ---------- 4) 後續步驟 ----------
  if (!CONFIRM) {
    console.log("\nℹ️  預覽完成，冇改任何嘢。確認後請執行：");
    console.log("   node scripts/post-acceptance-lockdown.js --confirm");
  } else {
    console.log("\n⚠️  請立即重啟服務令安全閘門生效：");
    console.log("   pm2 restart zenpass-api && sleep 2 && curl -s -o /dev/null -w 'health %{http_code}\\n' http://localhost:3001/api/health");
    console.log("\n📋 驗收清單：");
    console.log("   AC-LOCK-1：未驗證電話帳戶 → 403 PHONE_VERIFICATION_REQUIRED");
    console.log("   AC-LOCK-2：出糧／報表加 WHERE is_acceptance_test = 0 後，陳氏家庭金額不計入");
  }
}

try {
  main();
} catch (e) {
  console.error("❌ 封網程序失敗：", e.message);
  process.exit(1);
}
