/* ZenPass — 合作夥伴合規承諾書（區塊式電子簽署）
 * 用法：頁面加入 <script src="assets/partner-agreement.js?v=1"></script>
 * 未簽署時會以全頁遮罩阻擋，簽署後才可使用後台。
 * 2026-10-25
 */
(function () {
  const CLAUSES = [
    ["獨立合約人身分", "確認雙方為獨立商業合作關係，絕不構成任何僱傭、合夥或代理關係。合作方須自行承擔其稅務申報、強積金及個人意外保險，平台不承擔任何僱主責任或工傷補償。"],
    ["專業資質與合法經營", "保證具備開辦相關體育項目之認可專業資格／合法營運牌照，場地設施完全符合香港特區各項公眾安全及消防法規；保證所有指派導師無性罪行定罪紀錄。"],
    ["自備保險及法律彌償", "合作方已自行購買或按需要安排合適之公眾責任保險（Public Liability Insurance）。若因合作方之教學疏忽、指引不當、意外或場地設施失修導致任何第三者人身傷亡、財物損毀或索償，合作方須獨自承擔全部民事及法律責任，並承諾全額彌償 ZenPass 因此所遭受之一切損害及律師訴訟費用。"],
    ["誠實運作守則", "嚴格遵守平台預約、出席及取消機制，不以任何形式蓄意引導學員繞過平台進行私下交易。"],
    ["最終決定權", "香港康樂及體育有限公司保留隨時核實資質、因違規行為終止合作以及對本協議之最終修改及解釋權利。"],
  ];

  function ensureStyle() {
    if (document.getElementById("zpPaStyle")) return;
    const css = `
    .zp-pa-mask{position:fixed;inset:0;background:rgba(8,13,24,.86);backdrop-filter:blur(8px);z-index:10060;display:flex;align-items:center;justify-content:center;padding:16px}
    .zp-pa-card{width:100%;max-width:460px;max-height:92vh;overflow:auto;background:#fff;color:#0f172a;border-radius:20px;padding:22px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
    .zp-pa-card h3{margin:6px 0 4px;font-size:18px}
    .zp-pa-sub{font-size:12px;color:#64748b;line-height:1.6;margin:0 0 12px}
    .zp-pa-ol{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;font-size:12px;line-height:1.8;color:#334155;max-height:210px;overflow:auto}
    .zp-pa-ol b{color:#0f172a}
    .zp-pa-lbl{display:block;font-size:12.5px;font-weight:700;color:#334155;margin:12px 0 5px}
    .zp-pa-in{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #cbd5e1;border-radius:11px;font:inherit;font-size:15px}
    .zp-pa-chk{display:flex;gap:9px;align-items:flex-start;font-size:12.5px;line-height:1.6;margin:12px 0}
    .zp-pa-btn{width:100%;border:0;border-radius:12px;padding:13px;font:inherit;font-weight:800;font-size:14.5px;background:linear-gradient(135deg,#ff6b35,#e2571f);color:#fff;margin-top:6px}
    .zp-pa-msg{text-align:center;font-size:12.5px;color:#b91c1c;margin-top:8px;min-height:16px}
    .zp-pa-out{font-size:11px;color:#94a3b8;text-align:center;margin-top:10px;line-height:1.5}
    `;
    const s = document.createElement("style");
    s.id = "zpPaStyle"; s.textContent = css; document.head.appendChild(s);
  }

  function render(onSigned) {
    ensureStyle();
    const mask = document.createElement("div");
    mask.className = "zp-pa-mask";
    mask.innerHTML = `
      <div class="zp-pa-card" role="dialog" aria-modal="true" aria-label="合作夥伴合規承諾書">
        <div style="font-size:32px">🤝</div>
        <h3>合作夥伴合規及免責承諾書</h3>
        <p class="zp-pa-sub">首次使用合作夥伴後台前，必須閱讀並電子簽署以下聲明（版本 v2026.1）。簽署紀錄會連同 IP 及時間保存作法律存證。</p>
        <div class="zp-pa-ol">
          ${CLAUSES.map(([t, d], i) => `<div style="margin-bottom:8px"><b>${i + 1}. ${t}：</b>${d}</div>`).join("")}
        </div>
        <label class="zp-pa-lbl">法定負責人 / 本人全名 *</label>
        <input class="zp-pa-in" id="zpPaName" placeholder="請輸入身份證上全名" maxlength="60" />
        <label class="zp-pa-chk"><input type="checkbox" id="zpPaAgree" style="width:18px;height:18px;margin-top:2px" />
          <span>本人已閱讀、明白並同意上述全部條款，並確認有權代表本人／所屬機構簽署。</span></label>
        <button class="zp-pa-btn" id="zpPaGo">簽署並開通後台</button>
        <div class="zp-pa-msg" id="zpPaMsg"></div>
        <div class="zp-pa-out">如你唔同意，可以返回上一頁；未簽署將無法使用排班、收款及結算功能。</div>
      </div>`;
    document.body.appendChild(mask);
    document.getElementById("zpPaGo").onclick = async () => {
      const name = (document.getElementById("zpPaName").value || "").trim();
      const agreed = document.getElementById("zpPaAgree").checked;
      const msg = document.getElementById("zpPaMsg");
      if (!name) { msg.textContent = "請輸入法定負責人全名"; return; }
      if (!agreed) { msg.textContent = "請勾選同意條款"; return; }
      const btn = document.getElementById("zpPaGo");
      btn.disabled = true; btn.textContent = "簽署中…";
      const r = await window.api.post("/agreements/partner", { signed_name: name, agreed: true });
      btn.disabled = false; btn.textContent = "簽署並開通後台";
      if (r.ok) {
        mask.remove();
        try { onSigned && onSigned(); } catch (e) {}
      } else {
        msg.textContent = (r.data && r.data.error) || "簽署失敗，請稍後再試";
      }
    };
  }

  window.zpRequirePartnerAgreement = async function (onSigned) {
    try {
      if (!window.api || !api.getUser || !api.getUser()) return; // 未登入由頁面自己處理
      const r = await api.get("/agreements/partner");
      if (r.ok && r.data && r.data.signed) return;
      render(onSigned);
    } catch (e) {
      // 網絡問題唔好鎖死用戶
    }
  };
})();
