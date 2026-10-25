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
    const W = 1080, H = 1920;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const INK = "#111827", TEAL = "#0f766e", GOLD = "#b45309", MUTED = "#6b7280", LINE = "#e5e7eb";
    const F = "-apple-system,'PingFang HK','Noto Sans TC','Microsoft JhengHei',sans-serif";

    ctx.fillStyle = "#f6f5f1"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = TEAL; ctx.fillRect(0, 0, W, 12);

    // 品牌（頂部安全區 200px）
    ctx.fillStyle = INK; ctx.font = "800 40px " + F;
    ctx.fillText("ZENPASS", 84, 240);
    ctx.fillStyle = TEAL; ctx.font = "600 26px " + F;
    ctx.fillText("禪流｜新興運動體驗", 84, 286);

    // 圖片庫 icon（920x800 淺卡，置中）
    const cx = 84, cy = 340, cw = 912, ch = 800, r = 36;
    ctx.save();
    ctx.shadowColor = "rgba(17,24,39,.10)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
    ctx.fillStyle = "#eef4f2"; roundRect(ctx, cx, cy, cw, ch, r); ctx.fill();
    ctx.restore();
    const icon = await loadImage(d.iconUrl || window.zpIconUrl(d.slug));
    if (icon) {
      const box = 520;
      const sc = Math.min(box / icon.naturalWidth, box / icon.naturalHeight);
      const dw = icon.naturalWidth * sc, dh = icon.naturalHeight * sc;
      ctx.drawImage(icon, cx + (cw - dw) / 2, cy + (ch - dh) / 2, dw, dh);
    }

    // 標題（無 emoji）
    ctx.fillStyle = INK; ctx.font = "800 74px " + F;
    const lines = wrapLines(ctx, d.title || "新興運動體驗班", 912, 2);
    let ty = 1270;
    lines.forEach((ln, i) => ctx.fillText(ln, 84, ty + i * 86));
    ty += lines.length * 86;
    if (d.sub) { ctx.fillStyle = TEAL; ctx.font = "600 30px " + F; ctx.fillText(d.sub, 84, ty + 16); }

    // 分隔線
    const dy = ty + 62;
    ctx.strokeStyle = LINE; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(84, dy); ctx.lineTo(996, dy); ctx.stroke();

    // 資訊（左）
    const by = dy + 66;
    const row = (label, value, valueFont, color, gap) => {
      ctx.fillStyle = MUTED; ctx.font = "700 24px " + F;
      ctx.fillText(label, 84, by + gap);
      ctx.fillStyle = color; ctx.font = valueFont;
      ctx.fillText(value, 84, by + gap + 52);
    };
    row("日期時段", d.dateStr || "待定", "800 42px " + F, INK, 0);
    row("集合地點", (d.venue || "場地待定").slice(0, 16), "600 34px " + F, "#374151", 132);
    row("報名費用", "HK$" + (d.price || "") + " / 位", "800 54px " + F, GOLD, 264);

    // QR（右下，白板 280，靜區 40）
    try {
      const res = await fetch("/api/qr?text=" + encodeURIComponent(d.detailUrl || location.origin) + "&size=400");
      const j = await res.json();
      if (j.success) {
        const qr = await loadImage(j.data_url);
        if (qr) {
          const qx = 700, qy = by + 20, qb = 280;
          ctx.save();
          ctx.shadowColor = "rgba(17,24,39,.12)"; ctx.shadowBlur = 26; ctx.shadowOffsetY = 10;
          ctx.fillStyle = "#ffffff"; roundRect(ctx, qx, qy, qb, qb, 28); ctx.fill();
          ctx.restore();
          ctx.drawImage(qr, qx + 40, qy + 40, qb - 80, qb - 80);
          ctx.fillStyle = MUTED; ctx.font = "700 22px " + F;
          ctx.textAlign = "center"; ctx.fillText("掃碼報名", qx + qb / 2, qy + qb + 40); ctx.textAlign = "left";
        }
      }
    } catch (e) {}

    // 底部（留 160px）
    ctx.fillStyle = MUTED; ctx.font = "500 26px " + F;
    ctx.fillText("電子入場憑證　家長可代子女報名　免責與保險保障", 84, H - 190);
    ctx.fillStyle = TEAL; ctx.font = "800 32px " + F;
    ctx.fillText("zenpass.hk", 84, H - 136);
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
