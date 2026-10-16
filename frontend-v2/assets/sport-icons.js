/* ZenPass 項目圖案（A+B 樣式）
 * A = 彩色漸變方塊 + 白色圖案（運動項目卡片牆）
 * B = 柔和底 + 同色線稿（chips / 課程卡）
 * 資料來源：manifest.json + colors.json（單一來源）
 */
var SPORTS_CATALOGUE = [{"slug":"martial-arts","name":"武術","group":"武術・格鬥"},{"slug":"tai-chi","name":"太極","group":"武術・格鬥"},{"slug":"tai-chi-sword","name":"太極劍","group":"武術・格鬥"},{"slug":"boxing","name":"拳擊","group":"武術・格鬥"},{"slug":"kickboxing","name":"踢拳","group":"武術・格鬥"},{"slug":"karate","name":"空手道","group":"武術・格鬥"},{"slug":"taekwondo","name":"跆拳道","group":"武術・格鬥"},{"slug":"judo","name":"柔道","group":"武術・格鬥"},{"slug":"kendo","name":"劍道","group":"武術・格鬥"},{"slug":"fencing","name":"劍擊","group":"武術・格鬥"},{"slug":"wrestling","name":"摔跤","group":"武術・格鬥"},{"slug":"self-defence","name":"自衛術","group":"武術・格鬥"},{"slug":"tennis","name":"網球","group":"球拍運動"},{"slug":"table-tennis","name":"乒乓球","group":"球拍運動"},{"slug":"badminton","name":"羽毛球","group":"球拍運動"},{"slug":"squash","name":"壁球","group":"球拍運動"},{"slug":"racquetball","name":"短柄牆球","group":"球拍運動"},{"slug":"pickleball","name":"匹克球","group":"球拍運動"},{"slug":"padel","name":"板式網球","group":"球拍運動"},{"slug":"roundnet","name":"圓網球","group":"球拍運動"},{"slug":"rouliqiu","name":"柔力球","group":"球拍運動"},{"slug":"basketball","name":"籃球","group":"球類運動"},{"slug":"football","name":"足球","group":"球類運動"},{"slug":"volleyball","name":"排球","group":"球類運動"},{"slug":"beach-volleyball","name":"沙灘排球","group":"球類運動"},{"slug":"handball","name":"手球","group":"球類運動"},{"slug":"water-polo","name":"水球","group":"球類運動"},{"slug":"hockey","name":"曲棍球","group":"球類運動"},{"slug":"ice-hockey","name":"冰球","group":"球類運動"},{"slug":"floorball","name":"地板球","group":"球類運動"},{"slug":"lacrosse","name":"長曲棍球","group":"球類運動"},{"slug":"rugby","name":"欖球","group":"球類運動"},{"slug":"american-football","name":"美式足球","group":"球類運動"},{"slug":"cricket","name":"板球","group":"球類運動"},{"slug":"baseball","name":"棒球","group":"球類運動"},{"slug":"softball","name":"壘球","group":"球類運動"},{"slug":"netball","name":"籃網球","group":"球類運動"},{"slug":"korfball","name":"合球","group":"球類運動"},{"slug":"tchoukball","name":"巧固球","group":"球類運動"},{"slug":"sepak-takraw","name":"藤球","group":"球類運動"},{"slug":"kin-ball","name":"健球","group":"球類運動"},{"slug":"woodball","name":"木球","group":"球類運動"},{"slug":"shuttlecock","name":"踢毽","group":"球類運動"},{"slug":"dodgeball","name":"閃避球","group":"球類運動"},{"slug":"billiards","name":"桌球","group":"精準・目標"},{"slug":"bowling","name":"保齡球","group":"精準・目標"},{"slug":"golf","name":"高爾夫","group":"精準・目標"},{"slug":"mini-golf","name":"迷你高爾夫","group":"精準・目標"},{"slug":"disc-golf","name":"飛盤高爾夫","group":"精準・目標"},{"slug":"lawn-bowls","name":"草地滾球","group":"精準・目標"},{"slug":"petanque","name":"法式滾球","group":"精準・目標"},{"slug":"boccia","name":"硬地滾球","group":"精準・目標"},{"slug":"gateball","name":"門球","group":"精準・目標"},{"slug":"curling","name":"冰壺","group":"精準・目標"},{"slug":"darts","name":"飛鏢","group":"精準・目標"},{"slug":"archery","name":"射箭","group":"精準・目標"},{"slug":"shooting","name":"射擊","group":"精準・目標"},{"slug":"swimming","name":"游泳","group":"水上活動"},{"slug":"diving","name":"潛水","group":"水上活動"},{"slug":"aqua-aerobics","name":"水中有氧","group":"水上活動"},{"slug":"synchronized-swimming","name":"韻律泳","group":"水上活動"},{"slug":"rowing","name":"划艇","group":"水上活動"},{"slug":"kayaking","name":"獨木舟","group":"水上活動"},{"slug":"dragon-boat","name":"龍舟","group":"水上活動"},{"slug":"windsurfing","name":"滑浪風帆","group":"水上活動"},{"slug":"kitesurfing","name":"風箏衝浪","group":"水上活動"},{"slug":"surfing","name":"衝浪","group":"水上活動"},{"slug":"fishing","name":"釣魚","group":"水上活動"},{"slug":"gym","name":"健身","group":"健身・體能"},{"slug":"weightlifting","name":"舉重","group":"健身・體能"},{"slug":"core-training","name":"核心訓練","group":"健身・體能"},{"slug":"hiit","name":"HIIT","group":"健身・體能"},{"slug":"spinning","name":"飛輪","group":"健身・體能"},{"slug":"aerobics","name":"健身舞／有氧操","group":"健身・體能"},{"slug":"step-aerobics","name":"踏板操","group":"健身・體能"},{"slug":"calisthenics","name":"街頭健身","group":"健身・體能"},{"slug":"weight-management","name":"體重管理","group":"健身・體能"},{"slug":"rehab","name":"復康運動","group":"健身・體能"},{"slug":"foam-rolling","name":"筋膜放鬆","group":"健身・體能"},{"slug":"skipping","name":"跳繩","group":"健身・體能"},{"slug":"freestyle-skipping","name":"花式跳繩","group":"健身・體能"},{"slug":"yoga","name":"瑜伽","group":"瑜伽・普拉提"},{"slug":"hot-yoga","name":"熱瑜伽","group":"瑜伽・普拉提"},{"slug":"prenatal-yoga","name":"孕婦瑜伽","group":"瑜伽・普拉提"},{"slug":"aerial-yoga","name":"空中瑜伽","group":"瑜伽・普拉提"},{"slug":"meditation","name":"冥想","group":"瑜伽・普拉提"},{"slug":"qigong","name":"氣功／八段錦","group":"瑜伽・普拉提"},{"slug":"pilates","name":"皮拉提斯","group":"瑜伽・普拉提"},{"slug":"pilates-reformer","name":"器械普拉提","group":"瑜伽・普拉提"},{"slug":"barre","name":"芭蕾塑形","group":"瑜伽・普拉提"},{"slug":"stretching","name":"身心伸展","group":"瑜伽・普拉提"},{"slug":"sound-bath","name":"頌缽聲療","group":"瑜伽・普拉提"},{"slug":"forest-bathing","name":"森林浴","group":"瑜伽・普拉提"},{"slug":"flexi-bar","name":"Flexi-Bar","group":"瑜伽・普拉提"},{"slug":"dance","name":"舞蹈","group":"舞蹈"},{"slug":"ballet","name":"芭蕾","group":"舞蹈"},{"slug":"chinese-dance","name":"中國舞","group":"舞蹈"},{"slug":"jazz-dance","name":"爵士舞","group":"舞蹈"},{"slug":"contemporary-dance","name":"現代舞","group":"舞蹈"},{"slug":"belly-dance","name":"肚皮舞","group":"舞蹈"},{"slug":"kpop-dance","name":"K-pop 舞","group":"舞蹈"},{"slug":"breakdance","name":"霹靂舞","group":"舞蹈"},{"slug":"shuffle-dance","name":"曳步舞","group":"舞蹈"},{"slug":"ballroom","name":"排舞／社交舞","group":"舞蹈"},{"slug":"fan-dance","name":"扇舞","group":"舞蹈"},{"slug":"pole-dance","name":"鋼管舞","group":"舞蹈"},{"slug":"cheerleading","name":"啦啦隊","group":"舞蹈"},{"slug":"lion-dance","name":"舞獅","group":"舞蹈"},{"slug":"gymnastics","name":"體操","group":"體操・表演"},{"slug":"kids-gymnastics","name":"兒童體操","group":"體操・表演"},{"slug":"trampoline","name":"跳彈床","group":"體操・表演"},{"slug":"parkour","name":"跑酷","group":"體操・表演"},{"slug":"rhythmic-gymnastics","name":"藝術體操","group":"體操・表演"},{"slug":"aerial-hoop","name":"空中吊環","group":"體操・表演"},{"slug":"chinese-drum","name":"中國鼓","group":"體操・表演"},{"slug":"hiking","name":"遠足","group":"戶外・山野"},{"slug":"camping","name":"露營","group":"戶外・山野"},{"slug":"running","name":"跑步","group":"戶外・山野"},{"slug":"trail-running","name":"越野跑","group":"戶外・山野"},{"slug":"cycling","name":"單車","group":"戶外・山野"},{"slug":"skateboarding","name":"滑板","group":"戶外・山野"},{"slug":"inline-skating","name":"滾軸溜冰","group":"戶外・山野"},{"slug":"mtb","name":"山地單車","group":"戶外・山野"},{"slug":"climbing","name":"攀岩","group":"戶外・山野"},{"slug":"bouldering","name":"抱石","group":"戶外・山野"},{"slug":"orienteering","name":"定向越野","group":"戶外・山野"},{"slug":"triathlon","name":"三項鐵人","group":"戶外・山野"},{"slug":"obstacle-race","name":"障礙賽","group":"戶外・山野"},{"slug":"zipline","name":"飛索／歷奇","group":"戶外・山野"},{"slug":"tug-of-war","name":"拔河","group":"戶外・山野"},{"slug":"skiing","name":"滑雪","group":"戶外・山野"},{"slug":"equestrian","name":"馬術","group":"戶外・山野"},{"slug":"nordic-walking","name":"北歐式健步行","group":"戶外・山野"},{"slug":"moelkkyla","name":"芬蘭木柱","group":"新興運動"},{"slug":"floor-curling","name":"地板冰壺","group":"新興運動"},{"slug":"cornhole","name":"布袋球","group":"新興運動"},{"slug":"air-storm","name":"穿雲箭","group":"新興運動"},{"slug":"kids-fitness","name":"兒童健體","group":"兒童・長者"},{"slug":"senior","name":"長者樂齡","group":"兒童・長者"},{"slug":"diabolo","name":"扯鈴","group":"趣味・技巧"},{"slug":"kendama","name":"劍球","group":"趣味・技巧"},{"slug":"sport-stacking","name":"疊杯","group":"趣味・技巧"},{"slug":"hula-hoop","name":"呼拉圈","group":"趣味・技巧"},{"slug":"frisbee","name":"飛盤","group":"趣味・技巧"},{"slug":"esports","name":"電子競技","group":"趣味・技巧"}];
var SPORT_COLORS = {"moelkkyla":"#B62B2B","floor-curling":"#2BB653","cornhole":"#7C2BB6","air-storm":"#B6A42B","nordic-walking":"#2B9FB6","roundnet":"#B62B76","rouliqiu":"#4DB62B","flexi-bar":"#312BB6","stretching":"#B6592B","kids-fitness":"#2BB682","yoga":"#AA2BB6","meditation":"#99B62B","gym":"#2B70B6","hiit":"#B62B47","boxing":"#2BB636","dance":"#5F2BB6","pilates":"#B6882B","aerial-yoga":"#2BB6B0","tai-chi":"#B62B93","climbing":"#6AB62B","hiking":"#2B41B6","camping":"#B63C2B","ballet":"#2BB665","senior":"#8E2BB6","swimming":"#B5B62B","cycling":"#2B8DB6","billiards":"#B62B64","table-tennis":"#3CB62B","badminton":"#422BB6","basketball":"#B66B2B","football":"#2BB694","volleyball":"#B62BAF","tennis":"#87B62B","martial-arts":"#2B5EB6","skipping":"#B62B36","running":"#2BB648","bowling":"#712BB6","golf":"#B6992B","archery":"#2BA9B6","squash":"#B62B81","dragon-boat":"#58B62B","kayaking":"#2B30B6","windsurfing":"#B64E2B","diving":"#2BB677","fencing":"#9F2BB6","taekwondo":"#A4B62B","judo":"#2B7BB6","gymnastics":"#B62B52","skateboarding":"#2BB62C","inline-skating":"#542BB6","pickleball":"#B67D2B","frisbee":"#2BB6A5","darts":"#B62B9E","beach-volleyball":"#75B62B","handball":"#2B4CB6","cheerleading":"#B6312B","weightlifting":"#2BB65A","trampoline":"#832BB6","parkour":"#B6AB2B","orienteering":"#2B98B6","triathlon":"#B62B6F","breakdance":"#46B62B","ballroom":"#372BB6","surfing":"#B6602B","rowing":"#2BB689","fishing":"#B12BB6","hula-hoop":"#92B62B","hot-yoga":"#2B69B6","prenatal-yoga":"#B62B41","qigong":"#2BB63D","aerobics":"#662BB6","step-aerobics":"#B68F2B","spinning":"#2BB4B6","core-training":"#B62B8C","wrestling":"#63B62B","rugby":"#2B3BB6","cricket":"#B6432B","baseball":"#2BB66C","dodgeball":"#942BB6","aqua-aerobics":"#AFB62B","kitesurfing":"#2B86B6","chinese-dance":"#B62B5D","jazz-dance":"#35B62B","belly-dance":"#492BB6","contemporary-dance":"#B6722B","kpop-dance":"#2BB69A","lion-dance":"#B62BA9","diabolo":"#80B62B","calisthenics":"#2B57B6","water-polo":"#B62B2F","synchronized-swimming":"#2BB64F","ice-hockey":"#782BB6","hockey":"#B6A02B","kids-gymnastics":"#2BA3B6","esports":"#B62B7A","kendo":"#51B62B","karate":"#2C2BB6","kickboxing":"#B6552B","self-defence":"#2BB67E","tchoukball":"#A62BB6","kin-ball":"#9DB62B","woodball":"#2B74B6","freestyle-skipping":"#B62B4C","shuffle-dance":"#2BB632","weight-management":"#5B2BB6","rehab":"#B6842B","foam-rolling":"#2BB6AC","sound-bath":"#B62B97","forest-bathing":"#6EB62B","gateball":"#2B46B6","lawn-bowls":"#B6382B","petanque":"#2BB661","padel":"#892BB6","curling":"#B6B22B","skiing":"#2B91B6","equestrian":"#B62B68","trail-running":"#40B62B","mtb":"#3E2BB6","bouldering":"#B6672B","zipline":"#2BB68F","obstacle-race":"#B62BB4","tug-of-war":"#8BB62B","rhythmic-gymnastics":"#2B62B6","pole-dance":"#B62B3A","aerial-hoop":"#2BB644","pilates-reformer":"#6D2BB6","barre":"#B6952B","netball":"#2BAEB6","floorball":"#B62B85","sepak-takraw":"#5CB62B","korfball":"#2B34B6","american-football":"#B64A2B","shuttlecock":"#2BB673","tai-chi-sword":"#9B2BB6","fan-dance":"#A8B62B","chinese-drum":"#2B7FB6","shooting":"#B62B56","lacrosse":"#2EB62B","softball":"#502BB6","racquetball":"#B6792B","boccia":"#2BB6A1","kendama":"#B62BA2","sport-stacking":"#79B62B","disc-golf":"#2B51B6","mini-golf":"#B62D2B"};
var SPORT_ICONS = [
  ["長曲棍球", "lacrosse"], ["lacrosse", "lacrosse"],
  ["壘球", "softball"], ["softball", "softball"],
  ["飛盤高爾夫", "disc-golf"], ["disc golf", "disc-golf"],
  ["迷你高爾夫", "mini-golf"], ["mini golf", "mini-golf"],
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
  ["美式足球", "american-football"], ["american football", "american-football"], ["nfl", "american-football"],
  ["太極劍", "tai-chi-sword"], ["太极剑", "tai-chi-sword"], ["太極器械", "tai-chi-sword"], ["太極扇", "tai-chi-sword"],
  ["芭蕾塑形", "barre"], ["barre", "barre"],
  ["器械普拉提", "pilates-reformer"], ["reformer", "pilates-reformer"], ["普拉提", "pilates"],
  ["鋼管舞", "pole-dance"], ["鋼管", "pole-dance"], ["pole dance", "pole-dance"],
  ["空中吊環", "aerial-hoop"], ["空中呼拉圈", "aerial-hoop"], ["aerial hoop", "aerial-hoop"],
  ["籃網球", "netball"], ["netball", "netball"],
  ["地板球", "floorball"], ["floorball", "floorball"],
  ["藤球", "sepak-takraw"], ["sepak", "sepak-takraw"],
  ["合球", "korfball"], ["korfball", "korfball"],
  ["踢毽", "shuttlecock"], ["毽球", "shuttlecock"], ["shuttlecock", "shuttlecock"],
  ["扇舞", "fan-dance"], ["fan dance", "fan-dance"],
  ["中國鼓", "chinese-drum"], ["chinese drum", "chinese-drum"],
  ["射擊", "shooting"], ["氣槍", "shooting"], ["shooting", "shooting"],
  ["短柄牆球", "racquetball"], ["racquetball", "racquetball"],
  ["硬地滾球", "boccia"], ["boccia", "boccia"],
  ["劍球", "kendama"], ["kendama", "kendama"],
  ["疊杯", "sport-stacking"], ["sport stacking", "sport-stacking"],
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

function sportSlug(cat) {
  if (!cat) return ;
  var s = String(cat).toLowerCase();
  for (var i = 0; i < SPORT_ICONS.length; i++) {
    if (s.indexOf(SPORT_ICONS[i][0].toLowerCase()) >= 0) return SPORT_ICONS[i][1];
  }
  return ;
}
function getCategoryIcon(cat) { var g = sportSlug(cat); return g ? "assets/icons/sports/" + g + ".svg" : ""; }
function sportColor(cat) { var g = sportSlug(cat); return g ? (SPORT_COLORS[g] || "#ff6b35") : ""; }
function sportIconImg(cat, size) {
  var src = getCategoryIcon(cat); if (!src) return "";
  var n = size || 16;
  return '<img class="sport-ic" src="' + src + '" alt="" width="' + n + '" height="' + n + '" style="width:' + n + 'px;height:' + n + 'px" loading="lazy">';
}
function hexRGB(h){ h=(h||"#ff6b35").replace("#",""); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
function mixHex(h, t, p){ var a=hexRGB(h), b=hexRGB(t); return "rgb("+a.map(function(v,i){return Math.round(v*(1-p)+b[i]*p);}).join(",")+")"; }
function sportTint(cat, p){ var c=sportColor(cat); if(!c) return "#f2f2f7"; return mixHex(c, "#ffffff", 1-(p||0.14)); }
function tileBg(cat){ var c=sportColor(cat)||"#ff6b35"; return "linear-gradient(150deg,"+mixHex(c,"#ffffff",0.14)+","+mixHex(c,"#000000",0.20)+")"; }
function tileGlow(cat){ var c=sportColor(cat)||"#ff6b35"; return mixHex(c,"#ffffff",0.45); }

function renderSportGrid(elId, limit) {
  var g = document.getElementById(elId || "sportGrid");
  if (!g || !SPORTS_CATALOGUE) return;
  var list = limit ? SPORTS_CATALOGUE.slice(0, limit) : SPORTS_CATALOGUE;
  var groups = [], by = {};
  list.forEach(function (s) { var k = s.group || "運動"; if (!by[k]) { by[k] = []; groups.push(k); } by[k].push(s); });
  function tileHtml(s) {
    return '<a class="sport-card" href="explore.html?q=' + encodeURIComponent(s.name) + '">' +
      '<span class="sport-tile" style="background:' + tileBg(s.name) + ';--glow:' + tileGlow(s.name) + '"><img src="assets/icons/sports-white/' + s.slug + '.svg" alt="" loading="lazy"></span>' +
      '<span class="sport-name">' + s.name + '</span></a>';
  }
  var tabs = '<div class="sport-tabs"><button type="button" class="chip sport-tab" data-g="__all">全部 ' + list.length + '</button>' +
    groups.map(function (k) { return '<button type="button" class="chip sport-tab on" data-g="' + k + '">' + k + ' ' + by[k].length + '</button>'; }).join("") + '</div>';
  var sections = groups.map(function (k) {
    return '<section class="sport-group" data-g="' + k + '">' +
      '<div class="sport-group-title">' + k + ' <span class="n">' + by[k].length + '</span></div>' +
      '<div class="sport-grid">' + by[k].map(tileHtml).join("") + '</div></section>';
  }).join("");
  g.innerHTML = tabs + sections;
  var tabsEl = g.querySelector(".sport-tabs");
  var allTab = tabsEl && tabsEl.querySelector('.sport-tab[data-g="__all"]');
  if (allTab) allTab.classList.add("on");
  if (tabsEl) tabsEl.addEventListener("click", function (e) {
    var t = e.target.closest(".sport-tab"); if (!t) return;
    var all = tabsEl.querySelectorAll(".sport-tab");
    for (var i = 0; i < all.length; i++) all[i].classList.remove("on");
    t.classList.add("on");
    var gk = t.getAttribute("data-g");
    if (gk === "__all") { g.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    var sec = g.querySelector('.sport-group[data-g="' + gk + '"]');
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

(function () {
  var SELECTOR = ".chip[data-cat], .modern-card-tag, .class-card-category";
  function decorate(root) {
    if (!root || !root.querySelectorAll) return;
    var nodes = root.querySelectorAll(SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute("data-iconized") || el.querySelector("img")) continue;
      var txt = (el.textContent || "").trim();
      var img = sportIconImg(txt, 15);
      if (!img) continue;
      el.insertAdjacentHTML("afterbegin", img);
      if (el.classList.contains("chip")) { el.style.background = sportTint(txt, 0.16); }
      el.setAttribute("data-iconized", "1");
    }
  }
  function run() {
    decorate(document);
    renderSportGrid("sportGrid");
    if (window.MutationObserver && document.body) {
      new MutationObserver(function () { decorate(document); }).observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();