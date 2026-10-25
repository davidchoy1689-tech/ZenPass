/* ZenPass — B2B 一頁式簡介（純前端生成 + 留資）
 * 用法：頁面引入本檔，並加 <button onclick="openBrochureModal('corporate'|'school')">。
 * 下載方式：開新視窗產生 A4 版面，再叫 print()（用戶可「儲存為 PDF」，零依賴）。
 * 2026-10-25
 */
(function () {
  const BRAND = "#ff6b35";
  const WA = "85290335538";

  const CONTENT = {
    corporate: {
      title: "企業健康與 Team Building 方案",
      kicker: "2026 · ZENPASS 禪流",
      tagline: "提升團隊身心健康，同時凝聚士氣",
      bullets: [
        ["🏅 持證教練到會", "教練親身到公司或指定場地授課，毋須員工外出"],
        ["🧘 多元運動選擇", "瑜伽、伸展、新興運動（芬蘭木柱／地板冰壺／布袋球）、團隊競技"],
        ["💳 企業 Credits 制度", "公司先購 Credits，員工自助預約，行政成本最低"],
        ["📊 參與報告", "每月出席率、參與人數、滿意度報告，方便 HR 匯報"],
      ],
      flow: ["查詢", "諮詢（了解人數／目標）", "試辦一場", "正式推行"],
      forms: ["Lunch & Learn 午間班", "Team Building 半日活動", "部門健康挑戰賽", "年度健康日攤位"],
      procurement: "可開報價單／Invoice，接受公司支票、銀行轉帳、信用卡。",
      audience: "10–500 人企業團隊，任何運動底子均可。",
    },
    school: {
      title: "學校新興運動 ECA 方案",
      kicker: "2026 · ZENPASS 禪流",
      tagline: "ECA 興趣班 · 試後活動 · 陸運會同樂日",
      bullets: [
        ["🏫 持證教練到校", "具學校教學經驗，熟悉課堂管理"],
        ["🎒 自備全套專業裝備", "學校毋須採購器材，教練帶齊到校"],
        ["👶 小一至中六適用", "按年齡調整難度、器材與規則"],
        ["🧾 支援學校採購流程", "可開報價單／Invoice，接受支票、轉帳"],
      ],
      flow: ["查詢", "諮詢（級別／人數／場地）", "免費試堂", "正式開展"],
      forms: ["ECA 興趣班（整學期）", "試後活動／全方位學習日", "陸運會／同樂日攤位", "教師工作坊"],
      procurement: "提供報價單及 Invoice，配合校方採購與審批程序；活動設風險評估及安全指引。",
      audience: "小一至中六，每班 12–30 人（可按校方需要調整）。",
    },
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ===== 彈窗 ===== */
  function ensureModal() {
    if (document.getElementById("zpBrochureModal")) return;
    const el = document.createElement("div");
    el.id = "zpBrochureModal";
    el.className = "zp-br-overlay";
    el.innerHTML = `
      <div class="zp-br-card" role="dialog" aria-modal="true" aria-label="索取方案簡介">
        <button class="zp-br-x" type="button" aria-label="關閉">✕</button>
        <div style="font-size:34px;line-height:1">📄</div>
        <h3 id="zpBrTitle">索取方案簡介（1 頁 PDF）</h3>
        <p class="zp-br-desc">輸入資料即可即時下載；我哋亦會用 WhatsApp 跟進報價同檔期。</p>
        <label class="zp-br-lbl" id="zpBrOrgLbl">機構名稱 *</label>
        <input class="zp-br-in" id="zpBrOrg" placeholder="例如：國泰航空 / 拔萃小學" />
        <label class="zp-br-lbl">公務電郵 *</label>
        <input class="zp-br-in" id="zpBrEmail" type="email" placeholder="name@company.com" />
        <label class="zp-br-lbl">WhatsApp 電話（可選）</label>
        <input class="zp-br-in" id="zpBrPhone" inputmode="numeric" placeholder="9123 4567" />
        <button class="zp-br-go" type="button" id="zpBrGo">🚀 即刻下載 PDF 簡介</button>
        <div style="text-align:center;margin-top:8px">
          <button type="button" class="zp-br-skip" id="zpBrSkip">免填資料，直接預覽下載</button>
        </div>
        <div class="zp-br-msg" id="zpBrMsg"></div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    el.querySelector(".zp-br-x").onclick = close;
    el.querySelector("#zpBrGo").onclick = submit;
    el.querySelector("#zpBrSkip").onclick = () => { openPrint(); };
  }

  let CURRENT = "corporate";
  function close() { const m = document.getElementById("zpBrochureModal"); if (m) { m.classList.remove("on"); m.setAttribute("aria-hidden", "true"); } }

  window.openBrochureModal = function (type) {
    CURRENT = type === "school" ? "school" : "corporate";
    ensureModal();
    const c = CONTENT[CURRENT];
    document.getElementById("zpBrTitle").textContent = CURRENT === "school"
      ? "索取 學校新興運動 ECA 簡介（1 頁 PDF）"
      : "索取 企業健康與 Team Building 簡介（1 頁 PDF）";
    document.getElementById("zpBrOrgLbl").textContent = CURRENT === "school" ? "學校名稱 *" : "公司名稱 *";
    document.getElementById("zpBrMsg").textContent = "";
    const m = document.getElementById("zpBrochureModal");
    m.classList.add("on"); m.setAttribute("aria-hidden", "false");
  };

  async function submit() {
    const org = document.getElementById("zpBrOrg").value.trim();
    const email = document.getElementById("zpBrEmail").value.trim();
    const phone = document.getElementById("zpBrPhone").value.replace(/\D/g, "").slice(-8);
    const msg = document.getElementById("zpBrMsg");
    if (!org || !email) { msg.textContent = "請填機構名稱同電郵"; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "電郵格式不正確"; return; }
    msg.textContent = "處理中…";
    // 先開新視窗（避免 popup 被封）
    const w = openPrint();
    // 背景記錄 lead（失敗不影響下載）
    try {
      const body = CURRENT === "school"
        ? { school_name: org, contact_name: org, contact_email: email, contact_phone: phone, sports_of_interest: "PDF 簡介下載", message: "由網站下載學校 ECA 簡介（留資）" }
        : { company_name: org, contact_name: org, contact_email: email, contact_phone: phone, activities: "PDF 簡介下載", message: "由網站下載企業方案簡介（留資）" };
      const path = CURRENT === "school" ? "/api/school/inquiry" : "/api/corporate/inquiry";
      fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    } catch (e) {}
    try { localStorage.setItem("zp_b2b_lead", JSON.stringify({ type: CURRENT, org, email, phone, at: new Date().toISOString() })); } catch (e) {}
    msg.textContent = "✅ 已開始下載，多謝！";
    setTimeout(close, 600);
    return w;
  }

  /* ===== 產生 1 頁 A4（可列印／儲存為 PDF） ===== */
  function openPrint() {
    const c = CONTENT[CURRENT];
    const html = `<!doctype html><html lang="zh-HK"><head><meta charset="utf-8" />
<title>ZenPass 禪流 — ${esc(c.title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "PingFang HK","Noto Sans TC",-apple-system,sans-serif; color:#0f172a; margin:0; }
  .wrap { max-width: 760px; margin: 0 auto; }
  .top { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid ${BRAND}; padding-bottom:10px; }
  .brand { font-size:13px; font-weight:800; letter-spacing:2px; color:${BRAND}; }
  h1 { font-size:22px; margin:6px 0 4px; }
  .tag { font-size:12.5px; color:#475569; }
  .meta { font-size:11px; color:#64748b; text-align:right; line-height:1.6; }
  h2 { font-size:13.5px; margin:16px 0 8px; padding-left:8px; border-left:4px solid ${BRAND}; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .box { border:1px solid #e2e8f0; border-radius:10px; padding:9px 11px; font-size:11.5px; line-height:1.5; }
  .box b { display:block; font-size:12.5px; margin-bottom:2px; }
  .flow { display:flex; gap:6px; font-size:11.5px; }
  .flow div { flex:1; background:#fff7ed; border:1px solid #fed7aa; border-radius:9px; padding:8px; text-align:center; }
  ul { margin:6px 0 0; padding-left:18px; font-size:11.5px; line-height:1.7; }
  .note { font-size:11px; color:#475569; background:#f8fafc; border-radius:10px; padding:9px 11px; line-height:1.6; }
  .foot { margin-top:14px; border-top:1px dashed #cbd5e1; padding-top:8px; font-size:10.5px; color:#64748b; display:flex; justify-content:space-between; }
  .cta { display:inline-block; margin-top:10px; background:${BRAND}; color:#fff; font-weight:800; font-size:12px; padding:8px 14px; border-radius:8px; }
</style></head>
<body><div class="wrap">
  <div class="top">
    <div>
      <div class="brand">ZENPASS 禪流</div>
      <h1>${esc(c.title)}</h1>
      <div class="tag">${esc(c.tagline)}</div>
    </div>
    <div class="meta">${esc(c.kicker)}<br>香港康樂及體育有限公司<br>2387 0724 · support@zenpass.hk</div>
  </div>

  <h2>方案亮點</h2>
  <div class="grid">
    ${c.bullets.map(([t, d]) => `<div class="box"><b>${esc(t)}</b>${esc(d)}</div>`).join("")}
  </div>

  <h2>合作流程（4 步）</h2>
  <div class="flow">${c.flow.map((s, i) => `<div><b>${i + 1}</b><br>${esc(s)}</div>`).join("")}</div>

  <h2>可安排形式</h2>
  <ul>${c.forms.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>

  <h2>採購與行政</h2>
  <div class="note">${esc(c.procurement)}</div>

  <h2>適合對象</h2>
  <div class="note">${esc(c.audience)}</div>

  <h2>下一步</h2>
  <div class="note">想睇實際檔期同報價，WhatsApp 我哋最快：<b>+852 9033 5538</b>（預填查詢即可）。<br>
  亦可電郵 support@zenpass.hk，我哋 1 個工作日內回覆。</div>

  <div class="foot">
    <span>ZenPass 禪流 · 新興運動體驗平台</span>
    <span>此簡介由網站即時生成 · 2026</span>
  </div>
  <div style="text-align:center"><span class="cta">www.zenpass.hk · WhatsApp +852 9033 5538</span></div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},400);}<\/script>
</body></html>`;

    const w = window.open("", "_blank");
    if (!w) { alert("請允許彈出視窗以下載簡介"); return null; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    return w;
  }

  window.brochureDirectDownload = openPrint;
})();

/* ===== 樣式（注入一次） ===== */
(function injectStyle() {
  if (document.getElementById("zpBrStyle")) return;
  const css = `
  .zp-br-cta{display:inline-flex;flex-direction:column;align-items:center;gap:5px;margin:10px 0 6px}
  .zp-br-btn{display:inline-flex;align-items:center;gap:8px;background:#fff;color:#0f172a;border:1.5px solid var(--brand-500,#ff6b35);
    padding:11px 18px;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(255,107,53,.15)}
  .zp-br-btn:active{transform:scale(.985)}
  .zp-br-tip{font-size:11px;color:var(--text-muted,#64748b)}
  .zp-br-overlay{position:fixed;inset:0;background:rgba(15,23,42,.7);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;z-index:99999;opacity:0;pointer-events:none;transition:opacity .2s}
  .zp-br-overlay.on{opacity:1;pointer-events:auto}
  .zp-br-card{width:100%;max-width:400px;background:#fff;border-radius:20px;padding:22px;position:relative;box-shadow:0 20px 40px rgba(0,0,0,.22);color:#0f172a;max-height:90vh;overflow:auto}
  .zp-br-x{position:absolute;top:14px;right:14px;background:#f1f5f9;border:0;width:30px;height:30px;border-radius:50%;color:#64748b;font-size:13px}
  .zp-br-card h3{font-size:17px;margin:8px 0 6px}
  .zp-br-desc{font-size:12.5px;color:#64748b;line-height:1.55;margin:0 0 12px}
  .zp-br-lbl{display:block;font-size:12px;font-weight:700;color:#334155;margin:10px 0 4px}
  .zp-br-in{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;font:inherit}
  .zp-br-in:focus{outline:none;border-color:#ff6b35;box-shadow:0 0 0 3px rgba(255,107,53,.15)}
  .zp-br-go{width:100%;margin-top:14px;background:linear-gradient(135deg,#ff6b35,#e2571f);color:#fff;border:0;padding:13px;border-radius:12px;font-size:14.5px;font-weight:800}
  .zp-br-skip{background:none;border:0;font-size:12px;color:#94a3b8;text-decoration:underline}
  .zp-br-msg{font-size:12.5px;color:#c2410c;text-align:center;margin-top:8px;min-height:16px}
  `;
  const s = document.createElement("style");
  s.id = "zpBrStyle"; s.textContent = css;
  document.head.appendChild(s);
})();

/* ===== 自動加 CTA（如頁面未手動放） ===== */
window.zpBrochureMount = function (type, anchorSelector) {
  const anchorEl = anchorSelector ? document.querySelector(anchorSelector) : null;
  if (!anchorEl && document.querySelector("[data-zp-brochure]")) return;
  const box = document.createElement("div");
  box.className = "zp-br-cta";
  box.setAttribute("data-zp-brochure", type);
  box.innerHTML = type === "school"
    ? `<button class="zp-br-btn" type="button">📥 下載 學校 ECA 方案簡介（PDF）</button><span class="zp-br-tip">附採購流程、教練資格及保險說明</span>`
    : `<button class="zp-br-btn" type="button">📥 下載 企業健康與 Team Building 簡介（PDF）</button><span class="zp-br-tip">適合呈交 HR／福委會審批</span>`;
  box.querySelector("button").onclick = () => window.openBrochureModal(type);
  if (anchorEl) anchorEl.insertAdjacentElement("afterend", box);
  else document.querySelector(".wrap")?.prepend(box);
};
