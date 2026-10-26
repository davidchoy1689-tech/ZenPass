/* ZenPass — 完課證書渲染（1080×1920，可 2× 高清印製）
 * 用法：await zpMakeCertificate({ studentName, classTitle, levelLabel, hours, coachName, coachStarred, dateStr, serial, verifyUrl, sportSlug, scale })
 *      → 回傳 { dataUrl, blob, filename }
 * 設計：深海軍藍 → 深翡翠綠漸變 + 雙層金邊，右下 QR 驗證，左下防偽序號
 * 2026-10-27
 */
(function () {
  const GOLD = "#F59E0B";
  const GOLD_SOFT = "#FCD34D";
  const CREAM = "#F8FAFC";
  const MUTED = "#CBD5E1";
  const F = "-apple-system,'PingFang HK','Noto Sans TC','Microsoft JhengHei',sans-serif";

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
    } while (size > 18);
    return size;
  }

  const EMOJI = {
    MOLKKY: "🎯", CURLING: "🥌", CORNHOLE: "🫘", AIRSTORM: "🏹",
    NORDIC: "🥾", ROUNDNET: "🕸️", ROULIQIU: "🏓", FLEXIBAR: "💪", STRETCH: "🧘",
  };

  window.zpMakeCertificate = async function (d) {
    d = d || {};
    const W = 1080, H = 1920, S = Math.max(1, Math.min(Number(d.scale) || 1, 3));
    const cv = document.createElement("canvas");
    cv.width = W * S; cv.height = H * S;
    const ctx = cv.getContext("2d");
    ctx.scale(S, S);

    /* 背景漸變 */
    const g = ctx.createLinearGradient(0, 0, W * 0.7, H);
    g.addColorStop(0, "#0B132B");
    g.addColorStop(0.55, "#0A2F35");
    g.addColorStop(1, "#064E3B");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* 細微光暈 */
    const gl = ctx.createRadialGradient(W / 2, 620, 40, W / 2, 620, 620);
    gl.addColorStop(0, "rgba(245,158,11,.16)");
    gl.addColorStop(1, "rgba(245,158,11,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(0, 0, W, H);

    /* 雙層金邊 */
    ctx.strokeStyle = GOLD; ctx.lineWidth = 6;
    ctx.strokeRect(38, 38, W - 76, H - 76);
    ctx.strokeStyle = "rgba(245,158,11,.45)"; ctx.lineWidth = 2;
    ctx.strokeRect(56, 56, W - 112, H - 112);

    /* 頂部標題 */
    ctx.fillStyle = GOLD_SOFT;
    ctx.font = "700 26px " + F;
    letterspaced(ctx, "ZENPASS CERTIFICATE", W / 2, 168, 7, "center");
    ctx.font = "800 44px " + F;
    letterspaced(ctx, "OF COMPLETION", W / 2, 222, 5, "center");

    ctx.fillStyle = MUTED;
    ctx.textAlign = "center";
    ctx.font = "600 22px " + F;
    ctx.fillText("香港新興運動官方認可機構 · 課外活動時數存證", W / 2, 272);
    ctx.textAlign = "left";

    /* 分隔線 */
    ctx.strokeStyle = "rgba(245,158,11,.5)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(300, 306); ctx.lineTo(780, 306); ctx.stroke();

    /* 中央勳章 */
    const cx = W / 2, cy = 520, R = 132;
    ctx.beginPath(); ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(245,158,11,.10)"; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 5; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R - 16, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(245,158,11,.45)"; ctx.lineWidth = 1.5; ctx.stroke();

    const emoji = EMOJI[String(d.sportCode || "").toUpperCase()] || "🏅";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "120px " + F;
    ctx.fillText(emoji, cx, cy + 6);
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";

    /* 等級 */
    ctx.textAlign = "center";
    ctx.fillStyle = GOLD_SOFT;
    ctx.font = "800 34px " + F;
    const lvl = String(d.levelLabel || "Level 1 · 新興運動初階探索者");
    ctx.fillText(lvl, cx, cy + R + 88);
    ctx.textAlign = "left";

    /* 學員姓名 */
    ctx.textAlign = "center";
    ctx.fillStyle = MUTED; ctx.font = "600 22px " + F;
    ctx.fillText("茲證明", W / 2, 860);
    ctx.fillStyle = CREAM;
    const nameSize = fitText(ctx, String(d.studentName || "學員"), 820, 62, "800");
    ctx.font = "800 " + nameSize + "px " + F;
    ctx.fillText(String(d.studentName || "學員"), W / 2, 936);
    ctx.strokeStyle = "rgba(245,158,11,.55)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(280, 966); ctx.lineTo(800, 966); ctx.stroke();
    ctx.textAlign = "left";

    /* 完成項目 */
    ctx.textAlign = "center";
    ctx.fillStyle = MUTED; ctx.font = "600 22px " + F;
    ctx.fillText("已完成以下課程並達指定出席要求", W / 2, 1016);
    ctx.fillStyle = CREAM;
    const titleSize = fitText(ctx, String(d.classTitle || ""), 860, 38, "700");
    ctx.font = "700 " + titleSize + "px " + F;
    ctx.fillText(String(d.classTitle || ""), W / 2, 1074);
    ctx.textAlign = "left";

    /* 資訊卡 */
    const bx = 110, by = 1140, bw = W - 220, bh = 300;
    ctx.fillStyle = "rgba(255,255,255,.05)";
    roundRect(ctx, bx, by, bw, bh, 24); ctx.fill();
    ctx.strokeStyle = "rgba(245,158,11,.28)"; ctx.lineWidth = 1.5;
    roundRect(ctx, bx, by, bw, bh, 24); ctx.stroke();

    const rows = [
      ["認證時數", (Number(d.hours) || 0).toFixed(1) + " 小時 (Active Play Hours)"],
      ["執教教練", (d.coachStarred ? "⭐ 星級教練 " : "") + (d.coachName || "ZenPass 認可教練")],
      ["完成日期", d.dateStr || ""],
      ["證書編號", d.serial || ""],
    ];
    rows.forEach((r, i) => {
      const y = by + 58 + i * 66;
      ctx.fillStyle = MUTED; ctx.font = "600 21px " + F;
      ctx.fillText(r[0], bx + 40, y);
      ctx.fillStyle = i === 3 ? GOLD_SOFT : CREAM;
      ctx.font = (i === 3 ? "700 24px " : "700 26px ") + F;
      ctx.textAlign = "right";
      ctx.fillText(String(r[1]), bx + bw - 40, y);
      ctx.textAlign = "left";
      if (i < 3) {
        ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bx + 40, y + 22); ctx.lineTo(bx + bw - 40, y + 22); ctx.stroke();
      }
    });

    /* 底部：QR（右）＋ 防偽章（左） */
    const qy = 1560, qs = 200, qx = W - 110 - qs;
    try {
      const res = await fetch("/api/qr?text=" + encodeURIComponent(d.verifyUrl || location.origin) + "&size=420");
      const j = await res.json();
      if (j && j.success && j.data_url) {
        const qr = await loadImage(j.data_url);
        if (qr) {
          ctx.fillStyle = "#fff";
          roundRect(ctx, qx - 12, qy - 12, qs + 24, qs + 24, 16); ctx.fill();
          ctx.drawImage(qr, qx, qy, qs, qs);
        }
      }
    } catch (e) {}

    ctx.textAlign = "center";
    ctx.fillStyle = MUTED; ctx.font = "600 18px " + F;
    ctx.fillText("掃碼驗證真偽", qx + qs / 2, qy + qs + 40);
    ctx.textAlign = "left";

    /* 防偽章 */
    ctx.beginPath(); ctx.arc(196, qy + 86, 74, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(245,158,11,.75)"; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.arc(196, qy + 86, 62, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(245,158,11,.35)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = GOLD_SOFT; ctx.font = "800 22px " + F;
    ctx.fillText("ZENPASS", 196, qy + 76);
    ctx.fillStyle = MUTED; ctx.font = "600 15px " + F;
    ctx.fillText("數位存證", 196, qy + 102);
    ctx.textAlign = "left";

    ctx.fillStyle = MUTED; ctx.font = "600 17px " + F;
    ctx.fillText("本證書由 ZenPass 禪流平台簽發，可於 zenpass.hk/verify.html 核實。", 110, qy + 196);
    ctx.fillText("香港康樂及體育有限公司 · Hong Kong Leisure and Fitness Company Limited", 110, qy + 224);

    /* 底部金線 */
    ctx.fillStyle = GOLD; ctx.fillRect(38, H - 44, W - 76, 6);

    const dataUrl = cv.toDataURL("image/jpeg", 0.94);
    const filename = "ZenPass-Certificate-" + (d.serial || Date.now()) + ".jpg";
    let blob = null;
    try {
      blob = await new Promise((res) => cv.toBlob((b) => res(b), "image/jpeg", 0.94));
    } catch (e) {}
    return { dataUrl, blob, filename };
  };
})();
