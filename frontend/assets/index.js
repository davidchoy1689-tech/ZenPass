// ZenPass Index JS — extracted from index.html

// ===== Skeleton Loader =====
(function(){
  if(typeof showSkeleton === 'function') return;
  var S = {grid:4,featured:3,booking:3,coach:6,activity:4,detail:1};
  window.showSkeleton = function(c,t,n){
    if(!c) return;
    n=n||S[t]||3;
    function L(w,h){return '<div class="sk-block sk-shimmer sk-'+h+' sk-'+w+' sk-mb-2"></div>'}
    var h='',i;
    if(t==='grid'||t==='course'){
      h='<div class="sk-grid">';
    }else if(t==='featured'){
      for(i=0;i<n;i++){h+='<div class="sk-flex sk-items-center sk-gap-3 sk-p-3">'+'<div class="sk-block sk-shimmer sk-h-10 sk-w-10 sk-rounded-full sk-flex-shrink-0"></div>'+'<div class="sk-flex-1">'+L('w-3\\/4','h-3')+L('w-1\\/2','h-3')+'</div></div>';}
    }else if(t==='booking'){
      for(i=0;i<n;i++){h+='<div class="sk-flex sk-items-center sk-gap-3 sk-p-3 sk-card sk-mb-3">'+'<div class="sk-block sk-shimmer sk-h-14 sk-w-14 sk-rounded sk-flex-shrink-0"></div>'+'<div class="sk-flex-1">'+L('w-3\\/4','h-4')+L('w-1\\/2','h-3')+L('w-1\\/3','h-3')+'</div></div>';}
    }else if(t==='detail'){
      h='<div style="max-width:600px;margin:0 auto;padding:16px">'+'<div class="sk-block sk-shimmer sk-h-40 sk-w-full sk-mb-4"></div>'+L('w-3\\/4','h-6')+L('w-full','h-4')+L('w-3\\/4','h-4')+'<div class="sk-flex sk-gap-3" style="margin-top:12px">'+'<div class="sk-block sk-shimmer sk-h-6 sk-w-20"></div>'+'<div class="sk-block sk-shimmer sk-h-6 sk-w-16"></div>'+'</div></div>';
    }
    c.innerHTML = h;
  };
})();

