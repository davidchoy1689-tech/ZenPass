/* ZenPass — 修業證書（A4 直向 210×297mm，300 DPI = 2480×3508px）
 * 中英對照、無 emoji、無簽署欄；右下 QR 防偽驗證
 * 用法：await zpMakeCertificate({ studentName, classTitle, hours, coachName, coachStarred,
 *        dateStr, issueDate, serial, verifyUrl, scale })
 *   scale 1 = 300dpi（列印用）｜0.5 = 150dpi（畫面預覽）
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

  // 邏輯座標系（以 1080 寬為基準），實際輸出 A4 @300dpi
  const LW = 1080;
  const LH = 1527;          // 1080 × (297/210) ≈ 1527
  const DPI300_W = 2480;
  const DPI300_H = 3508;
  const K = DPI300_W / LW;  // ≈ 2.296

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

  window.zpMakeCertificate = async function (d) {
    d = d || {};
    const scale = Math.max(0.4, Math.min(Number(d.scale) || 1, 2));
    const cv = document.createElement("canvas");
    cv.width = Math.round(DPI300_W * scale);
    cv.height = Math.round(DPI300_H * scale);
    const ctx = cv.getContext("2d");
    ctx.scale(K * scale, K * scale);

    /* 底色 */
    const g = ctx.createLinearGradient(0, 0, LW * 0.7, LH);
    g.addColorStop(0, "#0B132B");
    g.addColorStop(0.55, "#0A2F35");
    g.addColorStop(1, "#064E3B");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LW, LH);

    const gl = ctx.createRadialGradient(LW / 2, 470, 50, LW / 2, 470, 560);
    gl.addColorStop(0, "rgba(201,162,39,.13)");
    gl.addColorStop(1, "rgba(201,162,39,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(0, 0, LW, LH);

    /* 雙層金邊 */
    ctx.strokeStyle = GOLD; ctx.lineWidth = 4.6;
    ctx.strokeRect(38, 38, LW - 76, LH - 76);
    ctx.strokeStyle = "rgba(201,162,39,.42)"; ctx.lineWidth = 1.3;
    ctx.strokeRect(54, 54, LW - 108, LH - 108);

    /* 品牌 */
    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = "600 23px " + SERIF;
    letterspaced(ctx, "ZENPASS", LW / 2, 124, 11, "center");
    ctx.fillStyle = "rgba(201,162,39,.55)";
    ctx.fillRect(LW / 2 - 40, 144, 80, 1.3);

    /* 標題 */
    ctx.fillStyle = CREAM;
    ctx.font = "400 33px " + SERIF;
    letterspaced(ctx, "CERTIFICATE OF COMPLETION", LW / 2, 202, 6, "center");

    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = "500 27px " + F;
    letterspaced(ctx, "修 業 證 書", LW / 2, 246, 3, "center");

    ctx.fillStyle = MUTED;
    ctx.font = "400 15px " + F;
    ctx.textAlign = "center";
    ctx.fillText("出席及課程完成紀錄 · Record of Attendance and Completion", LW / 2, 278);
    ctx.textAlign = "left";

    /* ZP 字標 */
    const cx = LW / 2, cy = 412, R = 86;
    ctx.beginPath(); ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(201,162,39,.07)"; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2.8; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R - 10, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(201,162,39,.38)"; ctx.lineWidth = 1; ctx.stroke();

    const goldGrad = ctx.createLinearGradient(cx - 50, cy - 50, cx + 50, cy + 50);
    goldGrad.addColorStop(0, "#F3E3A8");
    goldGrad.addColorStop(0.5, "#C9A227");
    goldGrad.addColorStop(1, "#E8CE7A");
    ctx.textAlign = "left"; // letterspaced 自行置中
    ctx.textBaseline = "middle";
    ctx.fillStyle = goldGrad;
    ctx.font = "700 70px " + SERIF;
    letterspaced(ctx, "ZP", cx, cy + 2, 5, "center");
    ctx.strokeStyle = "rgba(201,162,39,.55)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cx - 24, cy + 46); ctx.lineTo(cx + 24, cy + 46); ctx.stroke();
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

    /* 茲證明 */
    ctx.textAlign = "center";
    ctx.fillStyle = MUTED; ctx.font = "400 19px " + F;
    ctx.fillText("茲 證 明", LW / 2, 622);
    ctx.fillStyle = DIM; ctx.font = "400 11.5px " + SERIF;
    letterspaced(ctx, "THIS IS TO CERTIFY THAT", LW / 2, 644, 2.2, "center");

    ctx.fillStyle = CREAM;
    const nameSize = fitText(ctx, String(d.studentName || ""), 800, 50, "600");
    ctx.font = "600 " + nameSize + "px " + F;
    ctx.fillText(String(d.studentName || ""), LW / 2, 706);

    ctx.strokeStyle = "rgba(201,162,39,.45)"; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(310, 734); ctx.lineTo(770, 734); ctx.stroke();

    ctx.fillStyle = MUTED; ctx.font = "400 17px " + F;
    ctx.fillText("已完成下列課程，並達指定出席要求", LW / 2, 772);
    ctx.fillStyle = DIM; ctx.font = "400 11px " + SERIF;
    letterspaced(ctx, "HAS SATISFACTORILY ATTENDED AND COMPLETED THE FOLLOWING PROGRAMME", LW / 2, 792, 1, "center");

    ctx.fillStyle = CREAM;
    const certTitle = cleanTitle(d.classTitle) || String(d.classTitle || "");
    const titleSize = fitText(ctx, certTitle, 820, 31, "600");
    ctx.font = "600 " + titleSize + "px " + F;
    ctx.fillText(certTitle, LW / 2, 836);
    ctx.textAlign = "left";

    /* 資料欄（中英對照） */
    const bx = 96, by = 884, bw = LW - 192, bh = 264;
    ctx.fillStyle = "rgba(255,255,255,.045)";
    roundRect(ctx, bx, by, bw, bh, 16); ctx.fill();
    ctx.strokeStyle = "rgba(201,162,39,.26)"; ctx.lineWidth = 1.1;
    roundRect(ctx, bx, by, bw, bh, 16); ctx.stroke();

    const rows = [
      ["修讀時數", "CONTACT HOURS", (Number(d.hours) || 0).toFixed(1) + " 小時 / hours"],
      ["執教導師", "INSTRUCTOR", (d.coachStarred ? "星級導師認證 · " : "") + (d.coachName || "ZenPass 認可導師")],
      ["完成日期", "DATE OF COMPLETION", d.dateStr || ""],
      ["簽發日期", "DATE OF ISSUE", d.issueDate || d.dateStr || ""],
    ];
    rows.forEach((r, i) => {
      const y = by + 54 + i * 58;
      ctx.fillStyle = MUTED; ctx.font = "500 16.5px " + F;
      ctx.fillText(r[0], bx + 32, y);
      ctx.fillStyle = DIM; ctx.font = "400 9.5px " + SERIF;
      letterspaced(ctx, r[1], bx + 32, y + 16, 1.1, "left");

      ctx.fillStyle = CREAM; ctx.font = "600 20px " + F;
      ctx.textAlign = "right";
      ctx.fillText(String(r[2]), bx + bw - 32, y + 7);
      ctx.textAlign = "left";
      if (i < 3) {
        ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bx + 32, y + 26); ctx.lineTo(bx + bw - 32, y + 26); ctx.stroke();
      }
    });

    /* 證書編號 */
    ctx.fillStyle = MUTED; ctx.font = "500 13.5px " + F;
    ctx.fillText("證書編號 Certificate No.", 96, 1206);
    ctx.fillStyle = GOLD_LIGHT; ctx.font = "600 18px " + F;
    ctx.fillText(String(d.serial || ""), 96, 1232);
    ctx.fillStyle = DIM; ctx.font = "400 11px " + F;
    ctx.fillText("此編號可於 zenpass.hk/verify.html 核實", 96, 1254);

    /* QR（右下） */
    const qs = 150, qx = LW - 96 - qs, qy = 1186;
    try {
      const res = await fetch("/api/qr?text=" + encodeURIComponent(d.verifyUrl || location.origin) + "&size=420");
      const j = await res.json();
      if (j && j.success && j.data_url) {
        const qr = await loadImage(j.data_url);
        if (qr) {
          ctx.fillStyle = "#fff";
          roundRect(ctx, qx - 9, qy - 9, qs + 18, qs + 18, 10); ctx.fill();
          ctx.drawImage(qr, qx, qy, qs, qs);
        }
      }
    } catch (e) {}

    ctx.textAlign = "center";
    ctx.fillStyle = MUTED; ctx.font = "400 12px " + F;
    ctx.fillText("掃碼驗證真偽 / Scan to verify", qx + qs / 2, qy + qs + 26);
    ctx.textAlign = "left";

    /* 聲明（中英） */
    ctx.fillStyle = MUTED; ctx.font = "400 12px " + F;
    ctx.fillText("本證書由 ZenPass 禪流（香港康樂及體育有限公司）簽發，可於 zenpass.hk/verify.html 核實。", 96, 1362);
    ctx.fillStyle = DIM; ctx.font = "400 10.5px " + F;
    ctx.fillText("Issued by ZenPass (Hong Kong Leisure and Fitness Company Limited). Verify at zenpass.hk/verify.html.", 96, 1382);
    ctx.fillStyle = MUTED; ctx.font = "400 12px " + F;
    ctx.fillText("本證書僅證明出席及課程完成紀錄，並不構成任何專業資格或法定認可。", 96, 1408);
    ctx.fillStyle = DIM; ctx.font = "400 10.5px " + F;
    ctx.fillText("It records attendance and completion only and does not confer any professional or statutory qualification.", 96, 1428);

    /* 底部金線 */
    ctx.fillStyle = GOLD;
    ctx.fillRect(38, LH - 42, LW - 76, 4.6);

    const dataUrl = cv.toDataURL("image/jpeg", 0.95);
    const filename = "ZenPass-Certificate-" + (d.serial || Date.now()) + ".jpg";
    let blob = null;
    try {
      blob = await new Promise((res) => cv.toBlob((b) => res(b), "image/jpeg", 0.95));
    } catch (e) {}
    return { dataUrl, blob, filename, width: cv.width, height: cv.height };
  };
})();
