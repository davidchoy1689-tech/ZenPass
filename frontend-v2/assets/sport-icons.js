/* ZenPass 項目圖案：分類 → 本地 SVG（self-hosted）
   由 category-images.js 抽出，保持同一份映射。
   自動為 .chip[data-cat] / .modern-card-tag / .class-card-category 加上對應圖案。 */
var SPORT_ICONS = [
  ["熱瑜伽", "hot-yoga"], ["高溫瑜伽", "hot-yoga"], ["高温瑜伽", "hot-yoga"], ["hot yoga", "hot-yoga"],
  ["孕婦瑜伽", "prenatal-yoga"], ["產前瑜伽", "prenatal-yoga"], ["產後", "prenatal-yoga"], ["prenatal", "prenatal-yoga"],
  ["健身舞", "aerobics"], ["健美操", "aerobics"], ["有氧操", "aerobics"], ["帶氧", "aerobics"], ["跳操", "aerobics"],
  ["踏板", "step-aerobics"], ["階梯", "step-aerobics"], ["step aerobics", "step-aerobics"],
  ["飛輪", "spinning"], ["動感單車", "spinning"], ["室內單車", "spinning"], ["spinning", "spinning"],
  ["核心", "core-training"], ["腹肌", "core-training"], ["核心訓練", "core-training"],
  ["風箏衝浪", "kitesurfing"], ["風箏滑水", "kitesurfing"], ["kitesurf", "kitesurfing"],
  ["中國舞", "chinese-dance"], ["爵士舞", "jazz-dance"], ["肚皮舞", "belly-dance"], ["現代舞", "contemporary-dance"],
  ["k-pop", "kpop-dance"], ["kpop", "kpop-dance"],
  ["舞獅", "lion-dance"], ["舞龍", "lion-dance"], ["lion dance", "lion-dance"],
  ["扯鈴", "diabolo"], ["diabolo", "diabolo"],
  ["街頭健身", "calisthenics"], ["街健", "calisthenics"], ["calisthenics", "calisthenics"],
  ["水球", "water-polo"], ["water polo", "water-polo"],
  ["韻律泳", "synchronized-swimming"], ["花樣游泳", "synchronized-swimming"], ["synchronized", "synchronized-swimming"],
  ["冰球", "ice-hockey"], ["ice hockey", "ice-hockey"],
  ["曲棍球", "hockey"], ["hockey", "hockey"],
  ["兒童體操", "kids-gymnastics"], ["kids gymnastics", "kids-gymnastics"],
  ["電子競技", "esports"], ["電競", "esports"], ["esports", "esports"], ["e-sports", "esports"],
  ["花式跳繩", "freestyle-skipping"], ["花式跳绳", "freestyle-skipping"], ["freestyle skip", "freestyle-skipping"],
  ["劍道", "kendo"], ["kendo", "kendo"],
  ["空手道", "karate"], ["karate", "karate"],
  ["踢拳", "kickboxing"], ["自由搏擊", "kickboxing"], ["kickbox", "kickboxing"], ["kickboxing", "kickboxing"],
  ["自衛術", "self-defence"], ["自衛", "self-defence"], ["防身", "self-defence"], ["self defence", "self-defence"], ["self-defense", "self-defence"],
  ["巧固球", "tchoukball"], ["tchoukball", "tchoukball"],
  ["健球", "kin-ball"], ["kin-ball", "kin-ball"], ["kin ball", "kin-ball"],
  ["木球", "woodball"], ["woodball", "woodball"],
  ["曳步舞", "shuffle-dance"], ["鬼步舞", "shuffle-dance"], ["shuffle", "shuffle-dance"],
  ["體重管理", "weight-management"], ["減肥", "weight-management"], ["纖體", "weight-management"], ["瘦身", "weight-management"],
  ["復康", "rehab"], ["物理治療", "rehab"], ["復健", "rehab"], ["rehab", "rehab"],
  ["筋膜", "foam-rolling"], ["泡沫軸", "foam-rolling"], ["按摩球", "foam-rolling"], ["foam roll", "foam-rolling"],
  ["頌缽", "sound-bath"], ["聲療", "sound-bath"], ["sound bath", "sound-bath"],
  ["森林浴", "forest-bathing"], ["森林", "forest-bathing"], ["forest bath", "forest-bathing"],
  ["門球", "gateball"], ["gateball", "gateball"],
  ["草地滾球", "lawn-bowls"], ["草地滚球", "lawn-bowls"], ["lawn bowl", "lawn-bowls"],
  ["法式滾球", "petanque"], ["法式球", "petanque"], ["法式滚球", "petanque"], ["petanque", "petanque"], ["boule", "petanque"],
  ["板式網球", "padel"], ["板式网球", "padel"], ["padel", "padel"],
  ["地板冰壺", "floor-curling"], ["地板冰壶", "floor-curling"], ["冰壺", "curling"], ["冰壶", "curling"], ["curling", "curling"],
  ["滑雪", "skiing"], ["snowboard", "skiing"], ["ski", "skiing"],
  ["馬術", "equestrian"], ["马术", "equestrian"], ["equestrian", "equestrian"], ["騎馬", "equestrian"],
  ["越野跑", "trail-running"], ["越野赛", "trail-running"], ["trail run", "trail-running"],
  ["山地單車", "mtb"], ["山地单车", "mtb"], ["登山車", "mtb"], ["mountain bike", "mtb"], ["mtb", "mtb"],
  ["抱石", "bouldering"], ["boulder", "bouldering"],
  ["飛索", "zipline"], ["高空繩網", "zipline"], ["歷奇", "zipline"], ["繩網", "zipline"], ["zipline", "zipline"],
  ["障礙賽", "obstacle-race"], ["障碍", "obstacle-race"], ["obstacle", "obstacle-race"], ["spartan", "obstacle-race"],
  ["拔河", "tug-of-war"], ["tug of war", "tug-of-war"],
  ["藝術體操", "rhythmic-gymnastics"], ["艺术体操", "rhythmic-gymnastics"], ["韻律體操", "rhythmic-gymnastics"], ["rhythmic", "rhythmic-gymnastics"],
  ["新興運動", "roundnet"], ["trx", "gym"], ["懸吊", "gym"], ["肌力", "weightlifting"], ["水中", "aqua-aerobics"],
  ["芬蘭木柱", "moelkkyla"], ["木柱", "moelkkyla"], ["molkky", "moelkkyla"], ["mölkky", "moelkkyla"],
  ["地板冰壺", "floor-curling"], ["地板冰壶", "floor-curling"],
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
  ["芭蕾", "ballet"], ["舞蹈", "dance"], ["dance", "dance"],
  ["皮拉提斯", "pilates"], ["pilates", "pilates"],
  ["太極", "tai-chi"], ["tai chi", "tai-chi"], ["太极", "tai-chi"],
  ["攀岩", "climbing"], ["climb", "climbing"],
  ["遠足", "hiking"], ["行山", "hiking"], ["hiking", "hiking"],
  ["長者", "senior"], ["樂齡", "senior"], ["銀髮", "senior"], ["senior", "senior"],
  ["游泳", "swimming"], ["游水", "swimming"], ["swim", "swimming"],
  ["單車", "cycling"], ["摺車", "cycling"], ["cycling", "cycling"], ["bike", "cycling"],
  ["桌球", "billiards"], ["撞球", "billiards"], ["billiard", "billiards"],
  ["露營", "camping"], ["camping", "camping"],
  ["乒乓球", "table-tennis"], ["乒乓", "table-tennis"], ["table tennis", "table-tennis"],
  ["羽毛球", "badminton"], ["羽球", "badminton"], ["badminton", "badminton"],
  ["籃球", "basketball"], ["篮球", "basketball"], ["basketball", "basketball"],
  ["足球", "football"], ["足球", "football"], ["football", "football"], ["soccer", "football"],
  ["沙灘排球", "beach-volleyball"], ["沙滩排球", "beach-volleyball"], ["beach volleyball", "beach-volleyball"],
  ["排球", "volleyball"], ["volleyball", "volleyball"],
  ["網球", "tennis"], ["网球", "tennis"], ["tennis", "tennis"],
  ["武術", "martial-arts"], ["功夫", "martial-arts"], ["詠春", "martial-arts"], ["泰拳", "martial-arts"], ["martial", "martial-arts"], ["kung fu", "martial-arts"],
  ["跳繩", "skipping"], ["跳绳", "skipping"], ["jump rope", "skipping"],
  ["跑步", "running"], ["馬拉松", "running"], ["田徑", "running"], ["running", "running"],
  ["保齡", "bowling"], ["bowling", "bowling"],
  ["高爾夫", "golf"], ["golf", "golf"],
  ["射箭", "archery"], ["archery", "archery"],
  ["壁球", "squash"], ["squash", "squash"],
  ["龍舟", "dragon-boat"], ["龙舟", "dragon-boat"], ["dragon boat", "dragon-boat"],
  ["獨木舟", "kayaking"], ["独木舟", "kayaking"], ["皮划艇", "kayaking"], ["kayak", "kayaking"], ["canoe", "kayaking"],
  ["滑浪風帆", "windsurfing"], ["風帆", "windsurfing"], ["帆板", "windsurfing"], ["帆船", "windsurfing"], ["windsurf", "windsurfing"],
  ["潛水", "diving"], ["潜水", "diving"], ["浮潛", "diving"], ["水肺", "diving"], ["diving", "diving"], ["snorkel", "diving"],
  ["劍擊", "fencing"], ["击剑", "fencing"], ["fencing", "fencing"],
  ["跆拳道", "taekwondo"], ["taekwondo", "taekwondo"],
  ["柔道", "judo"], ["柔術", "judo"], ["judo", "judo"], ["bjj", "judo"],
  ["體操", "gymnastics"], ["体操", "gymnastics"], ["gymnastics", "gymnastics"],
  ["滑板", "skateboarding"], ["skateboard", "skateboarding"],
  ["滾軸溜冰", "inline-skating"], ["溜冰", "inline-skating"], ["直排輪", "inline-skating"], ["滑輪", "inline-skating"], ["roller", "inline-skating"], ["skate", "inline-skating"],
  ["匹克球", "pickleball"], ["pickleball", "pickleball"],
  ["飛盤", "frisbee"], ["飛碟", "frisbee"], ["frisbee", "frisbee"], ["ultimate", "frisbee"],
  ["飛鏢", "darts"], ["飛標", "darts"], ["dart", "darts"],
  ["手球", "handball"], ["handball", "handball"],
  ["啦啦隊", "cheerleading"], ["啦啦", "cheerleading"], ["cheer", "cheerleading"],
  ["舉重", "weightlifting"], ["健力", "weightlifting"], ["槓鈴", "weightlifting"], ["weightlift", "weightlifting"], ["powerlift", "weightlifting"],
  ["彈床", "trampoline"], ["蹦床", "trampoline"], ["trampoline", "trampoline"],
  ["跑酷", "parkour"], ["飛躍道", "parkour"], ["parkour", "parkour"],
  ["定向", "orienteering"], ["定向越野", "orienteering"], ["orienteering", "orienteering"],
  ["三項鐵人", "triathlon"], ["鐵人", "triathlon"], ["triathlon", "triathlon"],
  ["霹靂舞", "breakdance"], ["街舞", "breakdance"], ["breaking", "breakdance"], ["breakdance", "breakdance"], ["hip hop", "breakdance"],
  ["排舞", "ballroom"], ["社交舞", "ballroom"], ["標準舞", "ballroom"], ["拉丁舞", "ballroom"], ["ballroom", "ballroom"],
  ["衝浪", "surfing"], ["滑浪", "surfing"], ["surfing", "surfing"], ["surf", "surfing"],
  ["划艇", "rowing"], ["賽艇", "rowing"], ["rowing", "rowing"], ["划船", "rowing"],
  ["釣魚", "fishing"], ["釣魚", "fishing"], ["fishing", "fishing"],
  ["呼拉圈", "hula-hoop"], ["呼啦圈", "hula-hoop"], ["hula", "hula-hoop"],
  ["氣功", "qigong"], ["八段錦", "qigong"], ["易筋", "qigong"], ["qigong", "qigong"], ["chi kung", "qigong"],
  ["摔跤", "wrestling"], ["角力", "wrestling"], ["wrestling", "wrestling"],
  ["欖球", "rugby"], ["橄榄球", "rugby"], ["rugby", "rugby"],
  ["板球", "cricket"], ["cricket", "cricket"],
  ["棒球", "baseball"], ["壘球", "baseball"], ["baseball", "baseball"], ["softball", "baseball"],
  ["閃避球", "dodgeball"], ["躲避", "dodgeball"], ["dodgeball", "dodgeball"],
  ["水中有氧", "aqua-aerobics"], ["水中健體", "aqua-aerobics"], ["水療", "aqua-aerobics"], ["aqua", "aqua-aerobics"],
  ["kite", "kitesurfing"]
];

