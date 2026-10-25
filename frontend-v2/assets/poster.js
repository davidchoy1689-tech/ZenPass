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
    const GOLD = "#f5b73b", INK = "#0f172a";

    // ===== 背景 =====
    const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
    bg.addColorStop(0, "#0b1b2b"); bg.addColorStop(0.55, "#0d4f4a"); bg.addColorStop(1, "#062e26");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.85, 120, 0, W * 0.85, 120, 900);
    glow.addColorStop(0, "rgba(245,183,59,.22)"); glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 2;
    for (let i = -1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(-100, 260 + i * 300); ctx.lineTo(W + 100, 60 + i * 300); ctx.stroke(); }

    // ===== 品牌列 =====
    ctx.fillStyle = "#fff";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
    ctx.font = "800 44px -apple-system,'PingFang HK','Noto Sans TC',sans-serif";
    ctx.fillText("ZENPASS", 80, 132);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.fillStyle = "rgba(255,255,255,.6)";
    ctx.font = "600 24px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText("禪流 · 新興運動體驗", 80, 176);
    if (d.starred) {
      const bw = 220, bh = 56, bx = W - 80 - bw, by = 96;
      ctx.fillStyle = "rgba(245,183,59,.16)";
      roundRect(ctx, bx, by, bw, bh, 28); ctx.fill();
      ctx.strokeStyle = "rgba(245,183,59,.55)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = GOLD; ctx.font = "800 26px -apple-system,'PingFang HK',sans-serif";
      ctx.textAlign = "center"; ctx.fillText("★ 星級教練", bx + bw / 2, by + 38); ctx.textAlign = "left";
    }

    // ===== 主視覺 =====
    const hx = 80, hy = 240, hw = 920, hh = 760, hr = 44;
    const cover = await loadImage(d.coverUrl || "/assets/images/default-sport.svg");
    ctx.save(); roundRect(ctx, hx, hy, hw, hh, hr); ctx.clip();
    ctx.fillStyle = "#0a3b36"; ctx.fillRect(hx, hy, hw, hh);
    if (cover) {
      const sc = Math.max(hw / cover.naturalWidth, hh / cover.naturalHeight);
      const dw = cover.naturalWidth * sc, dh = cover.naturalHeight * sc;
      ctx.drawImage(cover, hx + (hw - dw) / 2, hy + (hh - dh) / 2, dw, dh);
    }
    const ov = ctx.createLinearGradient(0, hy + hh * 0.45, 0, hy + hh);
    ov.addColorStop(0, "rgba(6,20,18,0)"); ov.addColorStop(1, "rgba(6,20,18,.88)");
    ctx.fillStyle = ov; ctx.fillRect(hx, hy, hw, hh);
    ctx.restore();

    // 標題壓在主視覺底部
    const titleLines = wrapLines(ctx, d.title || "新興運動體驗班", 840, 2);
    ctx.fillStyle = "#fff";
    ctx.font = "800 56px -apple-system,'PingFang HK','Noto Sans TC',sans-serif";
    const titleBase = hy + hh - 40 - (titleLines.length - 1) * 66;
    titleLines.forEach((ln, i) => ctx.fillText(ln, hx + 34, titleBase + i * 66));
    // 地點小膠囊
    const venueChip = (d.venue || "").slice(0, 22);
    if (venueChip) {
      ctx.font = "600 24px -apple-system,'PingFang HK',sans-serif";
      const tw = ctx.measureText(venueChip).width + 34;
      const cy2 = titleBase - 56 * titleLines.length - 6;
      ctx.fillStyle = "rgba(255,255,255,.16)";
      roundRect(ctx, hx + 34, cy2, tw, 46, 23); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillText(venueChip, hx + 34 + 17, cy2 + 32);
    }

    // ===== 資訊卡 =====
    const ix = 80, iy = hy + hh + 46, iw = 920, ih = 330;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    ctx.fillStyle = "#ffffff"; roundRect(ctx, ix, iy, iw, ih, 34); ctx.fill();
    ctx.restore();

    const rows = [
      ["日期", d.dateStr || "待定"],
      ["地點", d.venue || "場地待定"],
      ["費用", "HK$" + (d.price || "") + " / 位"],
    ];
    rows.forEach(([k, v], i) => {
      const ry = iy + 96 + i * 96;
      ctx.fillStyle = "#94a3b8"; ctx.font = "700 24px -apple-system,'PingFang HK',sans-serif";
      ctx.fillText(k, ix + 44, ry);
      ctx.fillStyle = i === 2 ? "#b45309" : INK;
      ctx.font = i === 2 ? "800 40px -apple-system,'PingFang HK',sans-serif" : "700 34px -apple-system,'PingFang HK',sans-serif";
      ctx.fillText(v, ix + 150, ry);
      if (i < 2) { ctx.strokeStyle = "#eef2f7"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ix + 44, ry + 32); ctx.lineTo(ix + iw - 44, ry + 32); ctx.stroke(); }
    });

    // ===== 底部：QR + 賣點 =====
    const qy = iy + ih + 60;
    // QR 白卡
    try {
      const res = await fetch("/api/qr?text=" + encodeURIComponent(d.detailUrl || location.origin) + "&size=320");
      const j = await res.json();
      if (j.success) {
        const qr = await loadImage(j.data_url);
        if (qr) {
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,.3)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
          ctx.fillStyle = "#fff"; roundRect(ctx, 740, qy, 260, 286, 26); ctx.fill();
          ctx.restore();
          ctx.drawImage(qr, 762, qy + 22, 216, 216);
          ctx.fillStyle = GOLD; ctx.font = "800 24px -apple-system,'PingFang HK',sans-serif";
          ctx.textAlign = "center"; ctx.fillText("掃碼報名", 870, qy + 268); ctx.textAlign = "left";
        }
      }
    } catch (e) {}

    ctx.fillStyle = "#fff"; ctx.font = "800 42px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText("即刻網上報名", 80, qy + 60);
    const bullets = ["電子入場憑證 QR", "家長可代子女報名", "免責與保險保障"];
    bullets.forEach((b, i) => {
      const by2 = qy + 128 + i * 62;
      ctx.fillStyle = "rgba(245,183,59,.9)"; ctx.beginPath(); ctx.arc(94, by2 - 9, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.82)"; ctx.font = "500 28px -apple-system,'PingFang HK',sans-serif";
      ctx.fillText(b, 118, by2);
    });

    // ===== 底部品牌帶 =====
    const fy = H - 132;
    ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(0, fy, W, 132);
    ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.font = "800 30px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText("zenpass.hk", 80, fy + 56);
    ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.font = "500 22px -apple-system,'PingFang HK',sans-serif";
    ctx.fillText("香港康樂及體育有限公司 ZenPass 禪流", 80, fy + 96);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "2px";
    ctx.textAlign = "right"; ctx.fillStyle = GOLD; ctx.font = "800 24px -apple-system,sans-serif";
    ctx.fillText("SPORT & WELLNESS", W - 80, fy + 66);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.textAlign = "left";

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