// ===== Inject Card Enhancement CSS =====
(function(){
  var s = document.createElement('style');
  s.textContent = `
    .credit-badge {
      display: inline-flex; align-items: center; gap: 2px;
      padding: 2px 8px; border-radius: 6px;
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff; font-size: 11px; font-weight: 700;
      white-space: nowrap;
    }
    html.dark .credit-badge { background: linear-gradient(135deg, #059669, #047857); }
    .class-card-price-row {
      display: flex; align-items: center; gap: 8px;
      margin-top: 4px;
    }
    .class-card-price { flex: 1; }
    .avail-dot {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 10px; color: #10b981; font-weight: 600;
    }
    .avail-green {
      width: 7px; height: 7px; border-radius: 50%;
      background: #10b981; display: inline-block;
      animation: availPulse 2s ease-in-out infinite;
    }
    .avail-red { width: 7px; height: 7px; border-radius: 50%; background: #ef4444; display: inline-block; }
    @keyframes availPulse {
      0%,100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .spots-urgent {
      color: #ef4444 !important;
      font-weight: 800 !important;
      animation: urgencyPulse 2s ease-in-out infinite;
    }
    @keyframes urgencyPulse {
      0%,100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.8; transform: scale(1.05); }
    }
    .class-card-spots { font-size: 11px; color: #6b7280; margin-top: 4px; }
    html.dark .class-card-spots { color: #94a3b8; }
    .diff-badge { display:inline-block; padding:1px 8px; border-radius:10px; font-size:10px; font-weight:600; margin-right:4px; }
    .diff-beginner { background:#e8f5e9; color:#2e7d32; }
    .diff-intermediate { background:#fff3e0; color:#e65100; }
    .diff-advanced { background:#fce4ec; color:#c62828; }
    html.dark .diff-beginner { background:#1b5e20; color:#a5d6a7; }
    html.dark .diff-intermediate { background:#e65100; color:#ffcc80; }
    html.dark .diff-advanced { background:#b71c1c; color:#ef9a9a; }
    .indie-badge { display:inline-block; padding:1px 8px; border-radius:10px; font-size:10px; font-weight:600; margin-right:4px; background:linear-gradient(135deg,#fbbf24,#f59e0b); color:#1a1a2e; }
    html.dark .indie-badge { background:linear-gradient(135deg,#b45309,#92400e); color:#fef3c7; }
    html.dark .class-card-price { color: #f1f5f9; }
  `;
  document.head.appendChild(s);
  // Modern card design CSS
  var mc = document.createElement('style');
  mc.textContent = `
    .modern-card{background:var(--white);border-radius:24px;overflow:hidden;border:1px solid var(--gray-200);box-shadow:0 1px 3px rgba(0,0,0,0.04);transition:all 0.3s cubic-bezier(0.4,0,0.2,1);display:flex;flex-direction:column;cursor:pointer}
    .modern-card:hover{transform:translateY(-8px);box-shadow:0 20px 40px -8px rgba(0,0,0,0.12),0 8px 16px -6px rgba(0,0,0,0.08)}
    html.dark .modern-card{background:#18181b;border-color:#27272a}html.dark .modern-card:hover{box-shadow:0 20px 40px -8px rgba(0,0,0,0.3)}
    .modern-card-img{aspect-ratio:16/10;overflow:hidden;position:relative}
    .modern-card-img .bg-img,.modern-card-img .bg{width:100%;height:100%;background-size:cover;background-position:center;transition:transform 0.5s cubic-bezier(0.4,0,0.2,1)}
    .modern-card:hover .modern-card-img .bg-img,.modern-card:hover .modern-card-img .bg{transform:scale(1.1)}
    .modern-card-badges{position:absolute;top:12px;left:12px;display:flex;flex-wrap:wrap;gap:6px;z-index:3}
    .modern-card-badge{padding:3px 12px;font-size:11px;font-weight:600;border-radius:99px;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.15)}
    .modern-card-badge.hot{background:#ef4444}
    .modern-card-badge.urgent{background:#10b981;animation:urgencyPulse 2s ease-in-out infinite}
    .modern-card-fav{position:absolute;top:12px;right:12px;width:36px;height:36px;background:rgba(255,255,255,0.9);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-radius:12px;border:none;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.1);cursor:pointer;transition:all 0.2s;z-index:3;font-size:18px;line-height:1;color:#a1a1aa;padding:0}
    .modern-card-fav:hover{transform:scale(1.12);color:#ef4444}
    .modern-card-fav.liked{color:#ef4444}
    html.dark .modern-card-fav{background:rgba(24,24,27,0.9);color:#71717a}
    .modern-card-body{padding:20px;flex:1;display:flex;flex-direction:column}
    .modern-card-tags{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    .modern-card-tag{padding:2px 10px;font-size:12px;background:var(--gray-100);border-radius:6px;color:var(--dark-700)}
    .modern-card-diff{font-size:12px;color:#10b981}
    html.dark .modern-card-tag{background:#27272a;color:#a1a1aa}
    html.dark .modern-card-diff{color:#34d399}
    .modern-card-title{font-weight:600;font-size:17px;line-height:1.3;margin-bottom:6px;color:var(--dark-900);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .modern-card:hover .modern-card-title{color:#10b981}
    html.dark .modern-card-title{color:#fafafa}
    html.dark .modern-card:hover .modern-card-title{color:#34d399}
    .modern-card-meta{font-size:13px;color:var(--dark-700);margin-bottom:12px}
    html.dark .modern-card-meta{color:#d4d4d8}
    .modern-card-review{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
    .modern-card-stars{color:#f59e0b;font-size:13px}
    .modern-card-review-count{color:var(--gray-300);font-size:12px}
    .modern-card-price{font-weight:600;color:#10b981;font-size:15px}
    .modern-card-price small{font-size:11px;color:var(--gray-300);font-weight:400}
    html.dark .modern-card-price{color:#34d399}
    .modern-card-schedule{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--gray-300);margin-bottom:16px}
    html.dark .modern-card-schedule{color:#71717a}
    .modern-card-cta{margin-top:auto;width:100%;padding:14px;border-radius:16px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-weight:600;font-size:14px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:all 0.2s;box-shadow:0 4px 14px rgba(16,185,129,0.3);font-family:inherit}
    .modern-card-cta:hover{background:linear-gradient(135deg,#059669,#047857)}
    .modern-card-cta:active{transform:scale(0.97)}
    .modern-card-cta .arrow{font-size:18px;line-height:1}
    html.dark .modern-card-cta{background:linear-gradient(135deg,#059669,#10b981)}
    html.dark .modern-card-cta:hover{background:linear-gradient(135deg,#047857,#059669)}
    .class-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;padding:0}
    @media(max-width:640px){.class-grid{grid-template-columns:repeat(2,1fr);gap:12px}}
    @media(max-width:400px){.class-grid{grid-template-columns:1fr;gap:12px}}
  `;
  document.head.appendChild(mc);
})();

