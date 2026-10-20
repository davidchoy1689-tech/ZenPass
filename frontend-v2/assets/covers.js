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

  var GENERIC = "assets/img/covers/generic.jpg?v=3";

  window.genericCover = function () { return GENERIC; };

  /**
   * 全站只用兩層：
   *   1. 課堂有自己相片（教練上載）→ 用該相片
   *   2. 否則 → 通用品牌圖 generic.jpg
   * surface 參數保留但唔再用於分流。
   */
  window.cardImage = function (c) {
    c = c || {};
    var own = String(c.image_url || "").trim();
    var isBrandArt = own.indexOf("assets/img/classes/") === 0 || own.indexOf("assets/img/covers/") === 0;
    if (own && !isBrandArt) return { url: own, kind: "own" };
    return { url: GENERIC, kind: "generic" };
  };

  // 兼容舊呼叫（詳情頁 fallback）
  window.coverFor = function () { return GENERIC; };
})();
