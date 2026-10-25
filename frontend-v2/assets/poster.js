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

  window.zpMakePoster = async function (d) {
    const W = 1080, H = 1920;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");

    // 背景
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0f172a"); g.addColorStop(0.5, "#0f766e"); g.addColorStop(1, "#064e3b");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(W / 2, -140, 640, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H + 180, 720, Math.PI, Math.PI * 2); ctx.stroke();

    // 品牌
    ctx.fillStyle = "#fff";
    ctx.font = "800 46px -apple-system, 'PingFang HK', 'Noto Sans TC', sans-serif";
    ctx.fillText("ZENPASS", 80, 150);
    ctx.fillStyle = "#f59e0b";
    ctx.font = "600 26px -apple-system, 'PingFang HK', sans-serif";
    ctx.fillText("禪流 · 新興運動體驗", 80, 196);
    if (d.starred) {
      ctx.fillStyle = "#fbbf24"; ctx.textAlign = "right";
      ctx.font = "800 26px -apple-system, 'PingFang HK', sans-serif";
      ctx.fillText("★ 星級教練", W - 80, 150);
      ctx.textAlign = "left";
    }

    // 封面：16:10 橫幅（唔裁走原圖內容）
    const cw = 920, ch = Math.round(cw * 10 / 16), cx = 80, cy = 240, r = 36;
    const cover = await loadImage(d.coverUrl || "/assets/images/default-sport.svg");
    ctx.save();
    roundRect(ctx, cx, cy, cw, ch, r);
    ctx.clip();
    ctx.fillStyle = "#0b3b37"; ctx.fillRect(cx, cy, cw, ch);
    if (cover) {
      const sc = Math.min(cw / cover.naturalWidth, ch / cover.naturalHeight);
      const dw = cover.naturalWidth * sc, dh = cover.naturalHeight * sc;
      ctx.drawImage(cover, cx + (cw - dw) / 2, cy + (ch - dh) / 2, dw, dh);
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 3;
    roundRect(ctx, cx, cy, cw, ch, r); ctx.stroke();

    // 標題（自動換行，最多 2 行）
    let ty = cy + ch + 110;
    ctx.fillStyle = "#fff";
    ctx.font = "800 60px -apple-system, 'PingFang HK', 'Noto Sans TC', sans-serif";
    const lines = wrapLines(ctx, d.title || "新興運動體驗班", 920, 2);
    lines.forEach((ln, i) => ctx.fillText(ln, 80, ty + i * 74));
    ty += lines.length * 74 + 26;

    // 資訊卡
    const boxY = ty, boxH = 210;
    ctx.fillStyle = "rgba(255,255,255,.13)";
    roundRect(ctx, 80, boxY, 920, boxH, 26); ctx.fill();
    ctx.fillStyle = "#f8fafc";
    ctx.font = "500 34px -apple-system, 'PingFang HK', sans-serif";
    ctx.fillText("日期　" + (d.dateStr || ""), 120, boxY + 68);
    ctx.fillText("地點　" + (d.venue || "場地待定"), 120, boxY + 126);
    ctx.fillStyle = "#fbbf24";
    ctx.font = "800 40px -apple-system, 'PingFang HK', sans-serif";
    ctx.fillText("HK$" + (d.price || "") + " / 位", 120, boxY + 186);

    // QR（右下，留白框）
    const qrBox = { x: 748, y: H - 500, w: 252, h: 252 };
    try {
      const res = await fetch("/api/qr?text=" + encodeURIComponent(d.detailUrl || location.origin) + "&size=320");
      const j = await res.json();
      if (j.success) {
        const qrImg = await loadImage(j.data_url);
        if (qrImg) {
          ctx.fillStyle = "#fff";
          roundRect(ctx, qrBox.x, qrBox.y, qrBox.w, qrBox.h, 22); ctx.fill();
          ctx.drawImage(qrImg, qrBox.x + 18, qrBox.y + 18, qrBox.w - 36, qrBox.h - 36);
        }
      }
    } catch (e) {}

    // 左下文案（與 QR 分欄，唔會疊）
    const footY = H - 470;
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "800 40px -apple-system, 'PingFang HK', sans-serif";
    ctx.fillText("掃碼即報名", 80, footY + 40);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "26px -apple-system, 'PingFang HK', sans-serif";
    ctx.fillText("家長代報 · 電子入場憑證", 80, footY + 96);
    ctx.fillText("安全免責保障", 80, footY + 140);

    // 底部品牌帶
    ctx.fillStyle = "rgba(255,255,255,.08)";
    ctx.fillRect(0, H - 130, W, 130);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "700 30px -apple-system, 'PingFang HK', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("zenpass.hk　·　香港康樂及體育有限公司", W / 2, H - 62);
    ctx.textAlign = "left";

    // 導出
    const dataUrl = cv.toDataURL("image/jpeg", 0.92);
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
