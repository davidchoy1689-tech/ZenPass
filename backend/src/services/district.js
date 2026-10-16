/**
 * ZenPass — 香港 18 區地區解析（District resolver）
 * 用途：由場地名稱／地址文字自動判定行政區，令課程可以「按地區自動分區」。
 * 單一來源：DISTRICTS（code = URL zone 參數；name = 正式區名；kw = 區內主要地段關鍵字）
 */

const DISTRICTS = [
  { code: "cw", name: "中西區", kw: ["中西區", "中環", "上環", "西環", "西營盤", "堅尼地城", "半山", "山頂", "金鐘", "石塘咀"] },
  { code: "wc", name: "灣仔", kw: ["灣仔", "銅鑼灣", "跑馬地", "天后", "大坑", "摩理臣山", "鵝頸"] },
  { code: "east", name: "東區", kw: ["東區", "北角", "炮台山", "鰂魚涌", "太古", "西灣河", "筲箕灣", "柴灣", "杏花邨", "小西灣"] },
  { code: "south", name: "南區", kw: ["南區", "香港仔", "鴨脷洲", "薄扶林", "置富", "赤柱", "淺水灣", "深水灣", "數碼港", "黃竹坑", "石澳", "大潭"] },
  { code: "ytm", name: "油尖旺", kw: ["油尖旺", "尖沙咀", "尖東", "佐敦", "油麻地", "旺角", "太子", "大角咀", "奧運", "西九"] },
  { code: "ssp", name: "深水埗", kw: ["深水埗", "長沙灣", "荔枝角", "美孚", "南昌", "蘇屋", "石硤尾"] },
  { code: "kc", name: "九龍城", kw: ["九龍城", "土瓜灣", "紅磡", "何文田", "馬頭圍", "啟德", "九龍塘", "黃埔"] },
  { code: "wts", name: "黃大仙", kw: ["黃大仙", "鑽石山", "新蒲崗", "彩虹", "慈雲山", "樂富", "橫頭磡", "竹園"] },
  { code: "kt", name: "觀塘", kw: ["觀塘", "牛頭角", "九龍灣", "藍田", "油塘", "秀茂坪", "四順"] },
  { code: "kts", name: "葵青", kw: ["葵青", "葵涌", "葵芳", "青衣", "荔景", "大窩口"] },
  { code: "tw", name: "荃灣", kw: ["荃灣", "深井", "馬灣", "汀九"] },
  { code: "tm", name: "屯門", kw: ["屯門", "兆康", "蝴蝶灣", "龍門", "小欖"] },
  { code: "yl", name: "元朗", kw: ["元朗", "天水圍", "錦田", "八鄉", "新田", "流浮山", "洪水橋"] },
  { code: "north", name: "北區", kw: ["北區", "粉嶺", "上水", "聯和墟", "沙頭角", "古洞"] },
  { code: "tp", name: "大埔", kw: ["大埔", "太和", "白石角", "林村"] },
  { code: "st", name: "沙田", kw: ["沙田", "大圍", "火炭", "馬鞍山", "沙田圍", "石門", "第一城"] },
  { code: "sk", name: "西貢", kw: ["西貢", "將軍澳", "坑口", "寶琳", "康城", "調景嶺", "清水灣"] },
  { code: "islands", name: "離島", kw: ["離島", "東涌", "長洲", "大嶼山", "愉景灣", "坪洲", "南丫島", "赤鱲角", "機場", "梅窩"] },
];

/** 由任意文字（地址／場地名）推斷行政區名稱；搵唔到回 ""。 */
function resolveDistrict(text) {
  const hay = String(text || "");
  if (!hay) return "";
  for (const d of DISTRICTS) {
    for (const k of d.kw) {
      if (hay.includes(k)) return d.name;
    }
  }
  return "";
}

/** zone code → 正式區名 */
function zoneName(code) {
  const d = DISTRICTS.find((x) => x.code === code);
  return d ? d.name : "";
}

module.exports = { DISTRICTS, resolveDistrict, zoneName };
