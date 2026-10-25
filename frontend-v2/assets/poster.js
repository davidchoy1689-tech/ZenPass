/* ZenPass — IG Story 宣傳圖生成（1080×1920，純前端 Canvas）
 * 用法：await zpMakePoster({ title, dateStr, venue, price, detailUrl, coverUrl, coachName, starred })
 *       → 自動下載 JPG
 * QR 由 /api/qr 產生（server-side，無 CDN 依賴）
 * 2026-10-26
 */
(function () {
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
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = String(text || "").split("");
    let line = "";
    let lines = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line + words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = words[i];
        y += lineHeight;
        lines++;
        if (maxLines && lines >= maxLines - 1) break;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y);
  }

  /* 淺色極簡版：只用圖片庫 icon，無 emoji／無特殊符號 */
  const ICON_BASE = "/assets/icons/sports/";
  const SLUG_TO_ICON = {
    molkky: "moelkkyla", moelkkyla: "moelkkyla",
    "floor-curling": "floor-curling", cornhole: "cornhole",
    "air-storm": "air-storm", "nordic-walking": "nordic-walking",
    roundnet: "roundnet", rouliqiu: "rouliqiu",
    "flexi-bar": "flexi-bar", stretch: "stretching", kids: "kids-fitness",
  };
  window.zpIconUrl = function (slug) {
    const k = SLUG_TO_ICON[String(slug || "").toLowerCase()];
    return ICON_BASE + (k || "sports") + ".svg";
  };

  window.zpMakePoster = async function (d) {
    const W = 1080, H = 1920, SAFE_BOTTOM = H - 170;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const INK = "#111827", TEAL = "#0f766e", GOLD = "#b45309", MUTED = "#6b7280", LINE = "#e5e7eb";
    const F = "-apple-system,'PingFang HK','Noto Sans TC','Microsoft JhengHei',sans-serif";

    ctx.fillStyle = "#f6f5f1"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = TEAL; ctx.fillRect(0, 0, W, 12);

    // 品牌（頂部安全區）
    ctx.fillStyle = INK; ctx.font = "800 40px " + F; ctx.fillText("ZENPASS", 84, 236);
    ctx.fillStyle = TEAL; ctx.font = "600 26px " + F; ctx.fillText("禪流｜新興運動體驗", 84, 282);

    // 圖片庫 icon 卡
    const cx = 84, cy = 330, cw = 912, ch = 690, r = 36;
    ctx.save();
    ctx.shadowColor = "rgba(17,24,39,.10)"; ctx.shadowBlur = 36; ctx.shadowOffsetY = 12;
    ctx.fillStyle = "#eef4f2"; roundRect(ctx, cx, cy, cw, ch, r); ctx.fill();
    ctx.restore();
    const icon = await loadImage(d.iconUrl || window.zpIconUrl(d.slug));
    if (icon) {
      const box = 440;
      const sc = Math.min(box / icon.naturalWidth, box / icon.naturalHeight);
      const dw = icon.naturalWidth * sc, dh = icon.naturalHeight * sc;
      ctx.drawImage(icon, cx + (cw - dw) / 2, cy + (ch - dh) / 2, dw, dh);
    }

    // 標題（1 或 2 行，固定節奏）
    ctx.fillStyle = INK; ctx.font = "800 70px " + F;
    const lines = wrapLines(ctx, d.title || "新興運動體驗班", 900, 2);
    const titleTop = lines.length > 1 ? 1090 : 1120;
    lines.forEach((ln, i) => ctx.fillText(ln, 84, titleTop + i * 78));
    let afterTitle = titleTop + (lines.length - 1) * 78 + 44;
    if (d.sub) { ctx.fillStyle = TEAL; ctx.font = "600 28px " + F; ctx.fillText(d.sub, 84, afterTitle); afterTitle += 46; }

    // 分隔線
    const dy = afterTitle + 14;
    ctx.strokeStyle = LINE; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(84, dy); ctx.lineTo(996, dy); ctx.stroke();

    // 資訊（左）與 QR（右）同一水平帶
    const bandTop = dy + 34;
    const label = (t, y) => { ctx.fillStyle = MUTED; ctx.font = "700 23px " + F; ctx.fillText(t, 84, y); };
    const value = (t, y, font, color) => { ctx.fillStyle = color; ctx.font = font; ctx.fillText(t, 84, y); };

    label("日期時段", bandTop + 26);
    value(d.dateStr || "待定", bandTop + 76, "800 40px " + F, INK);

    label("集合地點", bandTop + 136);
    value((d.venue || "場地待定").slice(0, 16), bandTop + 182, "600 32px " + F, "#374151");

    label("報名費用", bandTop + 244);
    value("HK$" + (d.price || ""), bandTop + 306, "800 56px " + F, GOLD);
    ctx.fillStyle = MUTED; ctx.font = "600 26px " + F;
    ctx.fillText("/ 位", 84 + ctx.measureText("HK$" + (d.price || "")).width + 150, bandTop + 306);

    // QR（右側，底板 280 + 靜區）
    try {
      const res = await fetch("/api/qr?text=" + encodeURIComponent(d.detailUrl || location.origin) + "&size=400");
      const j = await res.json();
      if (j.success) {
        const qr = await loadImage(j.data_url);
        if (qr) {
          const qb = 268, qx = 712, qy = bandTop + 6;
          ctx.save();
          ctx.shadowColor = "rgba(17,24,39,.12)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
          ctx.fillStyle = "#ffffff"; roundRect(ctx, qx, qy, qb, qb, 26); ctx.fill();
          ctx.restore();
          ctx.drawImage(qr, qx + 44, qy + 44, qb - 88, qb - 88);
          ctx.fillStyle = MUTED; ctx.font = "700 22px " + F;
          ctx.textAlign = "center"; ctx.fillText("掃碼報名", qx + qb / 2, qy + qb + 38); ctx.textAlign = "left";
        }
      }
    } catch (e) {}

    // 底部（安全區）—— 只保留品牌網址，無家長／免責字句
    ctx.fillStyle = TEAL; ctx.font = "800 34px " + F;
    ctx.fillText("zenpass.hk", 84, SAFE_BOTTOM);
    ctx.fillStyle = TEAL; ctx.fillRect(0, H - 10, W, 10);

    const dataUrl = cv.toDataURL("image/jpeg", 0.94);
    if (!d.noDownload) {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "ZenPass-IGStory-" + (d.slug || Date.now()) + ".jpg";
      document.body.appendChild(a); a.click(); a.remove();
    }
    return dataUrl;
  };

  function wrapLines(ctx, text, maxWidth, maxLines) {
    const chars = String(text || "").split("");
    const out = [];
    let cur = "";
    for (const ch of chars) {
      if (ctx.measureText(cur + ch).width > maxWidth && cur) {
        out.push(cur); cur = ch;
        if (out.length === maxLines) break;
      } else cur += ch;
    }
    if (cur && out.length < maxLines) out.push(cur);
    return out;
  }

})();