// ===== Load Categories =====
async function loadCategories() {
  var container = document.getElementById("category-list");
  try {
    var result = await classes.categories();
    var categories = result.categories || [];
    container.innerHTML =
      '<div class="category-chip active" onclick="filterByCategory(\'all\', this)">🏠 全部</div>';
    for (var ci = 0; ci < categories.length; ci++) {
      var cat = categories[ci];
      var emoji =
        cat.category === "瑜伽"
          ? "🧘"
          : cat.category === "健身"
            ? "💪"
            : cat.category === "伸展"
              ? "🤸"
              : cat.category === "冥想"
                ? "🧠"
                : cat.category === "舞蹈"
                  ? "💃"
                  : cat.category === "新興運動"
                    ? "🎯"
                    : cat.category === "皮拉提斯"
                      ? "🤸"
                      : cat.category === "兒童體適能"
                        ? "🧒"
                        : cat.category === "肌力訓練"
                          ? "🏋️"
                          : cat.category === "心肺訓練"
                            ? "🏃"
                            : cat.category === "拳擊搏擊"
                              ? "🥊"
                              : cat.category === "單車"
                                ? "🚴"
                                : cat.category === "水中運動"
                                  ? "🏊"
                                  : cat.category === "太極養生"
                                    ? "☯️"
                                    : cat.category === "羽毛球"
                                      ? "🏸"
                                      : cat.category === "乒乓球"
                                        ? "🏓"
                                        : cat.category === "攀岩"
                                          ? "🧗"
                                          : cat.category === "射箭"
                                            ? "🏹"
                                            : cat.category === "劍擊"
                                              ? "🤺"
                                              : cat.category === "泰拳搏擊"
                                                ? "🦵"
                                                : cat.category === "高爾夫球"
                                                  ? "⛳"
                                                  : cat.category === "露營戶外"
                                                    ? "🏕️"
                                                    : cat.category ===
                                                        "長者體適能"
                                                      ? "👴"
                                                      : cat.category ===
                                                          "產後修復"
                                                        ? "🤰"
                                                        : cat.category ===
                                                            "空中瑜伽"
                                                          ? "🧘‍♀️"
                                                          : cat.category ===
                                                              "芭蕾塑形"
                                                            ? "💃"
                                                            : cat.category ===
                                                                "TRX 懸吊訓練"
                                                              ? "🏋️"
                                                              : cat.category ===
                                                                  "詠春"
                                                                ? "🥋"
                                                                : cat.category ===
                                                                    "遠足行山"
                                                                  ? "🥾"
                                                                  : cat.category ===
                                                                      "溜冰"
                                                                    ? "⛸️"
                                                                    : cat.category ===
                                                                        "網球"
                                                                      ? "🎾"
                                                                      : cat.category ===
                                                                          "保齡球"
                                                                        ? "🎳"
                                                                        : "🏃";
      container.innerHTML +=
        '<div class="category-chip" onclick="filterByCategory(\'' +
        cat.category +
        "', this)\">" +
        emoji +
        " " +
        cat.category +
        "</div>";
    }
  } catch (err) {
    container.innerHTML =
      '<div class="category-chip active" onclick="filterByCategory(\'all\', this)">🏠 全部</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'瑜伽\', this)">🧘 瑜伽</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'健身\', this)">💪 健身</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'伸展\', this)">🤸 伸展</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'冥想\', this)">🧠 冥想</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'舞蹈\', this)">💃 舞蹈</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'新興運動\', this)">🎯 新興運動</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'皮拉提斯\', this)">🤸 皮拉提斯</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'兒童體適能\', this)">🧒 兒童體適能</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'肌力訓練\', this)">🏋️ 肌力訓練</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'心肺訓練\', this)">🏃 心肺訓練</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'拳擊搏擊\', this)">🥊 拳擊搏擊</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'單車\', this)">🚴 單車</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'水中運動\', this)">🏊 水中運動</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'太極養生\', this)">☯️ 太極養生</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'羽毛球\', this)">🏸 羽毛球</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'乒乓球\', this)">🏓 乒乓球</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'攀岩\', this)">🧗 攀岩</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'射箭\', this)">🏹 射箭</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'劍擊\', this)">🤺 劍擊</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'泰拳搏擊\', this)">🦵 泰拳搏擊</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'高爾夫球\', this)">⛳ 高爾夫球</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'露營戶外\', this)">🏕️ 露營戶外</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'長者體適能\', this)">👴 長者體適能</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'產後修復\', this)">🤰 產後修復</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'空中瑜伽\', this)">🧘‍♀️ 空中瑜伽</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'芭蕾塑形\', this)">💃 芭蕾塑形</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'TRX 懸吊訓練\', this)">🏋️ TRX 懸吊訓練</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'詠春\', this)">🥋 詠春</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'遠足行山\', this)">🥾 遠足行山</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'溜冰\', this)">⛸️ 溜冰</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'網球\', this)">🎾 網球</div>' +
      '<div class="category-chip" onclick="filterByCategory(\'保齡球\', this)">🎳 保齡球</div>';
    ("");
  }
}

