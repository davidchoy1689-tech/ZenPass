/* ZenPass — 完課證書渲染（1080×1920，可 2× 高清印製）
 * 通用版：適用任何課程／活動（運動、企業培訓、工作坊）
 * 正式風：無 emoji、襯線英文標題、ZP 金色字標、中英對照、防偽章 + QR 驗證
 * 用法：await zpMakeCertificate({ studentName, classTitle, levelLabel, hours, coachName, coachStarred,
 *        dateStr, serial, verifyUrl, sportCode, scale, certType, roleLabel })
 * 回傳 { dataUrl, blob, filename }
 * 2026-10-27
 */
(function () {
  const GOLD = "#C9A227";
  const GOLD_LIGHT = "#E8CE7A";
  const CREAM = "#F7F4EC";
  const MUTED = "#B9C2CE";
  const DIM = "#8E9AA8";
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

  /** 只顯示正式課程名稱：去掉「（週末首發）」等推廣字眼 */
  function cleanTitle(title) {
    let t = String(title || "");
    t = t.replace(/[（(][^）)]*(?:首發|週末)[^）)]*[）)]/g, " ");
    t = t.replace(/(?:週末)?首發(?:班|課程)?/g, " ");
    return t.replace(/\s{2,}/g, " ").trim();
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

    const gl = ctx.createRadialGradient(W / 2, 600, 60, W / 2, 600, 640);
    gl.addColorStop(0, "rgba(201,162,39,.13)");
    gl.addColorStop(1, "rgba(201,162,39,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(0, 0, W, H);

    /* 雙層金邊 */
    ctx.strokeStyle = GOLD; ctx.lineWidth = 5;
    ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.strokeStyle = "rgba(201,162,39,.42)"; ctx.lineWidth = 1.4;
    ctx.strokeRect(58, 58, W - 116, H - 116);

    /* 品牌 */
    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = "600 23px " + SERIF;
    letterspaced(ctx, "ZENPASS", W / 2, 146, 12, "center");
    ctx.fillStyle = "rgba(201,162,39,.55)";
    ctx.fillRect(W / 2 - 44, 166, 88, 1.4);

    /* 主標題（英文 + 中文對照） */
    ctx.textAlign = "left";
    ctx.fillStyle = CREAM;
    ctx.font = "400 38px " + SERIF;
    letterspaced(ctx, "CERTIFICATE OF COMPLETION", W / 2, 228, 7, "center");

    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = "500 27px " + F;
    letterspaced(ctx, "完 課 證 明 書", W / 2, 276, 2, "center");

    ctx.fillStyle = MUTED;
    ctx.font = "400 17px " + F;
    ctx.textAlign = "center";
    ctx.fillText("出席及課程完成紀錄 · Record of Attendance and Completion", W / 2, 312);
    ctx.textAlign = "left";

    /* ZP 字標 */
    const cx = W / 2, cy = 500, R = 104;
    ctx.beginPath(); ctx.arc(cx, cy, R + 14, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(201,162,39,.07)"; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 3.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R - 12, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(201,162,39,.38)"; ctx.lineWidth = 1.1; ctx.stroke();

    const goldGrad = ctx.createLinearGradient(cx - 60, cy - 60, cx + 60, cy + 60);
    goldGrad.addColorStop(0, "#F3E3A8");
    goldGrad.addColorStop(0.5, "#C9A227");
    goldGrad.addColorStop(1, "#E8CE7A");
    ctx.textAlign = "left"; // letterspaced 自行置中
    ctx.textBaseline = "middle";
    ctx.fillStyle = goldGrad;
    ctx.font = "700 86px " + SERIF;
    letterspaced(ctx, "ZP", cx, cy + 2, 6, "center");
    ctx.strokeStyle = "rgba(201,162,39,.55)"; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(cx - 30, cy + 56); ctx.lineTo(cx + 30, cy + 56); ctx.stroke();
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

    /* 等級／類別（可留空） */
    if (d.levelLabel) {
      ctx.textAlign = "center";
      ctx.fillStyle = GOLD_LIGHT;
      ctx.font = "600 23px " + F;
      ctx.fillText(String(d.levelLabel), cx, cy + R + 66);
      ctx.textAlign = "left";
    }

    /* 茲證明 */
    ctx.textAlign = "center";
    ctx.fillStyle = MUTED; ctx.font = "400 21px " + F;
    ctx.fillText("茲 證 明", W / 2, 812);
    ctx.fillStyle = DIM; ctx.font = "400 13px " + SERIF;
    letterspaced(ctx, "THIS IS TO CERTIFY THAT", W / 2, 838, 2.6, "center");

    ctx.fillStyle = CREAM;
    const nameSize = fitText(ctx, String(d.studentName || ""), 820, 56, "600");
    ctx.font = "600 " + nameSize + "px " + F;
    ctx.fillText(String(d.studentName || ""), W / 2, 906);

    ctx.strokeStyle = "rgba(201,162,39,.45)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(300, 938); ctx.lineTo(780, 938); ctx.stroke();

    ctx.fillStyle = MUTED; ctx.font = "400 19px " + F;
    ctx.fillText("已完成下列課程，並達指定出席要求", W / 2, 982);
    ctx.fillStyle = DIM; ctx.font = "400 12.5px " + SERIF;
    letterspaced(ctx, "HAS SATISFACTORILY ATTENDED AND COMPLETED THE FOLLOWING PROGRAMME", W / 2, 1006, 1.2, "center");

    ctx.fillStyle = CREAM;
    const certTitle = cleanTitle(d.classTitle) || String(d.classTitle || "");
    const titleSize = fitText(ctx, certTitle, 860, 33, "600");
    ctx.font = "600 " + titleSize + "px " + F;
    ctx.fillText(certTitle, W / 2, 1054);
    ctx.textAlign = "left";

    /* 資訊區（中英對照） */
    const bx = 100, by = 1108, bw = W - 200, bh = 306;
    ctx.fillStyle = "rgba(255,255,255,.045)";
    roundRect(ctx, bx, by, bw, bh, 18); ctx.fill();
    ctx.strokeStyle = "rgba(201,162,39,.26)"; ctx.lineWidth = 1.2;
    roundRect(ctx, bx, by, bw, bh, 18); ctx.stroke();

    const rows = [
      ["認證時數", "CONTACT HOURS", (Number(d.hours) || 0).toFixed(1) + " 小時 / hours"],
      ["執教導師", "INSTRUCTOR", (d.coachStarred ? "星級導師認證 · " : "") + (d.coachName || "ZenPass 認可導師")],
      ["完成日期", "DATE OF COMPLETION", d.dateStr || ""],
      ["證書編號", "CERTIFICATE NO.", d.serial || ""],
    ];
    rows.forEach((r, i) => {
      const y = by + 62 + i * 68;
      ctx.fillStyle = MUTED; ctx.font = "500 18px " + F;
      ctx.fillText(r[0], bx + 36, y);
      ctx.fillStyle = DIM; ctx.font = "400 10.5px " + SERIF;
      letterspaced(ctx, r[1], bx + 36, y + 18, 1.3, "left");

      ctx.fillStyle = i === 3 ? GOLD_LIGHT : CREAM;
      ctx.font = (i === 3 ? "600 20px " : "600 22px ") + F;
      ctx.textAlign = "right";
      ctx.fillText(String(r[2]), bx + bw - 36, y + 8);
      ctx.textAlign = "left";
      if (i < 3) {
        ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bx + 36, y + 30); ctx.lineTo(bx + bw - 36, y + 30); ctx.stroke();
      }
    });

    /* 簽發機構 */
    ctx.fillStyle = MUTED; ctx.font = "500 16px " + F;
    ctx.fillText("簽發機構 Issuing Body", 100, 1490);
    ctx.strokeStyle = "rgba(201,162,39,.5)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(100, 1540); ctx.lineTo(460, 1540); ctx.stroke();
    ctx.fillStyle = CREAM; ctx.font = "600 19px " + F;
    ctx.fillText("ZenPass 禪流", 100, 1568);
    ctx.fillStyle = MUTED; ctx.font = "400 14px " + F;
    ctx.fillText("香港康樂及體育有限公司", 100, 1594);
    ctx.fillStyle = DIM; ctx.font = "400 12.5px " + SERIF;
    ctx.fillText("Hong Kong Leisure and Fitness Company Limited", 100, 1616);

    /* 防偽章 */
    const sx = 206, sy = 1712, sr = 60;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(201,162,39,.7)"; ctx.lineWidth = 2.3; ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, sr - 10, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(201,162,39,.3)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = GOLD_LIGHT; ctx.font = "600 14px " + SERIF;
    letterspaced(ctx, "VERIFIED", sx, sy - 6, 2.2, "center");
    ctx.fillStyle = MUTED; ctx.font = "400 11px " + F;
    ctx.fillText("ZENPASS DIGITAL", sx, sy + 14);
    ctx.fillText("數位存證", sx, sy + 31);
    ctx.textAlign = "left";

    /* QR */
    const qs = 172, qx = W - 100 - qs, qy = 1604;
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
    ctx.fillStyle = MUTED; ctx.font = "400 13px " + F;
    ctx.fillText("掃碼驗證真偽 / Scan to verify", qx + qs / 2, qy + qs + 30);
    ctx.textAlign = "left";

    /* 聲明（中英） */
    ctx.fillStyle = MUTED; ctx.font = "400 13px " + F;
    ctx.fillText("本證書由 ZenPass 禪流簽發，可於 zenpass.hk/verify.html 以證書編號核實。", 100, 1798);
    ctx.fillStyle = DIM; ctx.font = "400 11.5px " + F;
    ctx.fillText("This certificate is issued by ZenPass and may be verified at zenpass.hk/verify.html using the certificate number above.", 100, 1820);
    ctx.fillText("本證書僅證明出席及課程完成紀錄，並不構成任何專業資格或法定認可。", 100, 1844);
    ctx.fillText("It records attendance and completion only and does not confer any professional or statutory qualification.", 100, 1866);

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
