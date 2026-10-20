/* ZenPass — 課程封面三層優先：
 *   1. 課堂自己相片 (image_url)
 *   2. 通用品牌封面 (assets/img/covers/generic.jpg)
 * 相片來源／授權見 credits.html（Wikimedia Commons，CC BY/CC0/PD）
 */
(function () {
  var MAP = {
    "新興運動": "emerging-sports",
    "伸展": "stretch",
    "瑜伽": "yoga",
    "健身": "fitness",
    "冥想": "meditation",
    "舞蹈": "dance",
    "兒童體適能": "kids-fitness",
    "長者體適能": "senior-fitness",
    "TRX 懸吊訓練": "trx",
    "乒乓球": "table-tennis",
    "保齡球": "bowling",
    "劍擊": "fencing",
  };

  var ART_V = "2";

  function slugOf(category, sportSlug) {
    return MAP[String(category || "").trim()] || (sportSlug && MAP[sportSlug]) || "default";
  }

  // 首頁／列表：類別品牌封面（通用，不含個別課程內容）
  window.coverFor = function (category, sportSlug) {
    return "assets/img/covers/" + slugOf(category, sportSlug) + ".jpg?v=" + ART_V;
  };

  /** 首頁／列表用嘅通用品牌圖（不含個別課程內容） */
  var GENERIC = "assets/img/covers/generic.jpg?v=2";

  window.genericCover = function () { return GENERIC; };

  /**
   * 統一取圖：
   *   surface = "list"（首頁／探索）：教練真實相片 → 通用品牌圖
   *   surface = "detail"（課程詳情）：教練相片或每班專屬品牌圖 → 類別品牌封面
   */
  window.cardImage = function (c, surface) {
    c = c || {};
    var own = String(c.image_url || "").trim();
    var isClassArt = own.indexOf("assets/img/classes/") === 0;
    if (surface === "list") {
      if (own && !isClassArt) return { url: own, kind: "own" };
      return { url: GENERIC, kind: "generic" };
    }
    if (own) return { url: own, kind: "own" };
    return { url: window.coverFor(c.category, c.sport_slug), kind: "art" };
  };
})();
