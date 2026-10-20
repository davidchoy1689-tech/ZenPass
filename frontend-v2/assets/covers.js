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

  // 通用品牌圖（David 2026-10-21：唔用個別課程內容，全部用同一張）
  window.coverFor = function () {
    return "assets/img/covers/generic.jpg?v=1";
  };

  /** 統一取圖：課堂自己相片 → 品牌類別封面 */
  window.cardImage = function (c) {
    c = c || {};
    var own = String(c.image_url || "").trim();
    if (own) return { url: own, kind: "own" };
    return { url: window.coverFor(c.category, c.sport_slug), kind: "art" };
  };
})();
