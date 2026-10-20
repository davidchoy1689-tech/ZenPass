/* ZenPass — 課程封面三層優先：
 *   1. 課堂自己相片 (image_url)
 *   2. 類別相片封面 (assets/img/covers-photo/)
 *   3. 類別品牌封面 (assets/img/covers/)
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

  // 已備有相片封面嘅類別（冇嘅話自動退回品牌封面）
  var PHOTO = {
    stretch: 1, yoga: 1, fitness: 1, meditation: 1, dance: 1,
    "kids-fitness": 1, "senior-fitness": 1, trx: 1,
    "table-tennis": 1, bowling: 1, fencing: 1,
  };

  var PHOTO_V = "1";
  var ART_V = "2";

  function slugOf(category, sportSlug) {
    return MAP[String(category || "").trim()] || (sportSlug && MAP[sportSlug]) || "default";
  }

  window.coverFor = function (category, sportSlug) {
    return "assets/img/covers/" + slugOf(category, sportSlug) + ".jpg?v=" + ART_V;
  };

  window.photoFor = function (category, sportSlug) {
    var s = slugOf(category, sportSlug);
    return PHOTO[s] ? "assets/img/covers-photo/" + s + ".jpg?v=" + PHOTO_V : "";
  };

  /** 統一取圖：自己相片 → 類別相片 → 品牌封面 */
  window.cardImage = function (c) {
    c = c || {};
    var own = String(c.image_url || "").trim();
    if (own) return { url: own, kind: "own" };
    var p = window.photoFor(c.category, c.sport_slug);
    if (p) return { url: p, kind: "photo" };
    return { url: window.coverFor(c.category, c.sport_slug), kind: "art" };
  };
})();
