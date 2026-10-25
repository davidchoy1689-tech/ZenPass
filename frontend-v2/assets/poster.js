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

  /* 風格 B：淺色極簡（ClassPass 感）+ IG 安全邊距 */
  window.zpMakePoster = async function (d) {
    const W = 1080, H = 1920;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const INK = "#0f172a", TEAL = "#0f766e", GOLD = "#b45309", MUTED = "#8b9aab";

    // 背景
    ctx.fillStyle = "#f7f5f0"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = TEAL; ctx.fillRect(0, 0, W, 14);

    // 品牌（安全區：頂部留 200px）
    ctx.fillStyle = INK;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
    ctx.font = "800 40px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText("ZENPASS", 80, 232);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.fillStyle = TEAL; ctx.font = "600 26px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText("禪流 · 新興運動體驗", 80, 276);
    if (d.starred) {
      const bw = 210, bh = 54, bx = W - 80 - bw, by = 200;
      ctx.fillStyle = "#fef3c7"; roundRect(ctx, bx, by, bw, bh, 27); ctx.fill();
      ctx.strokeStyle = "#fcd34d"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = GOLD; ctx.font = "800 26px -apple-system,'PingFang HK',sans-serif";
      ctx.textAlign = "center"; ctx.fillText("★ 星級教練", bx + bw / 2, by + 37); ctx.textAlign = "left";
    }

    // 主視覺（y=330, 920x780, 圓角 36，柔和陰影）
    const ix = 80, iy = 330, iw = 920, ih = 780, rad = 36;
    ctx.save();
    ctx.shadowColor = "rgba(15,23,42,.16)"; ctx.shadowBlur = 44; ctx.shadowOffsetY = 18;
    ctx.fillStyle = "#e7f3f1"; roundRect(ctx, ix, iy, iw, ih, rad); ctx.fill();
    ctx.restore();
    ctx.save(); roundRect(ctx, ix, iy, iw, ih, rad); ctx.clip();
    const cover = await loadImage(d.coverUrl || "/assets/images/default-sport.svg");
    if (cover) {
      const sc = Math.max(iw / cover.naturalWidth, ih / cover.naturalHeight);
      const dw = cover.naturalWidth * sc, dh = cover.naturalHeight * sc;
      ctx.drawImage(cover, ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh);
    }
    // 底部羽化融入背景
    const fade = ctx.createLinearGradient(0, iy + ih - 190, 0, iy + ih);
    fade.addColorStop(0, "rgba(247,245,240,0)"); fade.addColorStop(1, "rgba(247,245,240,.92)");
    ctx.fillStyle = fade; ctx.fillRect(ix, iy + ih - 190, iw, 190);
    ctx.restore();

    // 標題
    ctx.fillStyle = INK; ctx.font = "800 76px -apple-system,'PingFang HK','Noto Sans TC',sans-serif";
    const lines = wrapLines(ctx, d.title || "新興運動體驗班", 920, 2);
    let ty = 1232;
    lines.forEach((ln, i) => ctx.fillText(ln, 80, ty + i * 86));
    ty += lines.length * 86;
    ctx.fillStyle = TEAL; ctx.font = "600 30px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText(d.sub || "名額有限 · 即刻留位", 80, ty + 24);

    // 分隔線
    ctx.strokeStyle = "#e5e1d8"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(80, ty + 66); ctx.lineTo(1000, ty + 66); ctx.stroke();

    // 資訊（左）＋ QR（右）
    const by = ty + 118;
    ctx.fillStyle = MUTED; ctx.font = "700 24px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText("日期時段", 80, by);
    ctx.fillStyle = INK; ctx.font = "800 44px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText(d.dateStr || "待定", 80, by + 56);

    ctx.fillStyle = MUTED; ctx.font = "700 24px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText("集合地點", 80, by + 130);
    ctx.fillStyle = "#334155"; ctx.font = "600 34px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText((d.venue || "場地待定").slice(0, 18), 80, by + 180);

    ctx.fillStyle = MUTED; ctx.font = "700 24px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText("報名費用", 80, by + 254);
    ctx.fillStyle = GOLD; ctx.font = "800 56px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText("HK$" + (d.price || "") + " / 位", 80, by + 318);

    // QR：白底板 280、QR 200、上方膠囊標籤
    const qx = 700, qy = by + 10, qb = 280;
    try {
      const res = await fetch("/api/qr?text=" + encodeURIComponent(d.detailUrl || location.origin) + "&size=400");
      const j = await res.json();
      if (j.success) {
        const qr = await loadImage(j.data_url);
        if (qr) {
          // 膠囊
          ctx.fillStyle = "#0f766e";
          roundRect(ctx, qx + 24, qy - 54, 232, 46, 23); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = "800 24px -apple-system,'PingFang HK',sans-serif";
          ctx.textAlign = "center"; ctx.fillText("立即掃碼留位", qx + 140, qy - 23); ctx.textAlign = "left";
          // 白板 + 靜區
          ctx.save();
          ctx.shadowColor = "rgba(15,23,42,.14)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
          ctx.fillStyle = "#fff"; roundRect(ctx, qx, qy + 10, qb, qb, 26); ctx.fill();
          ctx.restore();
          ctx.drawImage(qr, qx + 40, qy + 50, qb - 80, qb - 80);
        }
      }
    } catch (e) {}

    // 底部（保留 160px 安全區）
    ctx.fillStyle = "#9aa6b2"; ctx.font = "500 26px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText("電子入場憑證 · 家長可代子女報名 · 免責與保險保障", 80, H - 196);
    ctx.fillStyle = TEAL; ctx.font = "800 30px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText("zenpass.hk", 80, H - 148);
    ctx.fillStyle = TEAL; ctx.fillRect(0, H - 12, W, 12);

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