// ===== Filter by Category =====
function filterByCategory(category, el) {
  var chips = document.querySelectorAll(".category-chip");
  for (var ci = 0; ci < chips.length; ci++) {
    chips[ci].classList.remove("active");
  }
  el.classList.add("active");
  if (category === "all") {
    loadAllClasses({});
  } else {
    loadAllClasses({ category: category });
  }
}

// ===== Load Featured Classes =====
async function loadFeaturedClasses() {
  var container = document.getElementById("featured-classes");
  try {
    var result2 = await classes.list({ limit: 10, sort: "popular" });
    var items = result2.classes || [];
    if (items.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><span>🏋️</span><p>課程即將上線</p></div>';
      return;
    }
    container.innerHTML = items
      .map(function (cls) {
        return renderClassCard(cls);
      })
      .join("");
  } catch (err) {
    container.innerHTML =
      '<div class="class-card" style="flex:0 0 220px" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;font-size:32px">🧘</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">瑜伽 🧘</span>' +
      '<div class="class-card-title">流瑜伽 Flow Yoga</div>' +
      '<div class="class-card-meta">⏱ 60min 🧘‍♀️ 靜儀導師 ⭐4.9</div>' +
      '<div class="class-card-price">HK$120 <span class="badge-hot">🔥 熱門</span></div>' +
      '<div class="class-card-spots">剩餘 3 位</div>' +
      "</div>" +
      "</div>" +
      '<div class="class-card" style="flex:0 0 220px" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#f093fb,#f5576c);display:flex;align-items:center;justify-content:center;font-size:32px">💪</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">健身 💪</span>' +
      '<div class="class-card-title">HIIT 高強度間歇訓練</div>' +
      '<div class="class-card-meta">⏱ 45min 🏋️ Alex教練 ⭐4.8</div>' +
      '<div class="class-card-price">HK$150 <span class="badge-hot">🔥 熱門</span></div>' +
      '<div class="class-card-spots">剩餘 5 位</div>' +
      "</div>" +
      "</div>" +
      '<div class="class-card" style="flex:0 0 220px" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#a18cd1,#fbc2eb);display:flex;align-items:center;justify-content:center;font-size:32px">🧠</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">冥想 🧠</span>' +
      '<div class="class-card-title">正念冥想 初階班</div>' +
      '<div class="class-card-meta">⏱ 30min 🧘 慧心導師 ⭐4.7</div>' +
      '<div class="class-card-price">HK$80</div>' +
      '<div class="class-card-spots">剩餘 8 位</div>' +
      "</div>" +
      "</div>" +
      '<div class="class-card" style="flex:0 0 220px" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#ffecd2,#fcb69f);display:flex;align-items:center;justify-content:center;font-size:32px">💃</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">舞蹈 💃</span>' +
      '<div class="class-card-title">Zumba 舞動燃脂</div>' +
      '<div class="class-card-meta">⏱ 50min 💃 Grace導師 ⭐4.9</div>' +
      '<div class="class-card-price">HK$130 <span class="badge-hot">🔥 熱門</span></div>' +
      '<div class="class-card-spots">剩餘 2 位</div>' +
      "</div>" +
      "</div>" +
      '<div class="class-card" style="flex:0 0 220px" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#43e97b,#38f9d7);display:flex;align-items:center;justify-content:center;font-size:32px">🎯</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">新興運動 🎯</span>' +
      '<div class="class-card-title">匹克球 Pickleball</div>' +
      '<div class="class-card-meta">⏱ 60min 🎯 Ken教練 ⭐4.6</div>' +
      '<div class="class-card-price">HK$160</div>' +
      '<div class="class-card-spots">剩餘 6 位</div>' +
      "</div>" +
      "</div>" +
      "";
  }
}

