// Category → Pexels image mapping
var CATEGORY_IMAGES = {
  "伸展": "https://images.pexels.com/photos/4056535/pexels-photo-4056535.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "瑜伽": "https://images.pexels.com/photos/4056535/pexels-photo-4056535.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "冥想": "https://images.pexels.com/photos/3822622/pexels-photo-3822622.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "健身": "https://images.pexels.com/photos/1552242/pexels-photo-1552242.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "HIIT": "https://images.pexels.com/photos/3755342/pexels-photo-3755342.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "拳擊": "https://images.pexels.com/photos/3755342/pexels-photo-3755342.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "舞蹈": "https://images.pexels.com/photos/4662321/pexels-photo-4662321.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "皮拉提斯": "https://images.pexels.com/photos/4056535/pexels-photo-4056535.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "產後": "https://images.pexels.com/photos/4662321/pexels-photo-4662321.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "遠足": "https://images.pexels.com/photos/917510/pexels-photo-917510.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "長者": "https://images.pexels.com/photos/3822622/pexels-photo-3822622.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "空中瑜伽": "https://images.pexels.com/photos/4662321/pexels-photo-4662321.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "太極": "https://images.pexels.com/photos/3822622/pexels-photo-3822622.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "心肺": "https://images.pexels.com/photos/1552242/pexels-photo-1552242.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "攀岩": "https://images.pexels.com/photos/373912/pexels-photo-373912.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "芭蕾": "https://images.pexels.com/photos/4662321/pexels-photo-4662321.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "露營": "https://images.pexels.com/photos/917510/pexels-photo-917510.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
  "兒童健體": "https://images.pexels.com/photos/8613089/pexels-photo-8613089.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop"
};

function getCategoryImage(cat) {
  if (!cat) return "";
  for (var k in CATEGORY_IMAGES) {
    if (cat.indexOf(k) >= 0) return CATEGORY_IMAGES[k];
  }
  return "";
}

// Category → local SVG icon mapping (self-hosted flat icon set, no external requests)
var SPORT_ICONS = [
  ["芬蘭木柱", "moelkkyla"], ["木柱", "moelkkyla"], ["molkky", "moelkkyla"], ["mölkky", "moelkkyla"],
  ["地板冰壺", "floor-curling"], ["冰壺", "floor-curling"], ["curling", "floor-curling"],
  ["布袋球", "cornhole"], ["cornhole", "cornhole"],
  ["穿雲箭", "air-storm"], ["air storm", "air-storm"],
  ["北歐", "nordic-walking"], ["nordic", "nordic-walking"],
  ["圓網球", "roundnet"], ["roundnet", "roundnet"],
  ["柔力球", "rouliqiu"], ["rouliqiu", "rouliqiu"],
  ["flexi", "flexi-bar"],
  ["身心伸展", "stretching"], ["伸展", "stretching"], ["stretch", "stretching"],
  ["兒童健體", "kids-fitness"], ["兒童", "kids-fitness"], ["kids", "kids-fitness"],
  ["空中瑜伽", "aerial-yoga"], ["aerial", "aerial-yoga"],
  ["瑜伽", "yoga"], ["yoga", "yoga"],
  ["冥想", "meditation"], ["靜觀", "meditation"], ["meditation", "meditation"],
  ["健身", "gym"], ["gym", "gym"],
  ["hiit", "hiit"], ["間歇", "hiit"], ["心肺", "hiit"],
  ["拳擊", "boxing"], ["boxing", "boxing"],
  ["芭蕾", "dance"], ["舞蹈", "dance"], ["dance", "dance"],
  ["皮拉提斯", "pilates"], ["pilates", "pilates"],
  ["太極", "tai-chi"], ["tai chi", "tai-chi"], ["太极", "tai-chi"],
  ["攀岩", "climbing"], ["抱石", "climbing"], ["climb", "climbing"],
  ["遠足", "hiking"], ["行山", "hiking"], ["hiking", "hiking"],
  ["露營", "camping"], ["camping", "camping"]
];

function getCategoryIcon(cat) {
  if (!cat) return "";
  var s = String(cat).toLowerCase();
  for (var i = 0; i < SPORT_ICONS.length; i++) {
    if (s.indexOf(SPORT_ICONS[i][0].toLowerCase()) >= 0) return "assets/icons/sports/" + SPORT_ICONS[i][1] + ".svg";
  }
  return "";
}

function categoryIconImg(cat, size) {
  var src = getCategoryIcon(cat);
  if (!src) return "";
  var n = size || 13;
  return '<img src="' + src + '" alt="" width="' + n + '" height="' + n + '" style="width:' + n + 'px;height:' + n + 'px;vertical-align:-2px;margin-right:3px" loading="lazy">';
}

// Auto-decorate category labels with local icons on any page that loads this file.
(function () {
  var SELECTOR = ".modern-card-tag, .class-card-category, .chip[data-cat]";
  function decorate(root) {
    if (!root || !root.querySelectorAll) return;
    var nodes = root.querySelectorAll(SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute("data-iconized") || el.querySelector("img")) continue;
      var img = categoryIconImg((el.textContent || "").trim(), 13);
      if (img) { el.insertAdjacentHTML("afterbegin", img); el.setAttribute("data-iconized", "1"); }
    }
  }
  function run() {
    decorate(document);
    if (window.MutationObserver && document.body) {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) { if (added[j].nodeType === 1) decorate(added[j]); }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