function getCategoryIcon(cat) {
  if (!cat) return "";
  var s = String(cat).toLowerCase();
  for (var i = 0; i < SPORT_ICONS.length; i++) {
    if (s.indexOf(SPORT_ICONS[i][0].toLowerCase()) >= 0) return "assets/icons/sports/" + SPORT_ICONS[i][1] + ".svg";
  }
  return "";
}

function sportIconImg(cat, size) {
  var src = getCategoryIcon(cat);
  if (!src) return "";
  var n = size || 14;
  return '<img src="' + src + '" alt="" width="' + n + '" height="' + n + '" style="width:' + n + 'px;height:' + n + 'px;vertical-align:-2px;margin-right:3px" loading="lazy">';
}

(function () {
  var SELECTOR = ".chip[data-cat], .modern-card-tag, .class-card-category";
  function decorate(root) {
    if (!root || !root.querySelectorAll) return;
    var nodes = root.querySelectorAll(SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute("data-iconized") || el.querySelector("img")) continue;
      var img = sportIconImg((el.textContent || "").trim(), 14);
      if (img) { el.insertAdjacentHTML("afterbegin", img); el.setAttribute("data-iconized", "1"); }
    }
  }
  function run() {
    decorate(document);
    if (window.MutationObserver && document.body) {
      new MutationObserver(function () { decorate(document); }).observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