// ===== Load All Classes =====
var _firstLoadAll = true;
async function loadAllClasses(params) {
  if (params === undefined) {
    params = {};
  }
  var container = document.getElementById("all-classes");
  if (!_firstLoadAll) {
    container.innerHTML = '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:0 8px">' + Array(6).fill('<div class="sk-block sk-shimmer" style="height:170px;border-radius:14px"></div>').join('') + '</div>';
  }
  _firstLoadAll = false;
  try {
    var mergedParams = { limit: 50 };
    for (var pk in params) {
      if (
        params.hasOwnProperty
          ? params.hasOwnProperty(pk)
          : params[pk] !== undefined
      ) {
        mergedParams[pk] = params[pk];
      }
    }
    var result = await classes.list(mergedParams);
    var items = result.classes || [];
    if (items.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><span>📭</span><p>暫無課程</p></div>';
      return;
    }
    // Show only 8 recommended courses on homepage
    var showItems = items.slice(0, 8);
    container.innerHTML = showItems
      .map(function (cls) {
        return renderClassCard(cls);
      })
      .join("");
  } catch (err) {
    // Rich demo data
    container.innerHTML =
      '<div class="class-card" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;font-size:32px">🧘</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">瑜伽</span>' +
      '<div class="class-card-title">流瑜伽 Flow Yoga</div>' +
      '<div class="class-card-meta">⏱ 60min · ⭐4.9 (128評價)</div>' +
      '<div class="class-card-coach">👩‍🏫 靜儀導師</div>' +
      '<div class="class-card-price">HK$120 <span class="badge-hot">🔥 熱門</span></div>' +
      '<div class="class-card-spots">剩餘 3 位</div>' +
      "</div>" +
      "</div>" +
      '<div class="class-card" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#f093fb,#f5576c);display:flex;align-items:center;justify-content:center;font-size:32px">💪</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">健身</span>' +
      '<div class="class-card-title">HIIT 高強度間歇訓練</div>' +
      '<div class="class-card-meta">⏱ 45min · ⭐4.8 (96評價)</div>' +
      '<div class="class-card-coach">👨‍🏫 Alex教練</div>' +
      '<div class="class-card-price">HK$150 <span class="badge-hot">🔥 熱門</span></div>' +
      '<div class="class-card-spots">剩餘 5 位</div>' +
      "</div>" +
      "</div>" +
      '<div class="class-card" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#a18cd1,#fbc2eb);display:flex;align-items:center;justify-content:center;font-size:32px">🧠</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">冥想</span>' +
      '<div class="class-card-title">正念冥想 初階班</div>' +
      '<div class="class-card-meta">⏱ 30min · ⭐4.7 (64評價)</div>' +
      '<div class="class-card-coach">🧘 慧心導師</div>' +
      '<div class="class-card-price">HK$80</div>' +
      '<div class="class-card-spots">剩餘 8 位</div>' +
      "</div>" +
      "</div>" +
      '<div class="class-card" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#ffecd2,#fcb69f);display:flex;align-items:center;justify-content:center;font-size:32px">💃</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">舞蹈</span>' +
      '<div class="class-card-title">Zumba 舞動燃脂</div>' +
      '<div class="class-card-meta">⏱ 50min · ⭐4.9 (156評價)</div>' +
      '<div class="class-card-coach">👩‍🏫 Grace導師</div>' +
      '<div class="class-card-price">HK$130 <span class="badge-hot">🔥 熱門</span></div>' +
      '<div class="class-card-spots">剩餘 2 位</div>' +
      "</div>" +
      "</div>" +
      '<div class="class-card" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#43e97b,#38f9d7);display:flex;align-items:center;justify-content:center;font-size:32px">🎯</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">新興運動</span>' +
      '<div class="class-card-title">匹克球 Pickleball</div>' +
      '<div class="class-card-meta">⏱ 60min · ⭐4.6 (42評價)</div>' +
      '<div class="class-card-coach">👨‍🏫 Ken教練</div>' +
      '<div class="class-card-price">HK$160</div>' +
      '<div class="class-card-spots">剩餘 6 位</div>' +
      "</div>" +
      "</div>" +
      '<div class="class-card" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#4facfe,#00f2fe);display:flex;align-items:center;justify-content:center;font-size:32px">🤸</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">普拉提</span>' +
      '<div class="class-card-title">器械普拉提 Reformer</div>' +
      '<div class="class-card-meta">⏱ 55min · ⭐4.8 (83評價)</div>' +
      '<div class="class-card-coach">👩‍🏫 Michelle導師</div>' +
      '<div class="class-card-price">HK$200</div>' +
      '<div class="class-card-spots">剩餘 4 位</div>' +
      "</div>" +
      "</div>" +
      '<div class="class-card" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#e74c3c,#c0392b);display:flex;align-items:center;justify-content:center;font-size:32px">🥋</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">武術</span>' +
      '<div class="class-card-title">巴西柔術 BJJ 初班</div>' +
      '<div class="class-card-meta">⏱ 75min · ⭐4.7 (55評價)</div>' +
      '<div class="class-card-coach">👨‍🏫 志強教練</div>' +
      '<div class="class-card-price">HK$180</div>' +
      '<div class="class-card-spots">剩餘 7 位</div>' +
      "</div>" +
      "</div>" +
      '<div class="class-card" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#abbaab,#ffffff);display:flex;align-items:center;justify-content:center;font-size:32px">☯️</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">太極</span>' +
      '<div class="class-card-title">陳式太極拳 24式</div>' +
      '<div class="class-card-meta">⏱ 60min · ⭐4.9 (112評價)</div>' +
      '<div class="class-card-coach">👨‍🏫 永年師傅</div>' +
      '<div class="class-card-price">HK$100</div>' +
      '<div class="class-card-spots">剩餘 10 位</div>' +
      "</div>" +
      "</div>" +
      '<div class="class-card" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#fa709a,#fee140);display:flex;align-items:center;justify-content:center;font-size:32px">🏃</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">健身</span>' +
      '<div class="class-card-title">戶外跑步訓練班</div>' +
      '<div class="class-card-meta">⏱ 45min · ⭐4.5 (38評價)</div>' +
      '<div class="class-card-coach">👨‍🏫 子軒教練</div>' +
      '<div class="class-card-price">HK$90</div>' +
      '<div class="class-card-spots">剩餘 12 位</div>' +
      "</div>" +
      "</div>" +
      '<div class="class-card" onclick="location.href=\'class-detail.html\'">' +
      '<div class="class-card-img" style="background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;font-size:32px">🧘</div>' +
      '<div class="class-card-body">' +
      '<span class="class-card-category">瑜伽</span>' +
      '<div class="class-card-title">陰瑜伽 Deep Stretch</div>' +
      '<div class="class-card-meta">⏱ 75min · ⭐4.6 (71評價)</div>' +
      '<div class="class-card-coach">👩‍🏫 Luna導師</div>' +
      '<div class="class-card-price">HK$140</div>' +
      '<div class="class-card-spots">剩餘 6 位</div>' +
      "</div>" +
      "</div>" +
      "";
  }
}

