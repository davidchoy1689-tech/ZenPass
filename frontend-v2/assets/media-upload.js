/* ZenPass — 合作夥伴相片上載（最多 5 張、每張 ≤5MB、格式限制、壓縮、相關性承諾）
 * 用法：
 *   <div id="zpPhotoMount"></div>
 *   <script src="assets/media-upload.js?v=1"></script>
 *   const up = window.zpMountPhotoUpload({ mount:"zpPhotoMount", max:5, maxMB:5, title:"活動／場地相片" });
 *   up.getUrls()   // → Promise<string[]>（上載完成後嘅 URL；冇上載回傳 []）
 *   up.validate()  // → true/false（有相就必須勾相關性承諾）
 */
(function () {
  const MAX_MB = 5;
  const OK_TYPES = ["image/jpeg", "image/png", "image/webp"];

  function fmtSize(bytes) { return (bytes / 1024 / 1024).toFixed(1) + "MB"; }

  // 壓縮 + 轉 WebP（canvas），控制體積
  function compress(file, maxDim = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          let { width: w, height: h } = img;
          const scale = Math.min(1, maxDim / Math.max(w, h));
          w = Math.round(w * scale); h = Math.round(h * scale);
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          c.toBlob((blob) => {
            URL.revokeObjectURL(url);
            if (!blob) return reject(new Error("壓縮失敗"));
            resolve(new File([blob], (file.name || "photo").replace(/\.\w+$/, "") + ".webp", { type: "image/webp" }));
          }, "image/webp", quality);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("圖片讀取失敗")); };
      img.src = url;
    });
  }

  window.zpMountPhotoUpload = function (opts) {
    const o = Object.assign({ mount: "zpPhotoMount", max: 5, maxMB: MAX_MB, title: "活動／場地相片", uploadPath: "/upload" }, opts || {});
    const host = document.getElementById(o.mount);
    if (!host) return { getUrls: async () => [], validate: () => true };

    host.innerHTML = `
      <div class="zp-mu">
        <div class="zp-mu-head"><b>🖼️ ${o.title}（最多 ${o.max} 張）</b><span id="zpMuCount">0 / ${o.max}</span></div>
        <p class="zp-mu-tip">支援 JPG／PNG／WebP，每張 ≤ ${o.maxMB}MB；系統會自動壓縮。上載圖片必須與活動、教練或場地直接相關。</p>
        <div class="zp-mu-grid" id="zpMuGrid">
          <label class="zp-mu-add" id="zpMuAdd">
            <input type="file" id="zpMuInput" accept="image/jpeg,image/png,image/webp" multiple hidden />
            <span class="i">＋</span><span class="t">新增相片</span>
          </label>
        </div>
        <label class="zp-mu-chk"><input type="checkbox" id="zpMuAgree" />
          <span>本人承諾所上載之圖片與本運動項目或場地完全相關，且不含任何侵權或違規內容。*</span></label>
        <div class="zp-mu-msg" id="zpMuMsg"></div>
      </div>`;

    const grid = host.querySelector("#zpMuGrid");
    const add = host.querySelector("#zpMuAdd");
    const input = host.querySelector("#zpMuInput");
    const count = host.querySelector("#zpMuCount");
    const msg = host.querySelector("#zpMuMsg");
    let items = []; // { id, file, src, url? }

    function render() {
      grid.querySelectorAll(".zp-mu-thumb").forEach((n) => n.remove());
      items.forEach((it) => {
        const d = document.createElement("div");
        d.className = "zp-mu-thumb";
        d.innerHTML = `<img src="${it.src}" alt=""><button type="button" class="x" data-id="${it.id}">✕</button>`;
        grid.insertBefore(d, add);
        d.querySelector(".x").onclick = () => { items = items.filter((x) => x.id !== it.id); render(); };
      });
      count.textContent = `${items.length} / ${o.max}`;
      add.style.display = items.length >= o.max ? "none" : "flex";
    }

    input.onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      input.value = "";
      for (const f of files) {
        if (items.length >= o.max) { alert(`最多 ${o.max} 張相片`); break; }
        if (!OK_TYPES.includes(f.type)) { alert(`不支援格式：${f.name}（請用 JPG／PNG／WebP）`); continue; }
        if (f.size > o.maxMB * 1024 * 1024) { alert(`相片太大：${f.name}（${fmtSize(f.size)}，上限 ${o.maxMB}MB）`); continue; }
        try {
          const small = await compress(f);
          const src = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(small); });
          items.push({ id: Date.now() + Math.random().toString(36).slice(2, 6), file: small, src });
          render();
        } catch (err) { alert("處理圖片失敗：" + err.message); }
      }
    };

    function validate() {
      if (!items.length) return true; // 冇相 → 用系統預設圖
      const ok = host.querySelector("#zpMuAgree").checked;
      if (!ok) { alert("請勾選：圖片與運動項目／場地相關且無侵權"); return false; }
      return true;
    }

    async function getUrls() {
      if (!items.length) return [];
      if (!validate()) return null;
      msg.textContent = "上載中…";
      const urls = [];
      for (const it of items) {
        try {
          const fd = new FormData();
          fd.append("files", it.file, it.file.name);
          const r = await fetch("/api" + o.uploadPath, { method: "POST", body: fd, credentials: "include",
            headers: (function(){ try { const t = JSON.parse(localStorage.getItem("zenpass_token")||"null"); return t ? { Authorization: "Bearer " + (t.token || t) } : {}; } catch(e){ return {}; } })() });
          const j = await r.json();
          if (j && j.files && j.files[0]) urls.push(j.files[0].url);
          else if (j && j.url) urls.push(j.url);
        } catch (e) { /* 單張失敗唔阻止其他 */ }
      }
      msg.textContent = urls.length ? `✅ 已上載 ${urls.length} 張` : "⚠️ 上載失敗，將使用系統預設圖";
      return urls;
    }

    // 樣式
    if (!document.getElementById("zpMuStyle")) {
      const css = `
      .zp-mu{background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:14px;padding:14px;margin:12px 0}
      .zp-mu-head{display:flex;justify-content:space-between;align-items:center;font-size:13.5px}
      .zp-mu-head span{font-size:12px;color:var(--text-muted,#64748b);font-weight:700}
      .zp-mu-tip{font-size:11.5px;color:var(--text-muted,#64748b);margin:6px 0 12px;line-height:1.5}
      .zp-mu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:9px;margin-bottom:10px}
      .zp-mu-add{aspect-ratio:1;border:2px dashed #cbd5e1;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:11px;color:#475569;font-weight:700;cursor:pointer;background:#f8fafc}
      .zp-mu-add:hover{border-color:#ff6b35;background:#fff7f2}
      .zp-mu-add .i{font-size:18px;line-height:1}
      .zp-mu-thumb{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;border:1px solid var(--border,#e2e8f0)}
      .zp-mu-thumb img{width:100%;height:100%;object-fit:cover}
      .zp-mu-thumb .x{position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;border:0;background:rgba(15,23,42,.72);color:#fff;font-size:10px}
      .zp-mu-chk{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.55;color:var(--text,#334155)}
      .zp-mu-msg{font-size:12px;color:var(--text-muted,#64748b);margin-top:6px;min-height:14px}
      `;
      const st = document.createElement("style"); st.id = "zpMuStyle"; st.textContent = css; document.head.appendChild(st);
    }

    return { getUrls, validate, count: () => items.length, clear: () => { items = []; render(); } };
  };
})();
