/* ZenPass — 完課證書渲染（1080×1920，可 2× 高清印製）
 * 香港證書慣例：中英對照、茲證明、授權簽署 + 公司圓章、簽發日期、證書編號、防偽 QR
 * 通用：適用任何課程／活動（運動、企業培訓、工作坊）
 * 用法：await zpMakeCertificate({ studentName, classTitle, levelLabel, hours, coachName, coachStarred,
 *        dateStr, issueDate, serial, verifyUrl, sportCode, scale })
 * 回傳 { dataUrl, blob, filename }
 * 2026-10-27
 */
(function () {
  const GOLD = "#C9A227";
  const GOLD_LIGHT = "#E8CE7A";
  const CREAM = "#F7F4EC";
  const MUTED = "#B9C2CE";
  const DIM = "#8E9AA8";
  const CHOP = "#B0342B";
  const F = "-apple-system,'PingFang HK','Noto Sans TC','Microsoft JhengHei',sans-serif";
  const SERIF = "'Times New Roman','Songti SC','Noto Serif TC',Georgia,serif";

  function loadImage(src) {
    return new Promise((res) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function letterspaced(ctx, text, x, y, spacing, align) {
    const chars = String(text).split("");
    const widths = chars.map((c) => ctx.measureText(c).width + spacing);
    const total = widths.reduce((a, b) => a + b, 0) - spacing;
    let cx = align === "center" ? x - total / 2 : x;
    chars.forEach((c, i) => {
      ctx.fillText(c, cx, y);
      cx += widths[i];
    });
  }

  function fitText(ctx, text, maxWidth, startSize, weight, family) {
    let size = startSize;
    do {
      ctx.font = weight + " " + size + "px " + (family || F);
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 2;
    } while (size > 16);
    return size;
  }

  function cleanTitle(title) {
    let t = String(title || "");
    t = t.replace(/[（(][^）)]*(?:首發|週末)[^）)]*[）)]/g, " ");
    t = t.replace(/(?:週末)?首發(?:班|課程)?/g, " ");
    return t.replace(/\s{2,}/g, " ").trim();
  }

  /** 圓形公司章（香港慣例：紅色、機構名、註明「公司印章」） */
  function drawChop(ctx, x, y, r) {
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.strokeStyle = CHOP;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r - 7, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = CHOP;
    ctx.textAlign = "center";
    ctx.font = "600 11px " + F;
    ctx.fillText("香港康樂及體育", x, y - 10);
    ctx.fillText("有限公司", x, y + 6);
    ctx.font = "600 9px " + SERIF;
    ctx.fillText("COMPANY CHOP", x, y + 22);
    ctx.fillStyle = CHOP;
    ctx.fillRect(x - 26, y + 28, 52, 1);
    ctx.textAlign = "left";
    ctx.restore();
  }

  window.zpMakeCertificate = async function (d) {
    d = d || {};
    const W = 1080, H = 1920, S = Math.max(1, Math.min(Number(d.scale) || 1, 3));
    const cv = document.createElement("canvas");
    cv.width = W * S; cv.height = H * S;
    const ctx = cv.getContext("2d");
    ctx.scale(S, S);

    /* 底色 */
    const g = ctx.createLinearGradient(0, 0, W * 0.7, H);
    g.addColorStop(0, "#0B132B");
    g.addColorStop(0.55, "#0A2F35");
    g.addColorStop(1, "#064E3B");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const gl = ctx.createRadialGradient(W / 2, 580, 60, W / 2, 580, 620);
    gl.addColorStop(0, "rgba(201,162,39,.13)");
    gl.addColorStop(1, "rgba(201,162,39,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(0, 0, W, H);

    /* 雙層金邊 */
    ctx.strokeStyle = GOLD; ctx.lineWidth = 5;
    ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.strokeStyle = "rgba(201,162,39,.42)"; ctx.lineWidth = 1.4;
    ctx.strokeRect(58, 58, W - 116, H - 116);

    /* 發證機構（香港證書慣例：機構名置頂） */
    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = "600 22px " + SERIF;
    letterspaced(ctx, "ZENPASS", W / 2, 138, 10, "center");
    ctx.fillStyle = MUTED;
    ctx.font = "400 15px " + F;
    ctx.textAlign = "center";
    ctx.fillText("香港康樂及體育有限公司", W / 2, 166);
    ctx.fillStyle = DIM;
    ctx.font = "400 12px " + SERIF;
    letterspaced(ctx, "HONG KONG LEISURE AND FITNESS COMPANY LIMITED", W / 2, 186, 1.2, "center");
    ctx.fillStyle = "rgba(201,162,39,.55)";
    ctx.fillRect(W / 2 - 44, 204, 88, 1.4);
    ctx.textAlign = "left";

    /* 標題 */
    ctx.fillStyle = CREAM;
    ctx.font = "400 36px " + SERIF;
    letterspaced(ctx, "CERTIFICATE OF COMPLETION", W / 2, 262, 6.5, "center");

    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = "500 26px " + F;
    letterspaced(ctx, "完 課 證 明 書", W / 2, 306, 2, "center");

    ctx.fillStyle = MUTED;
    ctx.font = "400 16px " + F;
    ctx.textAlign = "center";
    ctx.fillText("出席及課程完成紀錄 · Record of Attendance and Completion", W / 2, 340);
    ctx.textAlign = "left";

    /* ZP 字標 */
    const cx = W / 2, cy = 512, R = 98;
    ctx.beginPath(); ctx.arc(cx, cy, R + 13, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(201,162,39,.07)"; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R - 11, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(201,162,39,.38)"; ctx.lineWidth = 1.1; ctx.stroke();

    const goldGrad = ctx.createLinearGradient(cx - 56, cy - 56, cx + 56, cy + 56);
    goldGrad.addColorStop(0, "#F3E3A8");
    goldGrad.addColorStop(0.5, "#C9A227");
    goldGrad.addColorStop(1, "#E8CE7A");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = goldGrad;
    ctx.font = "700 80px " + SERIF;
    letterspaced(ctx, "ZP", cx, cy + 2, 6, "center");
    ctx.strokeStyle = "rgba(201,162,39,.55)"; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(cx - 28, cy + 52); ctx.lineTo(cx + 28, cy + 52); ctx.stroke();
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

    if (d.levelLabel) {
      ctx.textAlign = "center";
      ctx.fillStyle = GOLD_LIGHT;
      ctx.font = "600 22px " + F;
      ctx.fillText(String(d.levelLabel), cx, cy + R + 60);
      ctx.textAlign = "left";
    }

    /* 茲證明 */
    ctx.textAlign = "center";
    ctx.fillStyle = MUTED; ctx.font = "400 20px " + F;
    ctx.fillText("茲 證 明", W / 2, 782);
    ctx.fillStyle = DIM; ctx.font = "400 12.5px " + SERIF;
    letterspaced(ctx, "THIS IS TO CERTIFY THAT", W / 2, 806, 2.4, "center");

    ctx.fillStyle = CREAM;
    const nameSize = fitText(ctx, String(d.studentName || ""), 820, 54, "600");
    ctx.font = "600 " + nameSize + "px " + F;
    ctx.fillText(String(d.studentName || ""), W / 2, 872);

    ctx.strokeStyle = "rgba(201,162,39,.45)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(300, 902); ctx.lineTo(780, 902); ctx.stroke();

    ctx.fillStyle = MUTED; ctx.font = "400 18px " + F;
    ctx.fillText("已完成下列課程，並達指定出席要求", W / 2, 944);
    ctx.fillStyle = DIM; ctx.font = "400 12px " + SERIF;
    letterspaced(ctx, "HAS SATISFACTORILY ATTENDED AND COMPLETED THE FOLLOWING PROGRAMME", W / 2, 966, 1.1, "center");

    ctx.fillStyle = CREAM;
    const certTitle = cleanTitle(d.classTitle) || String(d.classTitle || "");
    const titleSize = fitText(ctx, certTitle, 860, 32, "600");
    ctx.font = "600 " + titleSize + "px " + F;
    ctx.fillText(certTitle, W / 2, 1012);
    ctx.textAlign = "left";

    /* 資料欄（中英對照） */
    const bx = 100, by = 1064, bw = W - 200, bh = 300;
    ctx.fillStyle = "rgba(255,255,255,.045)";
    roundRect(ctx, bx, by, bw, bh, 18); ctx.fill();
    ctx.strokeStyle = "rgba(201,162,39,.26)"; ctx.lineWidth = 1.2;
    roundRect(ctx, bx, by, bw, bh, 18); ctx.stroke();

    const rows = [
      ["修讀時數", "CONTACT HOURS", (Number(d.hours) || 0).toFixed(1) + " 小時 / hours"],
      ["執教導師", "INSTRUCTOR", (d.coachStarred ? "星級導師認證 · " : "") + (d.coachName || "ZenPass 認可導師")],
      ["完成日期", "DATE OF COMPLETION", d.dateStr || ""],
      ["簽發日期", "DATE OF ISSUE", d.issueDate || d.dateStr || ""],
    ];
    rows.forEach((r, i) => {
      const y = by + 60 + i * 66;
      ctx.fillStyle = MUTED; ctx.font = "500 17.5px " + F;
      ctx.fillText(r[0], bx + 36, y);
      ctx.fillStyle = DIM; ctx.font = "400 10px " + SERIF;
      letterspaced(ctx, r[1], bx + 36, y + 17, 1.2, "left");

      ctx.fillStyle = CREAM; ctx.font = "600 21px " + F;
      ctx.textAlign = "right";
      ctx.fillText(String(r[2]), bx + bw - 36, y + 8);
      ctx.textAlign = "left";
      if (i < 3) {
        ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bx + 36, y + 28); ctx.lineTo(bx + bw - 36, y + 28); ctx.stroke();
      }
    });

    /* 授權簽署 + 公司章 */
    ctx.fillStyle = MUTED; ctx.font = "500 15px " + F;
    ctx.fillText("授權簽署 Authorised Signature", 100, 1428);
    ctx.strokeStyle = "rgba(201,162,39,.5)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(100, 1486); ctx.lineTo(430, 1486); ctx.stroke();
    ctx.fillStyle = CREAM; ctx.font = "600 17px " + F;
    ctx.fillText("課程總監", 100, 1512);
    ctx.fillStyle = DIM; ctx.font = "400 12px " + SERIF;
    ctx.fillText("Programme Director", 100, 1532);
    ctx.fillStyle = MUTED; ctx.font = "400 12.5px " + F;
    ctx.fillText("ZenPass 禪流", 100, 1556);
    drawChop(ctx, 452, 1478, 62);

    /* 證書編號 */
    ctx.fillStyle = MUTED; ctx.font = "500 14px " + F;
    ctx.fillText("證書編號 Certificate No.", 100, 1620);
    ctx.fillStyle = GOLD_LIGHT; ctx.font = "600 19px " + F;
    ctx.fillText(String(d.serial || ""), 100, 1646);
    ctx.fillStyle = DIM; ctx.font = "400 11.5px " + F;
    ctx.fillText("此編號可於 zenpass.hk/verify.html 核實", 100, 1668);

    /* QR */
    const qs = 168, qx = W - 100 - qs, qy = 1458;
    try {
      const res = await fetch("/api/qr?text=" + encodeURIComponent(d.verifyUrl || location.origin) + "&size=420");
      const j = await res.json();
      if (j && j.success && j.data_url) {
        const qr = await loadImage(j.data_url);
        if (qr) {
          ctx.fillStyle = "#fff";
          roundRect(ctx, qx - 10, qy - 10, qs + 20, qs + 20, 12); ctx.fill();
          ctx.drawImage(qr, qx, qy, qs, qs);
        }
      }
    } catch (e) {}

    ctx.textAlign = "center";
    ctx.fillStyle = MUTED; ctx.font = "400 12.5px " + F;
    ctx.fillText("掃碼驗證真偽 / Scan to verify", qx + qs / 2, qy + qs + 28);
    ctx.textAlign = "left";

    /* 聲明（中英） */
    ctx.fillStyle = MUTED; ctx.font = "400 12.5px " + F;
    ctx.fillText("本證書由 ZenPass 禪流（香港康樂及體育有限公司）簽發，可於 zenpass.hk/verify.html 核實。", 100, 1770);
    ctx.fillStyle = DIM; ctx.font = "400 11px " + F;
    ctx.fillText("Issued by ZenPass (Hong Kong Leisure and Fitness Company Limited). Verify at zenpass.hk/verify.html.", 100, 1792);
    ctx.fillStyle = MUTED; ctx.font = "400 12.5px " + F;
    ctx.fillText("本證書僅證明出席及課程完成紀錄，並不構成任何專業資格或法定認可。", 100, 1820);
    ctx.fillStyle = DIM; ctx.font = "400 11px " + F;
    ctx.fillText("It records attendance and completion only and does not confer any professional or statutory qualification.", 100, 1842);

    ctx.fillStyle = GOLD; ctx.fillRect(40, H - 40, W - 80, 5);

    const dataUrl = cv.toDataURL("image/jpeg", 0.94);
    const filename = "ZenPass-Certificate-" + (d.serial || Date.now()) + ".jpg";
    let blob = null;
    try {
      blob = await new Promise((res) => cv.toBlob((b) => res(b), "image/jpeg", 0.94));
    } catch (e) {}
    return { dataUrl, blob, filename };
  };
})();