// ===== Render Class Card =====
function renderClassCard(cls) {
  var emojiMap = {
    瑜伽: "🧘",
    健身: "🏋️",
    伸展: "🤸",
    冥想: "🧠",
    舞蹈: "💃",
    新興運動: "🎯",
    普拉提: "🤸",
    武術: "🥋",
    太極: "☯️",
  };
  var emoji = emojiMap[cls.category] || "🏃";
  // Course image: use image_url if available, otherwise generate gradient placeholder
  var categoryGradients = {
    瑜伽: "linear-gradient(135deg,#667eea,#764ba2)",
    健身: "linear-gradient(135deg,#f093fb,#f5576c)",
    伸展: "linear-gradient(135deg,#4facfe,#00f2fe)",
    冥想: "linear-gradient(135deg,#a18cd1,#fbc2eb)",
    舞蹈: "linear-gradient(135deg,#ffecd2,#fcb69f)",
    新興運動: "linear-gradient(135deg,#43e97b,#38f9d7)",
    普拉提: "linear-gradient(135deg,#fa709a,#fee140)",
    武術: "linear-gradient(135deg,#e74c3c,#c0392b)",
    太極: "linear-gradient(135deg,#abbaab,#ffffff)",
  };
  var imgStyle = cls.image_url
    ? "background-image:url(" +
      cls.image_url +
      ");background-size:cover;background-position:center"
    : "background:" +
      (categoryGradients[cls.category] ||
        "linear-gradient(135deg,#667eea,#764ba2)") +
      ";display:flex;align-items:center;justify-content:center;font-size:32px";
  var price = cls.price_hkd ? "HK$" + cls.price_hkd : "";
  var rating = cls.rating || "⭐4.8";
  var spots = cls.remaining_spots !== undefined ? cls.remaining_spots : null;
  var coach = cls.coach_name || "";
  var isIndependent = cls.coach_type === 'independent' || cls.is_independent;
  var indoor = cls.indoor !== undefined ? cls.indoor : true; // default indoor
  // Credit cost: use API field or default to 12cr
  var creditCost = cls.credit_cost || (cls.pricing_tier === 'peak' ? 15 : 12);
  var creditBadge = '<span class="credit-badge">' + creditCost + 'cr</span>';
  // Hot badge
  var hot =
    cls.is_hot || cls.popular ? '<span class="spots-badge" style="background:rgba(239,68,68,0.9)">🔥 熱門</span>' : "";
  // Availability dot
  var availDot = spots !== null && spots > 0
    ? '<span class="avail-dot"><span class="avail-green"></span> 有位</span>'
    : spots === 0 ? '<span class="avail-dot"><span class="avail-red"></span> 滿額</span>' : '';
  // Schedule
  var schedule =
    cls.schedules && cls.schedules[0]
      ? '<div class="class-card-meta">📅 ' +
        formatDate(cls.schedules[0].start_time) +
        " " +
        formatTime(cls.schedules[0].start_time) +
        "</div>"
      : "";

  var favBtn = '<button class="fav-btn" onclick="event.stopPropagation();this.classList.toggle(\'liked\');this.classList.toggle(\'pop\');this.textContent=this.textContent===\'♡\'?\'♥\':\'♡\'">♡</button>';

  // Build badges
  var badgesHtml = '';
  if (hot) badgesHtml += hot;
  if (spots !== null && spots <= 3) badgesHtml += '<span class="modern-card-badge urgent">⚡ 僅剩 ' + spots + ' 位</span>';
  else if (spots !== null) badgesHtml += '<span class="modern-card-badge" style="background:#10b981">🟢 有位</span>';
  // Rating stars
  var starCount = cls.rating_num || 5;
  var stars = '★'.repeat(Math.round(starCount)) + '☆'.repeat(5 - Math.round(starCount));
  var reviewCount = cls.review_count || Math.floor(Math.random() * 30) + 10;
  // Schedule time
  // Generate varied demo times
  var timeDisplay = '';
  var idNum = parseInt(cls.id) || Math.floor(Math.random() * 100);
  var days = ['日','一','二','三','四','五','六'];
  if (cls.schedules && cls.schedules[0]) {
    var d = new Date(cls.schedules[0].start_time || cls.schedules[0].date);
    // Add variation based on class ID to avoid all cards showing same time
    var dayOffset = (idNum % 7);
    d.setDate(d.getDate() + dayOffset);
    var hours = [9,10,11,14,15,16,18,19,20][idNum % 9];
    var mins = [0,15,30,45][idNum % 4];
    d.setHours(hours, mins, 0, 0);
    timeDisplay = (d.getMonth()+1)+'/'+d.getDate()+' ('+days[d.getDay()]+') '+hours+':'+(mins<10?'0':'')+mins;
  } else {
    // Generate varied times based on class ID
    var today = new Date();
    var dayOffset = (idNum % 7) + 1;
    var d = new Date(today);
    d.setDate(d.getDate() + dayOffset);
    var hours = [9,10,11,14,15,16,18,19,20][idNum % 9];
    var mins = [0,15,30,45][idNum % 4];
    timeDisplay = (d.getMonth()+1)+'/'+d.getDate()+' ('+days[d.getDay()]+') '+hours+':'+(mins<10?'0':'')+mins;
  }

  return (
    '<div class="modern-card" data-title="' + (cls.title || '') + '" data-instructor="' + (cls.coach_name || '') + '" data-category="' + (cls.category || '') + '" data-location="' + (cls.venue_name || '') + '" data-difficulty="' + (cls.difficulty === 'beginner' ? '初級' : cls.difficulty === 'intermediate' ? '中級' : cls.difficulty === 'advanced' ? '高級' : '') + '" data-price="' + (cls.price_hkd || 0) + '" data-spots="' + (spots !== null ? spots : '') + '" data-time="' + hours + ':' + (mins<10?'0':'') + mins + '" data-credits="' + creditCost + '" onclick="location.href=\'class-detail.html?id=' +
    cls.id +
    "'\">" +
    '<div class="modern-card-img">' +
    '<div class="bg-img" style="' +
    imgStyle +
    '">' +
    (cls.image_url ? "" : '<div style="font-size:32px;display:flex;align-items:center;justify-content:center;height:100%">' + emoji + '</div>') +
    "</div>" +
    '<div class="modern-card-badges">' +
    badgesHtml +
    "</div>" +
    '<button class="modern-card-fav" onclick="event.stopPropagation();toggleFavorite(this)">♡</button>' +
    "</div>" +
    '<div class="modern-card-body">' +
    '<div class="modern-card-tags">' +
    '<span class="modern-card-tag">' + (cls.category || '') + '</span>' +
    (cls.difficulty ? '<span class="modern-card-diff">· ' + (cls.difficulty === 'beginner' ? '初級' : cls.difficulty === 'intermediate' ? '中級' : '高級') + '</span>' : '') +
    "</div>" +
    '<div class="modern-card-title">' + cls.title + "</div>" +
    '<div class="modern-card-meta">' +
    (coach ? '👩‍🏫 ' + coach : '') +
    (cls.venue_name ? ' · 📍' + cls.venue_name : '') +
    (cls.mtr_station ? ' · 🚇' + cls.mtr_station : '') +
    "</div>" +
    '<div class="modern-card-review">' +
    '<div><span class="modern-card-stars">' + stars + '</span><span class="modern-card-review-count"> (' + reviewCount + ')</span></div>' +
    '<div class="modern-card-price">' + price + ' <small>/ 1 Pass</small></div>' +
    "</div>" +
    '<div class="modern-card-schedule">' +
    '<span>📅 ' + timeDisplay + '</span>' +
    '<span>⏱️ ' + (cls.duration_min || 60) + ' 分鐘</span>' +
    "</div>" +
    '<button class="modern-card-cta" onclick="event.stopPropagation();bookClass(this)" data-id="' + cls.id + '">立即預約<span class="arrow">→</span></button>' +
    "</div></div>"
  );
}

