/**
 * ZenPass — 場地月結單（Venue Monthly Statement）
 * 自動結算場地每月租場收入：毛收入 / 平台佣金 / 場地實收，並可電郵 + 列印 PDF。
 *
 * 時間處理：venue_rentals.start_time 以 UTC ISO 儲存（結尾 Z），
 * 月結單按香港時區（+8）劃月 → strftime('%Y-%m', datetime(start_time,'+8 hours'))
 */

const { getDb } = require("./database");

// 由 "YYYY-MM" 取得該月（HKT）上下界字串，方便做區間查詢
function monthBounds(monthStr) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthStr || ""));
  let year, mon;
  if (m) {
    year = parseInt(m[1], 10);
    mon = parseInt(m[2], 10);
    if (mon < 1 || mon > 12) mon = 1;
  } else {
    const now = new Date(Date.now() + 8 * 3600 * 1000); // HKT
    year = now.getUTCFullYear();
    mon = now.getUTCMonth() + 1;
  }
  const pad = (n) => String(n).padStart(2, "0");
  const key = `${year}-${pad(mon)}`;
  const start = `${key}-01`;
  const ny = mon === 12 ? year + 1 : year;
  const nm = mon === 12 ? 1 : mon + 1;
  const endExclusive = `${ny}-${pad(nm)}-01`;
  return { key, year, month: mon, start, endExclusive };
}

