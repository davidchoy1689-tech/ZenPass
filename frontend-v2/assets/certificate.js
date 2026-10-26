/* ZenPass — 完課證書渲染（1080×1920，可 2× 高清印製）
 * 正式版：無 emoji；襯線英文標題 + 金色徽章（運動線稿圖示）+ 防偽章 + QR 驗證
 * 用法：await zpMakeCertificate({ studentName, classTitle, levelLabel, hours, coachName, coachStarred,
 *        dateStr, serial, verifyUrl, sportCode, scale, certType })
 * 回傳 { dataUrl, blob, filename }
 * 2026-10-27
 */
(function () {
  const GOLD = "#C9A227";
  const GOLD_LIGHT = "#E8CE7A";
  const CREAM = "#F7F4EC";
  const MUTED = "#B9C2CE";
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

  /** 字距文字（英文標題用） */
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
    } while (size > 18);
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

    /* 底色：深海軍藍 → 深翡翠綠 */
    const g = ctx.createLinearGradient(0, 0, W * 0.7, H);
    g.addColorStop(0, "#0B132B");
    g.addColorStop(0.55, "#0A2F35");
    g.addColorStop(1, "#064E3B");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* 內斂光暈 */
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

    /* 頂部機構名 */
    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = "600 24px " + SERIF;
    letterspaced(ctx, "ZENPASS", W / 2, 150, 12, "center");
    ctx.fillStyle = "rgba(201,162,39,.55)";
    ctx.fillRect(W / 2 - 46, 170, 92, 1.4);

    /* 主標題（襯線，正式） */
    ctx.fillStyle = CREAM;
    ctx.font = "400 40px " + SERIF;
    letterspaced(ctx, "CERTIFICATE", W / 2, 236, 10, "center");
    ctx.font = "400 32px " + SERIF;
    letterspaced(ctx, "OF COMPLETION", W / 2, 288, 9, "center");

    ctx.textAlign = "center";
    ctx.fillStyle = MUTED;
    ctx.font = "500 20px " + F;
    ctx.fillText("香港新興運動認可培訓紀錄 · 課外活動時數存證", W / 2, 336);
    ctx.textAlign = "left";

    /* 徽章：金色雙環 + 運動線稿圖示 */
    const cx = W / 2, cy = 530, R = 116;
    ctx.beginPath(); ctx.arc(cx, cy, R + 14, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(201,162,39,.07)"; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 3.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R - 13, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(201,162,39,.4)"; ctx.lineWidth = 1.2; ctx.stroke();

    /* 統一 ZP 字標（品牌一致性：所有證書同一個標記） */
    const goldGrad = ctx.createLinearGradient(cx - 60, cy - 60, cx + 60, cy + 60);
    goldGrad.addColorStop(0, "#F3E3A8");
    goldGrad.addColorStop(0.5, "#C9A227");
    goldGrad.addColorStop(1, "#E8CE7A");
    ctx.textAlign = "left";           // letterspaced() 自行置中；用 center 會令每字再偏移
    ctx.textBaseline = "middle";
    ctx.fillStyle = goldGrad;
    ctx.font = "700 96px " + SERIF;
    letterspaced(ctx, "ZP", cx, cy + 4, 6, "center");
    // 字標下細線
    ctx.strokeStyle = "rgba(201,162,39,.55)";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx - 34, cy + 62); ctx.lineTo(cx + 34, cy + 62); ctx.stroke();
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

    /* 等級 */
    ctx.textAlign = "center";
    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = "600 25px " + F;
    ctx.fillText(String(d.levelLabel || "Level 1"), cx, cy + R + 74);
    ctx.textAlign = "left";

    /* 茲證明 */
    ctx.textAlign = "center";
    ctx.fillStyle = MUTED; ctx.font = "400 19px " + F;
    ctx.fillText("茲 證 明", W / 2, 852);

    ctx.fillStyle = CREAM;
    const nameSize = fitText(ctx, String(d.studentName || "學員"), 820, 58, "600");
    ctx.font = "600 " + nameSize + "px " + F;
    ctx.fillText(String(d.studentName || "學員"), W / 2, 928);

    ctx.strokeStyle = "rgba(201,162,39,.45)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(300, 960); ctx.lineTo(780, 960); ctx.stroke();

    ctx.fillStyle = MUTED; ctx.font = "400 19px " + F;
    ctx.fillText("已完成下列課程，並達指定出席要求", W / 2, 1008);

    ctx.fillStyle = CREAM;
    const certTitle = cleanTitle(d.classTitle) || String(d.classTitle || "");
    const titleSize = fitText(ctx, certTitle, 860, 34, "600");
    ctx.font = "600 " + titleSize + "px " + F;
    ctx.fillText(certTitle, W / 2, 1062);
    ctx.textAlign = "left";

    /* 資訊區 */
    const bx = 110, by = 1126, bw = W - 220, bh = 292;
    ctx.fillStyle = "rgba(255,255,255,.045)";
    roundRect(ctx, bx, by, bw, bh, 18); ctx.fill();
    ctx.strokeStyle = "rgba(201,162,39,.26)"; ctx.lineWidth = 1.2;
    roundRect(ctx, bx, by, bw, bh, 18); ctx.stroke();

    const rows = [
      ["認證時數", (Number(d.hours) || 0).toFixed(1) + " 小時 · Active Play Hours"],
      ["執教教練", (d.coachStarred ? "星級教練認證 · " : "") + (d.coachName || "ZenPass 認可教練")],
      ["完成日期", d.dateStr || ""],
      ["證書編號", d.serial || ""],
    ];
    rows.forEach((r, i) => {
      const y = by + 56 + i * 64;
      ctx.fillStyle = MUTED; ctx.font = "400 19px " + F;
      ctx.fillText(r[0], bx + 40, y);
      ctx.fillStyle = i === 3 ? GOLD_LIGHT : CREAM;
      ctx.font = (i === 3 ? "600 21px " : "600 23px ") + F;
      ctx.textAlign = "right";
      ctx.fillText(String(r[1]), bx + bw - 40, y);
      ctx.textAlign = "left";
      if (i < 3) {
        ctx.strokeStyle = "rgba(255,255,255,.075)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bx + 40, y + 21); ctx.lineTo(bx + bw - 40, y + 21); ctx.stroke();
      }
    });

    /* 簽發機構（左） */
    ctx.fillStyle = MUTED; ctx.font = "400 17px " + F;
    ctx.fillText("簽發機構", 110, 1502);
    ctx.strokeStyle = "rgba(201,162,39,.5)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(110, 1552); ctx.lineTo(470, 1552); ctx.stroke();
    ctx.fillStyle = CREAM; ctx.font = "600 19px " + F;
    ctx.fillText("ZenPass 禪流平台", 110, 1580);
    ctx.fillStyle = MUTED; ctx.font = "400 15px " + F;
    ctx.fillText("香港康樂及體育有限公司", 110, 1608);
    ctx.fillText("Hong Kong Leisure and Fitness Co. Ltd.", 110, 1632);

    /* 防偽章（左下） */
    const sx = 208, sy = 1712, sr = 62;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(201,162,39,.7)"; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, sr - 11, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(201,162,39,.3)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = GOLD_LIGHT; ctx.font = "600 15px " + SERIF;
    letterspaced(ctx, "VERIFIED", sx, sy - 6, 2.4, "center");
    ctx.fillStyle = MUTED; ctx.font = "400 12px " + F;
    ctx.fillText("ZENPASS DIGITAL", sx, sy + 16);
    ctx.fillText("數位存證", sx, sy + 34);
    ctx.textAlign = "left";

    /* QR（右下） */
    const qs = 180, qx = W - 110 - qs, qy = 1600;
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
    ctx.fillStyle = MUTED; ctx.font = "400 15px " + F;
    ctx.fillText("掃碼驗證真偽", qx + qs / 2, qy + qs + 32);
    ctx.textAlign = "left";

    /* 底部聲明 */
    ctx.fillStyle = MUTED; ctx.font = "400 14px " + F;
    ctx.fillText("本證書由 ZenPass 禪流平台簽發，可於 zenpass.hk/verify.html 以證書編號核實。", 110, 1812);
    ctx.fillText("證書僅證明出席及課程完成紀錄，並不構成任何專業資格或法定認證。", 110, 1836);

    ctx.fillStyle = GOLD; ctx.fillRect(40, H - 46, W - 80, 5);

    const dataUrl = cv.toDataURL("image/jpeg", 0.94);
    const filename = "ZenPass-Certificate-" + (d.serial || Date.now()) + ".jpg";
    let blob = null;
    try {
      blob = await new Promise((res) => cv.toBlob((b) => res(b), "image/jpeg", 0.94));
    } catch (e) {}
    return { dataUrl, blob, filename };
  };
})();