// ===== Search =====
function handleSearch(e) {
  if (e && e.key !== "Enter" && e.key !== undefined) return;
  var query = document.getElementById("search-input").value.trim();
  if (query) {
    window.location.href = "explore.html?search=" + encodeURIComponent(query);
  }
}

// ===== Favorite Toggle =====
function toggleFavorite(btn) {
  var heart = btn.querySelector('span');
  if (!heart) return;
  if (heart.textContent === '♡') {
    heart.textContent = '♥';
    heart.classList.add('text-red-500');
    btn.classList.add('liked');
  } else {
    heart.textContent = '♡';
    heart.classList.remove('text-red-500');
    btn.classList.remove('liked');
  }
}

// ===== Quick Book (card CTA) =====
function bookClass(btn) {
  var id = btn.getAttribute('data-id');
  if (id) window.location.href = 'class-detail.html?id=' + id;
}

// ===== User Menu Placeholder =====
function showMyBookings() {
  showToast("預約功能即將上線", "info");
}

// ===== Load Recommendations =====
async function loadRecommendations() {
  try {
    var result = await apiRequest("GET", "/recommendations?limit=10");
    var items = result.classes || [];
    if (items.length === 0) {
      return;
    }
    var section = document.getElementById("recommended-section");
    var container = document.getElementById("recommended-classes");
    if (!section || !container) return;
    container.innerHTML = items
      .map(function (cls) {
        return renderClassCard(cls);
      })
      .join("");
    section.style.display = "";
  } catch (err) {
    // 推薦載入失敗唔影響頁面
    console.log("推薦加載跳過:", err.message);
  }
}

function showMyMembership() {
  showToast("會籍功能即將上線", "info");
}

function showMyProfile() {
  showToast("個人資料功能即將上線", "info");
}

// ===== Init =====
document.addEventListener("DOMContentLoaded", function () {
  loadCategories();
  loadFeaturedClasses();
  loadAllClasses();
  loadRecommendations();
  updateNavBar();
});

// Bind click handlers for login/register/search
var loginBtn = document.getElementById("zenBtnLogin");
if (loginBtn)
  loginBtn.addEventListener("click", function (e) {
    e.preventDefault();
    showLoginModal();
  });
var regBtn = document.getElementById("zenBtnRegister");
if (regBtn)
  regBtn.addEventListener("click", function (e) {
    e.preventDefault();
    showLoginModal();
  });
var searchBtn = document.getElementById("searchBtn");
if (searchBtn) searchBtn.addEventListener("click", handleSearch);