// 上一個月（相對給定月份）
function prevMonthKey(monthStr) {
  const b = monthBounds(monthStr);
  const ny = b.month === 1 ? b.year - 1 : b.year;
  const nm = b.month === 1 ? 12 : b.month - 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function hkd(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return "HK$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * 建立場地某月月結單
 * @param {string} venueId
 * @param {string} monthStr "YYYY-MM"（省略 = 本月）
 */
function buildStatement(venueId, monthStr) {
  const db = getDb();
  const bounds = monthBounds(monthStr);

  const venue =
    db.prepare("SELECT id, name, address, district, category, commission_rate, commission_plan, email FROM partner_venues WHERE id = ?").get(venueId) ||
    { id: venueId, name: "場地" };

  const defaultRate = Number(venue.commission_rate) || 0.15;

  const rows = db
    .prepare(
      `SELECT r.id, r.coach_id, r.start_time, r.end_time, r.price_hkd, r.status,
              r.commission_rate, r.commission_amount, r.venue_earned,
              u.name AS coach_name, u.email AS coach_email
       FROM venue_rentals r
       LEFT JOIN users u ON r.coach_id = u.id
       WHERE r.venue_id = ?
         AND r.status IN ('confirmed','completed')
         AND strftime('%Y-%m', datetime(r.start_time, '+8 hours')) = ?
       ORDER BY r.start_time ASC`,
    )
    .all(venueId, bounds.key);

  const rentals = rows.map((r) => {
    const gross = round2(r.price_hkd);
    const rate = Number(r.commission_rate) || defaultRate;
    const commission = r.commission_amount && Number(r.commission_amount) > 0 ? round2(r.commission_amount) : round2(gross * rate);
    const net = r.venue_earned && Number(r.venue_earned) > 0 ? round2(r.venue_earned) : round2(gross - commission);
    return {
      id: r.id,
      coach_id: r.coach_id,
      coach_name: r.coach_name || "教練",
      coach_email: r.coach_email || "",
      start_time: r.start_time,
      end_time: r.end_time,
      status: r.status,
      hours: round2((new Date(r.end_time) - new Date(r.start_time)) / 3600000),
      gross,
      rate,
      commission,
      net,
      // 香港時間顯示用
      date_hkt: String(r.start_time || "").slice(0, 10),
      time_hkt: String(r.start_time || "").slice(11, 16) + "-" + String(r.end_time || "").slice(11, 16),
    };
  });

  const totals = rentals.reduce(
    (a, r) => {
      a.count += 1;
      a.gross = round2(a.gross + r.gross);
      a.commission = round2(a.commission + r.commission);
      a.net = round2(a.net + r.net);
      a.hours = round2(a.hours + r.hours);
      return a;
    },
    { count: 0, gross: 0, commission: 0, net: 0, hours: 0 },
  );

  // 按教練分組
  const byCoachMap = {};
  for (const r of rentals) {
    const key = r.coach_id || "unknown";
    if (!byCoachMap[key]) byCoachMap[key] = { coach_id: key, coach_name: r.coach_name, sessions: 0, gross: 0, commission: 0, net: 0 };
    const c = byCoachMap[key];
    c.sessions += 1;
    c.gross = round2(c.gross + r.gross);
    c.commission = round2(c.commission + r.commission);
    c.net = round2(c.net + r.net);
  }
  const byCoach = Object.values(byCoachMap).sort((a, b) => b.gross - a.gross);

  // 場地罰款 / 手續費（該月建立，未結清）
  let penalties = [];
  try {
    penalties = db
      .prepare(
        `SELECT id, rental_id, type, amount_hkd, status, note, created_at
           FROM venue_penalties
          WHERE venue_id = ?
            AND status IN ('pending_charge','applied')
            AND strftime('%Y-%m', datetime(created_at, '+8 hours')) = ?
          ORDER BY created_at ASC`,
      )
      .all(venueId, bounds.key)
      .map((x) => ({
        id: x.id,
        rental_id: x.rental_id,
        type: x.type,
        amount: round2(x.amount_hkd),
        status: x.status,
        note: x.note || "",
        date_hkt: String(x.created_at || "").slice(0, 10),
      }));
  } catch (e) {
    penalties = [];
  }
  const penaltiesTotal = round2(penalties.reduce((a, x) => a + x.amount, 0));
  const payableToVenue = round2(Math.max(0, totals.net - penaltiesTotal));
  const carryForward = round2(Math.max(0, penaltiesTotal - totals.net));

  const pendingCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM venue_rentals
       WHERE venue_id = ? AND status = 'pending'
         AND strftime('%Y-%m', datetime(start_time, '+8 hours')) = ?`,
    )
    .get(venueId, bounds.key).c;

  return {
    venue: { id: venue.id, name: venue.name, address: venue.address || "", district: venue.district || "", email: venue.email || "" },
    month: bounds.key,
    commission_rate: defaultRate,
    rentals,
    byCoach,
    totals,
    penalties,
    penalties_total: penaltiesTotal,
    payable_to_venue: payableToVenue,
    carry_forward: carryForward,
    pending_count: pendingCount,
    generated_at: new Date().toISOString(),
  };
}

/**
 * 產生可列印 / 可另存 PDF 的月結單 HTML
 */
function renderStatementHtml(stmt) {
  const monthLabel = `${stmt.month.slice(0, 4)} 年 ${parseInt(stmt.month.slice(5), 10)} 月`;
  const rowHtml = stmt.rentals
    .map(
      (r) => `<tr>
      <td>${esc(r.date_hkt)}</td>
      <td>${esc(r.time_hkt)}</td>
      <td>${esc(r.coach_name)}</td>
      <td style="text-align:right">${hkd(r.gross)}</td>
      <td style="text-align:right">${(r.rate * 100).toFixed(0)}%</td>
      <td style="text-align:right">${hkd(r.commission)}</td>
      <td style="text-align:right"><b>${hkd(r.net)}</b></td>
    </tr>`,
    )
    .join("");

  const coachRowHtml = stmt.byCoach
    .map(
      (c) => `<tr><td>${esc(c.coach_name)}</td><td style="text-align:right">${c.sessions}</td>
      <td style="text-align:right">${hkd(c.gross)}</td><td style="text-align:right">${hkd(c.commission)}</td>
      <td style="text-align:right"><b>${hkd(c.net)}</b></td></tr>`,
    )
    .join("");

  return `<!doctype html><html lang="zh-HK"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZenPass 場地月結單 — ${esc(stmt.venue.name)} ${esc(stmt.month)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,"PingFang HK","Microsoft JhengHei",sans-serif;color:#1f2937;margin:0;background:#f3f4f6}
  .sheet{max-width:820px;margin:24px auto;background:#fff;padding:32px 36px;box-shadow:0 2px 12px rgba(0,0,0,.08);border-radius:12px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #c94420;padding-bottom:16px}
  .brand{font-size:22px;font-weight:800;color:#c94420}
  .brand small{display:block;font-size:12px;font-weight:500;color:#6b7280;margin-top:4px}
  h1{font-size:18px;margin:22px 0 6px}
  .muted{color:#6b7280;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
  th,td{padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:left}
  th{background:#fafafa;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.02em}
  .tot{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}
  .box{flex:1;min-width:150px;border:1px solid #e5e7eb;border-radius:10px;padding:14px}
  .box .k{font-size:12px;color:#6b7280}
  .box .v{font-size:20px;font-weight:800;margin-top:6px}
  .box.net{border-color:#16a34a;background:#f0fdf4}
  .box.net .v{color:#16a34a}
  .note{margin-top:24px;font-size:11px;color:#9ca3af;line-height:1.6}
  .toolbar{max-width:820px;margin:16px auto -8px;display:flex;justify-content:flex-end;gap:8px}
  .btn{background:#c94420;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer;font-weight:600}
  .btn.sec{background:#fff;color:#c94420;border:1px solid #c94420}
  @media print{body{background:#fff}.toolbar{display:none}.sheet{box-shadow:none;margin:0;border-radius:0;max-width:none}}
</style></head><body>
<div class="toolbar"><button class="btn" onclick="window.print()">🖨️ 列印 / 儲存 PDF</button></div>
<div class="sheet">
  <div class="head">
    <div class="brand">ZenPass 禪流<small>場地結算月結單 · Venue Statement</small></div>
    <div style="text-align:right">
      <div style="font-weight:700;font-size:15px">${esc(stmt.venue.name)}</div>
      <div class="muted">${esc(stmt.venue.district ? stmt.venue.district + " · " : "")}${esc(stmt.venue.address || "")}</div>
    </div>
  </div>
  <h1>${esc(monthLabel)} 結算</h1>
  <div class="muted">單號：VS-${esc(stmt.month)}-${esc(String(stmt.venue.id).slice(0, 8))} · 發出日期：${esc(String(stmt.generated_at).slice(0, 10))}</div>

  <div class="tot">
    <div class="box"><div class="k">租場次數</div><div class="v">${stmt.totals.count}</div></div>
    <div class="box"><div class="k">總時數</div><div class="v">${stmt.totals.hours}</div></div>
    <div class="box"><div class="k">毛收入</div><div class="v">${hkd(stmt.totals.gross)}</div></div>
    <div class="box"><div class="k">平台佣金</div><div class="v">${hkd(stmt.totals.commission)}</div></div>
    <div class="box net"><div class="k">場地實收</div><div class="v">${hkd(stmt.payable_to_venue != null ? stmt.payable_to_venue : stmt.totals.net)}</div></div>
  </div>
  ${stmt.penalties && stmt.penalties.length ? `<div class="muted" style="margin-top:10px">※ 已扣除罰款／手續費 ${hkd(stmt.penalties_total)}${stmt.carry_forward > 0 ? `，另有 ${hkd(stmt.carry_forward)} 結轉下月` : ""}</div>` : ""}

  <h1 style="font-size:15px">租場明細</h1>
  ${
    stmt.rentals.length
      ? `<table><thead><tr><th>日期</th><th>時間</th><th>教練</th><th style="text-align:right">金額</th><th style="text-align:right">費率</th><th style="text-align:right">佣金</th><th style="text-align:right">實收</th></tr></thead><tbody>${rowHtml}</tbody></table>`
      : '<div class="muted" style="margin-top:10px">本月暫無已確認租場。</div>'
  }

  ${
    stmt.byCoach.length
      ? `<h1 style="font-size:15px">按教練統計</h1><table><thead><tr><th>教練</th><th style="text-align:right">次數</th><th style="text-align:right">毛收入</th><th style="text-align:right">佣金</th><th style="text-align:right">實收</th></tr></thead><tbody>${coachRowHtml}</tbody></table>`
      : ""
  }

  ${stmt.penalties && stmt.penalties.length ? `<h1 style="font-size:15px">罰款／手續費</h1><table><thead><tr><th>日期</th><th>類型</th><th>說明</th><th style="text-align:right">金額</th></tr></thead><tbody>` + stmt.penalties.map((p) => `<tr><td>${esc(p.date_hkt)}</td><td>${esc(p.type === "venue_failure_200pct" ? "未能提供場地 (200%)" : p.type === "tenant_cancel_forfeit" ? "租客取消" : p.type)}</td><td>${esc(p.note)}</td><td style="text-align:right">${hkd(p.amount)}</td></tr>`).join("") + `</tbody></table>` : ""}

  ${stmt.pending_count ? `<div class="muted" style="margin-top:12px">※ 另有 ${stmt.pending_count} 個待確認租場未計入本月。</div>` : ""}

  <div class="note">
    本結算以香港時間（GMT+8）劃月，只計已確認／已完成之租場。<br>
    佣金率：${(stmt.commission_rate * 100).toFixed(0)}%（依場地佣金計劃）。如有疑問請回覆此電郵。<br>
    ZenPass 禪流 · 香港康樂及體育有限公司
  </div>
</div></body></html>`;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * 電郵月結單俾場地
 * @returns {Promise<{sent:boolean,error?:string}>}
 */
async function emailStatement(venueId, monthStr) {
  const stmt = buildStatement(venueId, monthStr);
  if (!stmt.venue.email) return { sent: false, error: "場地未設定電郵" };
  const { sendEmail } = require("./email");
  const monthLabel = `${stmt.month.slice(0, 4)} 年 ${parseInt(stmt.month.slice(5), 10)} 月`;
  const subject = `【ZenPass】${monthLabel} 場地月結單 — ${stmt.venue.name}`;
  const html = renderStatementHtml(stmt);
  const r = await sendEmail(stmt.venue.email, subject, html);
  return r;
}

module.exports = { buildStatement, renderStatementHtml, emailStatement, monthBounds, prevMonthKey };
