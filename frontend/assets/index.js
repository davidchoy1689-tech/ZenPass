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
async function loadAllClasses(params) {
  if (params === undefined) {
    params = {};
  }
  var container = document.getElementById("all-classes");
  container.innerHTML = '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:0 8px">' + Array(6).fill('<div class="sk-block sk-shimmer" style="height:170px;border-radius:14px"></div>').join('') + '</div>';
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
  var hot =
    cls.is_hot || cls.popular ? '<span class="spots-badge" style="background:rgba(239,68,68,0.9)">🔥 熱門</span>' : "";
  var schedule =
    cls.schedules && cls.schedules[0]
      ? '<div class="class-card-meta">📅 ' +
        formatDate(cls.schedules[0].start_time) +
        " " +
        formatTime(cls.schedules[0].start_time) +
        "</div>"
      : "";

  var favBtn = '<button class="fav-btn" onclick="event.stopPropagation();this.classList.toggle(\'liked\');this.classList.toggle(\'pop\');this.textContent=this.textContent===\'♡\'?\'♥\':\'♡\'">♡</button>';

  return (
    '<div class="class-card" onclick="location.href=\'class-detail.html?id=' +
    cls.id +
    "'\">" +
    '<div class="class-card-img" style="position:relative;' +
    imgStyle +
    '">' +
    favBtn +
    (cls.image_url ? "" : emoji) +
    "</div>" +
    '<div class="class-card-body">' +
    '<span class="class-card-category">' +
    cls.category +
    "</span>" +
    '<div class="class-card-title">' +
    cls.title +
    "</div>" +
    (schedule
      ? schedule
      : '<div class="class-card-meta">⏱ ' +
        (cls.duration_min || 60) +
        "min · " +
        rating +
        (coach ? " · 👩‍🏫 " + coach : "") +
        "</div>") +
    '<div class="class-card-price">' +
    price +
    " " +
    hot +
    "</div>" +
    (spots !== null
      ? '<div class="class-card-spots' + (spots <= 3 ? ' spots-urgent' : '') + '">' + (spots <= 3 ? '⚡ 僅剩 ' : '剩餘 ') + spots + ' 位</div>'
      : "") +
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

// ===== Feedback Widget =====
(function(){
  // Inject CSS
  var css = document.createElement('style');
  css.textContent = `
    .fb-toggle {
      position: fixed; bottom: 80px; left: 16px; z-index: 999;
      display: flex; align-items: center; gap: 6px;
      padding: 10px 16px; border-radius: 50px;
      background: linear-gradient(135deg, #6366f1, #4f46e5);
      color: #fff; font-size: 13px; font-weight: 700;
      border: none; cursor: pointer;
      box-shadow: 0 4px 15px rgba(99,102,241,0.4);
      transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
    }
    .fb-toggle:hover { transform: translateY(-3px) scale(1.05); box-shadow: 0 6px 20px rgba(99,102,241,0.5); }
    .fb-toggle:active { transform: scale(0.95); }
    @media(max-width:767px){.fb-toggle { bottom: 80px; left: 12px; padding: 10px; border-radius: 50%; min-width: 44px; min-height: 44px; justify-content: center; } .fb-toggle .fb-label { display: none; }}
    html.dark .fb-toggle { background: linear-gradient(135deg, #818cf8, #6366f1); }

    .fb-overlay {
      position: fixed; inset: 0; z-index: 1001;
      background: rgba(0,0,0,0.4);
      backdrop-filter: blur(4px);
      display: none; opacity: 0;
      transition: opacity 0.3s ease;
    }
    .fb-overlay.open { display: block; opacity: 1; }

    .fb-modal {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 1002;
      background: var(--white, #fff);
      border-radius: 20px 20px 0 0;
      padding: 24px 20px 32px;
      max-height: 85vh; overflow-y: auto;
      transform: translateY(100%);
      transition: transform 0.4s cubic-bezier(0.4,0,0.2,1);
      box-shadow: 0 -8px 30px rgba(0,0,0,0.12);
    }
    .fb-modal.open { transform: translateY(0); }
    @media(min-width:768px){
      .fb-modal { left: 50%; bottom: auto; top: 50%; transform: translate(-50%,-50%) scale(0.9); width: 420px; max-height: 80vh; border-radius: 20px; }
      .fb-modal.open { transform: translate(-50%,-50%) scale(1); }
    }
    html.dark .fb-modal { background: #1e293b; }

    .fb-handle {
      width: 36px; height: 4px; border-radius: 2px; background: var(--gray-300, #d1d5db);
      margin: 0 auto 16px;
    }
    .fb-title { font-size: 17px; font-weight: 800; margin-bottom: 4px; color: var(--dark-900, #1a1a2e); }
    .fb-subtitle { font-size: 12px; color: var(--dark-700, #6b7280); margin-bottom: 20px; }
    html.dark .fb-title { color: #f1f5f9; }
    html.dark .fb-subtitle { color: #94a3b8; }

    .fb-stars {
      display: flex; gap: 4px; justify-content: center; margin-bottom: 16px;
    }
    .fb-star {
      font-size: 32px; cursor: pointer; transition: transform 0.15s ease;
      color: #d1d5db; filter: grayscale(1);
    }
    .fb-star.active { color: #f59e0b; filter: none; }
    .fb-star:hover { transform: scale(1.2); }

    .fb-input {
      width: 100%; padding: 12px 14px; border-radius: 12px;
      border: 1.5px solid var(--gray-200, #e5e7eb);
      font-size: 14px; font-family: var(--font-zh);
      background: var(--gray-50, #f9fafb);
      color: var(--dark-900, #1a1a2e);
      transition: border-color 0.2s; resize: none;
      margin-bottom: 12px; box-sizing: border-box;
    }
    .fb-input:focus { outline: none; border-color: #6366f1; }
    html.dark .fb-input { background: #334155; border-color: #475569; color: #f1f5f9; }
    html.dark .fb-input:focus { border-color: #818cf8; }

    .fb-submit {
      width: 100%; padding: 14px; border-radius: 14px;
      background: linear-gradient(135deg, #6366f1, #4f46e5);
      color: #fff; font-size: 15px; font-weight: 800;
      border: none; cursor: pointer;
      transition: all 0.2s; letter-spacing: 0.5px;
    }
    .fb-submit:hover { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(99,102,241,0.4); }
    .fb-submit:disabled { opacity: 0.5; cursor: not-allowed; }

    .fb-result {
      margin-top: 12px; font-size: 13px; text-align: center;
      padding: 8px; border-radius: 10px; display: none;
    }
    .fb-result.success { display: block; background: rgba(5,150,105,0.1); color: #059669; }
    .fb-result.error { display: block; background: rgba(239,68,68,0.1); color: #ef4444; }

    @media(min-width:768px){
      .bottom-nav ~ .fb-toggle { bottom: 84px; }
    }
  `;
  document.head.appendChild(css);

  // Add HTML
  var div = document.createElement('div');
  div.innerHTML = `
    <button class="fb-toggle" id="fbToggle" aria-label="意見回饋">
      <span>💬</span>
      <span class="fb-label">意見</span>
    </button>
    <div class="fb-overlay" id="fbOverlay"></div>
    <div class="fb-modal" id="fbModal">
      <div class="fb-handle"></div>
      <div class="fb-title" style="text-align:center">💬 話俾我哋知</div>
      <div class="fb-subtitle" style="text-align:center">你嘅意見幫我哋做得更好</div>
      <form id="fbForm" onsubmit="return false">
        <div class="fb-stars" id="fbStars">
          <span class="fb-star" data-v="1">⭐</span>
          <span class="fb-star" data-v="2">⭐</span>
          <span class="fb-star" data-v="3">⭐</span>
          <span class="fb-star" data-v="4">⭐</span>
          <span class="fb-star" data-v="5">⭐</span>
        </div>
        <textarea class="fb-input" id="fbComment" rows="3" placeholder="你覺得呢個網站點樣？有咩可以改善？" required></textarea>
        <input class="fb-input" id="fbName" placeholder="你嘅名稱 (選填)" style="margin-bottom:8px">
        <input class="fb-input" id="fbEmail" type="email" placeholder="電郵 (選填，用嚟回覆你)" style="margin-bottom:16px">
        <button class="fb-submit" id="fbSubmit">📤 提交意見</button>
        <div class="fb-result" id="fbResult"></div>
      </form>
    </div>
  `;
  document.body.appendChild(div);

  // Logic
  var toggle = document.getElementById('fbToggle');
  var overlay = document.getElementById('fbOverlay');
  var modal = document.getElementById('fbModal');
  var stars = document.querySelectorAll('.fb-star');
  var rating = 0;

  function openFB() { overlay.classList.add('open'); modal.classList.add('open'); }
  function closeFB() { overlay.classList.remove('open'); modal.classList.remove('open'); }

  toggle.onclick = openFB;
  overlay.onclick = closeFB;

  stars.forEach(function(s){
    s.onclick = function(){
      rating = parseInt(s.dataset.v);
      stars.forEach(function(x,i){ x.classList.toggle('active', i < rating); });
    };
  });

  document.getElementById('fbSubmit').onclick = function(ev){
    ev.preventDefault();
    var comment = document.getElementById('fbComment').value.trim();
    var result = document.getElementById('fbResult');
    var btn = document.getElementById('fbSubmit');
    if (!comment) {
      result.className = 'fb-result error';
      result.textContent = '❌ 請輸入你嘅意見';
      return;
    }
    btn.disabled = true;
    btn.textContent = '⏳ 提交中...';
    result.className = 'fb-result';
    result.textContent = '';

    var apiBase = window.API_BASE || '';
    fetch(apiBase + '/api/marketing/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('fbName').value.trim(),
        email: document.getElementById('fbEmail').value.trim(),
        rating: rating,
        comment: comment,
        page: window.location.pathname
      })
    }).then(function(r){ return r.json(); })
    .then(function(data){
      if (data.success) {
        result.className = 'fb-result success';
        result.textContent = '✅ ' + data.message;
        document.getElementById('fbForm').innerHTML = '<div style="text-align:center;padding:20px"><div style="font-size:40px;margin-bottom:12px">🙏</div><div style="font-size:16px;font-weight:700;color:var(--dark-900)">多謝你嘅意見！</div><div style="font-size:13px;color:var(--dark-700);margin-top:6px">我哋會繼續改進 💪</div></div>';
        setTimeout(closeFB, 2500);
      } else {
        result.className = 'fb-result error';
        result.textContent = '❌ ' + (data.error || '提交失敗');
        btn.disabled = false;
        btn.textContent = '📤 提交意見';
      }
    })
    .catch(function(){
      result.className = 'fb-result error';
      result.textContent = '❌ 網絡錯誤，請稍後再試';
      btn.disabled = false;
      btn.textContent = '📤 提交意見';
    });
  };
})();
