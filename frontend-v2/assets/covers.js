/* ZenPass — 類別預設封面（Wikimedia Commons PD/CC0，manifest 見 assets/img/covers/manifest.json） */
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

  window.coverFor = function (category, sportSlug) {
    var slug = MAP[String(category || "").trim()] || (sportSlug && MAP[sportSlug]) || "default";
    return "assets/img/covers/" + slug + ".jpg";
  };
})();
