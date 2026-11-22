#!/usr/bin/env node
/**
 * 教練資質到期提醒（每週摘要）
 * 2026-11-22
 *
 * 掃描所有在職教練的牌照／急救／保險到期日：
 *  - 已過期
 *  - 30 日內到期
 * 有問題才發電郵；冇問題靜靜退出（適合 cron）。
 *
 * 用法：
 *   node backend/scripts/coach-credential-expiry-alert.js
 *   node backend/scripts/coach-credential-expiry-alert.js --dry-run
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { getDb } = require("../src/services/database");
const { sendEmail } = require("../src/services/email");

const DRY = process.argv.includes("--dry-run");

function hkToday() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = String(dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const target = Date.parse(d + "T00:00:00+08:00");
  const today = Date.parse(hkToday() + "T00:00:00+08:00");
  if (!Number.isFinite(target)) return null;
  return Math.round((target - today) / 864e5);
}

function adminEmail(db) {
  if (process.env.ADMIN_ALERT_EMAIL) return process.env.ADMIN_ALERT_EMAIL;
  try {
    const row = db.prepare("SELECT value FROM platform_settings WHERE key='lead.admin_email'").get();
    if (row && row.value) return row.value;
  } catch (e) {}
  return process.env.LEAD_ADMIN_EMAIL || "info.zenpass@gmail.com";
}

function main() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone,
              c.license_type, c.license_expiry, c.first_aid_type, c.first_aid_expiry,
              c.insurance_expiry_date
         FROM users u
         LEFT JOIN coach_credentials c ON c.user_id = u.id
        WHERE (u.is_coach = 1 OR u.role = 'coach')
          AND COALESCE(u.is_active,1) = 1
        ORDER BY u.name COLLATE NOCASE`,
    )
    .all();

  const alerts = [];
  rows.forEach((r) => {
    [
      ["牌照", r.license_type || "教練牌照", r.license_expiry],
      ["急救", r.first_aid_type || "急救證書", r.first_aid_expiry],
      ["保險", "責任保險", r.insurance_expiry_date],
    ].forEach(([kind, label, exp]) => {
      const d = daysUntil(exp);
      if (d == null) return;
      if (d < 0 || d <= 30) alerts.push({ coach: r, kind, label, exp: String(exp).slice(0, 10), days: d });
    });
  });

  alerts.sort((a, b) => a.days - b.days);

  if (!alerts.length) {
    console.log(`[coach-expiry] ${hkToday()} 冇到期／30 日內到期項目`);
    return;
  }

  const expired = alerts.filter((a) => a.days < 0);
  const soon = alerts.filter((a) => a.days >= 0);
  const line = (a) =>
    `${a.coach.name || a.coach.email}｜${a.kind}：${a.label}｜到期 ${a.exp}｜${
      a.days < 0 ? `已過期 ${Math.abs(a.days)} 日` : `${a.days} 日後`
    }｜${a.coach.phone || "無電話"}`;

  console.log(`[coach-expiry] ${hkToday()} 發現 ${alerts.length} 項（過期 ${expired.length}／30 日內 ${soon.length}）`);
  alerts.forEach((a) => console.log("  - " + line(a)));

  const html = `
    <div style="font-family:system-ui,-apple-system,'PingFang HK',sans-serif;max-width:640px;margin:auto;color:#0f172a">
      <h2 style="color:#b45309;margin:0 0 8px">🪪 教練資質到期提醒</h2>
      <p style="color:#64748b;font-size:13px;margin:0 0 14px">${hkToday()} · 過期 ${expired.length} 項 · 30 日內到期 ${soon.length} 項</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f8fafc;text-align:left"><th style="padding:8px;border:1px solid #e2e8f0">教練</th><th style="padding:8px;border:1px solid #e2e8f0">項目</th><th style="padding:8px;border:1px solid #e2e8f0">到期日</th><th style="padding:8px;border:1px solid #e2e8f0">狀態</th><th style="padding:8px;border:1px solid #e2e8f0">電話</th></tr></thead>
        <tbody>
          ${alerts
            .map(
              (a) => `<tr>
            <td style="padding:8px;border:1px solid #e2e8f0"><b>${a.coach.name || ""}</b><br><span style="color:#94a3b8;font-size:11px">${a.coach.email || ""}</span></td>
            <td style="padding:8px;border:1px solid #e2e8f0">${a.kind}：${a.label}</td>
            <td style="padding:8px;border:1px solid #e2e8f0">${a.exp}</td>
            <td style="padding:8px;border:1px solid #e2e8f0;color:${a.days < 0 ? "#b91c1c" : "#b45309"};font-weight:700">${
                a.days < 0 ? `已過期 ${Math.abs(a.days)} 日` : `${a.days} 日後`
              }</td>
            <td style="padding:8px;border:1px solid #e2e8f0">${a.coach.phone || "—"}</td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
      <p style="font-size:12px;color:#64748b;margin-top:14px">請到後台「👨‍🏫 教練名冊」更新到期日，或提醒教練到教練中心補交。過期資質會影響開班資格。</p>
    </div>`;

  if (DRY) {
    console.log("[coach-expiry] --dry-run：唔會發電郵");
    console.log(`[coach-expiry] 收件人：${adminEmail(db)}`);
    return;
  }

  sendEmail(adminEmail(db), `【ZenPass】教練資質到期提醒 — 過期 ${expired.length}／30日內 ${soon.length}`, html)
    .then((r) => {
      if (!r.sent) console.log("[coach-expiry] 電郵未發送（SMTP 未設定或失敗）：" + (r.error || ""));
      else console.log("[coach-expiry] ✅ 已發送到 " + adminEmail(db));
    })
    .catch((e) => console.error("[coach-expiry] email error:", e.message));
}

main();
