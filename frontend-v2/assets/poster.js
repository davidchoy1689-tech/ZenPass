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
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    // 背景漸變
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0f172a");
    g.addColorStop(0.45, "#0f766e");
    g.addColorStop(1, "#064e3b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 裝飾弧線
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(W / 2, -120, 620, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H + 160, 700, Math.PI, Math.PI * 2); ctx.stroke();

    // 品牌列
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 46px -apple-system, 'PingFang HK', 'Noto Sans TC', sans-serif";
    ctx.fillText("ZENPASS", 80, 150);
    ctx.fillStyle = "#f59e0b";
    ctx.font = "600 26px -apple-system, 'PingFang HK', sans-serif";
    ctx.fillText("禪流 · 新興運動體驗", 80, 196);
    if (d.starred) {
      ctx.fillStyle = "#fbbf24";
      ctx.font = "800 26px -apple-system, 'PingFang HK', sans-serif";
      ctx.textAlign = "right";
      ctx.fillText("⭐ 星級教練", W - 80, 150);
      ctx.textAlign = "left";
    }

    // 封面圖（圓角）
    const imgX = 80, imgY = 250, imgW = 920, imgH = 880, radius = 40;
    const cover = await loadImage(d.coverUrl || "/assets/images/default-sport.svg");
    ctx.save();
    roundRect(ctx, imgX, imgY, imgW, imgH, radius);
    ctx.clip();
    if (cover) {
      const scale = Math.max(imgW / cover.naturalWidth, imgH / cover.naturalHeight);
      const sw = imgW / scale, sh = imgH / scale;
      const sx = (cover.naturalWidth - sw) / 2, sy = (cover.naturalHeight - sh) / 2;
      ctx.drawImage(cover, sx, sy, sw, sh, imgX, imgY, imgW, imgH);
    } else {
      ctx.fillStyle = "#115e59";
      ctx.fillRect(imgX, imgY, imgW, imgH);
    }
    ctx.restore();

    // 標題
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 62px -apple-system, 'PingFang HK', 'Noto Sans TC', sans-serif";
    wrapText(ctx, d.title || "新興運動體驗班", 80, 1230, 920, 76, 2);

    // 資訊卡
    ctx.fillStyle = "rgba(255,255,255,.14)";
    roundRect(ctx, 80, 1350, 920, 210, 28);
    ctx.fill();
    ctx.fillStyle = "#f8fafc";
    ctx.font = "500 34px -apple-system, 'PingFang HK', sans-serif";
    ctx.fillText(`🗓 ${d.dateStr || ""}`, 120, 1415);
    ctx.fillText(`📍 ${d.venue || "場地待定"}`, 120, 1475);
    ctx.font = "800 38px -apple-system, 'PingFang HK', sans-serif";
    ctx.fillStyle = "#fbbf24";
    ctx.fillText(`HK$${d.price || ""} / 位`, 120, 1535);

    // QR
    try {
      const qrRes = await fetch("/api/qr?text=" + encodeURIComponent(d.detailUrl || location.origin) + "&size=300");
      const qrJson = await qrRes.json();
      if (qrJson.success) {
        const qrImg = await loadImage(qrJson.data_url);
        if (qrImg) {
          ctx.fillStyle = "#ffffff";
          roundRect(ctx, 760, 1590, 240, 250, 20);
          ctx.fill();
          ctx.drawImage(qrImg, 776, 1606, 208, 208);
          ctx.fillStyle = "#0f172a";
          ctx.font = "700 20px -apple-system, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("掃碼報名", 880, 1834);
          ctx.textAlign = "left";
        }
      }
    } catch (e) { /* QR 失敗不影響海報 */ }

    // 底部文字
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "700 36px -apple-system, 'PingFang HK', sans-serif";
    ctx.fillText("長按識別 QR Code 報名", 80, 1640);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "26px -apple-system, 'PingFang HK', sans-serif";
    ctx.fillText("家長代報 · 電子入場憑證 · 安全免責保障", 80, 1695);
    ctx.fillText("zenpass.hk", 80, 1745);

    const url = canvas.toDataURL("image/jpeg", 0.92);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ZenPass-IGStory-" + (d.slug || Date.now()) + ".jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return url;
  };
})();
