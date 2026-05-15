// ZenPass Index JS — extracted from index.html

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
            : cat.category === "長者體適能"
            ? "👴"
            : cat.category === "產後修復"
            ? "🤰"
            : cat.category === "空中瑜伽"
            ? "🧘‍♀️"
            : cat.category === "芭蕾塑形"
            ? "💃"
            : cat.category === "TRX 懸吊訓練"
            ? "🏋️"
            : cat.category === "詠春"
            ? "🥋"
            : cat.category === "遠足行山"
            ? "🥾"
            : cat.category === "溜冰"
            ? "⛸️"
            : cat.category === "網球"
            ? "🎾"
            : cat.category === "保齡球"
            ? "🎳"
          : "🏃"
;
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
      '<div class="category-chip" onclick="filterByCategory(\'保齡球\', this)">🎳 保齡球</div>'
      "";
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
  container.innerHTML = '<div class="loading-spinner">載入中...</div>';
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
    container.innerHTML = items
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
    cls.is_hot || cls.popular ? '<span class="badge-hot">🔥 熱門</span>' : "";
  var schedule =
    cls.schedules && cls.schedules[0]
      ? '<div class="class-card-meta">📅 ' +
        formatDate(cls.schedules[0].start_time) +
        " " +
        formatTime(cls.schedules[0].start_time) +
        "</div>"
      : "";

  return (
    '<div class="class-card" onclick="location.href=\'class-detail.html?id=' +
    cls.id +
    "'\">" +
    '<div class="class-card-img" style="' +
    imgStyle +
    '">' +
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
      ? '<div class="class-card-spots">剩餘 ' + spots + " 位</div>"
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
