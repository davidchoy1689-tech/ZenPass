#!/usr/bin/env node
/* gen-sport-pages.cjs — 生成運動項目靜態 SEO 頁 + sport.html
 * 用法：node scripts/gen-sport-pages.cjs
 * 產出：
 *   frontend-v2/s/<slug>.html   靜態可收錄頁（Hero / 玩法 / 適合誰 / 開班 / FAQ / 底部 CTA）
 *   frontend-v2/sport.html      探索頁（同一份資料，chips 切換）
 *   frontend-v2/s/<alias>.html  舊／別名 slug 的 302-ish 轉址 stub
 * 單一資料來源 = 本檔案 SPORTS，改資料後重跑即可。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "frontend-v2");
const SITE = "https://zenpass.hk";
const WA = "85290335538";

const SPORTS = [
  {
    slug: "stretch", name: "身心伸展", en: "Stretching", icon: "🧘‍♀️",
    img: "assets/img/photos/stretch.jpg", tag: "久坐族必上",
    time: "60–120 分鐘", level: "零基礎可", ages: "12 歲以上成人為主",
    gear: "場地提供瑜伽墊，著寬鬆運動服、赤腳或穿防滑襪即可",
    how: "跟呼吸慢慢伸展，由肩頸到腰背逐節放鬆",
    lead: "呼吸、溫和伸展、正念放鬆。專治肩頸腰背痛、姿勢差、睡眠淺。",
    why: ["舒緩肩頸腰背", "改善姿勢", "提升睡眠", "減壓放鬆"],
    forWho: "長時間對電腦、久坐、壓力大的上班族；產後或運動新手都適合。",
    cat: "身心伸展",
    keys: ["伸展", "瑜伽", "stretch", "yoga"],
  },
  {
    slug: "molkky", name: "芬蘭木柱", en: "Mölkky", icon: "🎯",
    img: "assets/img/photos/emerging.jpg", tag: "團隊新興運動",
    time: "60–90 分鐘", level: "零基礎可", ages: "6 歲以上，一家大細都玩得",
    gear: "木柱同投擲棒由場地提供，著一般運動服波鞋",
    how: "擲木棒撞倒木柱，剛好 50 分即勝，手氣加策略",
    lead: "來自芬蘭的投擲木柱運動，講策略、講手感，一隊人玩到笑。",
    why: ["手眼協調", "團隊合作", "低衝擊", "老少咸宜"],
    forWho: "朋友聚會、公司團建、學校活動；想運動但唔想跑跳嘅人。",
    cat: "新興運動",
    keys: ["木柱", "mölkky", "molkky", "芬蘭"],
  },
  {
    slug: "floor-curling", name: "地板冰壺", en: "Floor Curling", icon: "🥌",
    img: "assets/img/photos/emerging.jpg", tag: "腦力＋手感",
    time: "60–90 分鐘", level: "零基礎可", ages: "8 歲以上至長者",
    gear: "冰壺同賽道由場地提供，著運動服、室內波鞋",
    how: "推壺入圓心，力度同角度都要計，最後一壺最刺激",
    lead: "冰壺嘅陸上版，唔使上冰都玩到；講究力度同角度，越玩越上癮。",
    why: ["專注力", "策略思考", "低衝擊", "適合長者"],
    forWho: "長者中心、復康小組、公司團建。",
    cat: "新興運動",
    keys: ["冰壺", "curling"],
  },
  {
    slug: "cornhole", name: "布袋球", en: "Cornhole", icon: "🫘",
    img: "assets/img/photos/emerging.jpg", tag: "派對必備",
    time: "45–60 分鐘", level: "零基礎可", ages: "5 歲以上",
    gear: "豆袋同板由場地提供，冇裝備要求",
    how: "擲豆袋入斜板個洞，入洞 3 分、板面 1 分，先到 21 分",
    lead: "擲豆袋入洞，簡單易學、即刻有成功感，最容易帶動氣氛。",
    why: ["手眼協調", "氣氛熱鬧", "易學", "可室內"],
    forWho: "派對、市集、學校、公司活動。",
    cat: "新興運動",
    keys: ["布袋", "豆袋", "cornhole"],
  },
  {
    slug: "air-storm", name: "穿雲箭", en: "Air Storm", icon: "🏹",
    img: "assets/img/photos/emerging.jpg", tag: "減壓神器",
    time: "60 分鐘", level: "零基礎可", ages: "8 歲以上",
    gear: "氣槍同軟箭由場地提供，安全唔會痛",
    how: "用氣槍射軟箭打靶，計分鬥準，一射即上癮",
    lead: "用氣槍射軟箭，安全又刺激；射中靶一刻非常減壓。",
    why: ["專注力", "減壓", "安全", "有比賽感"],
    forWho: "青少年、公司團建、想放電嘅人。",
    cat: "新興運動",
    keys: ["穿雲箭", "氣槍", "air storm", "airstorm"],
  },
  {
    slug: "nordic-walking", name: "北歐式健走", en: "Nordic Walking", icon: "🥾",
    img: "assets/img/photos/senior.jpg", tag: "長者友善",
    time: "60–90 分鐘", level: "零基礎可", ages: "長者、康復人士最適合",
    gear: "健走杖由教練提供，著波鞋、帶水",
    how: "用兩支杖行路，上肢一齊推，膝頭負擔減一半",
    lead: "用健走杖行路，減輕膝關節負擔，同時練上肢同核心。",
    why: ["護膝", "練全身", "戶外", "心肺"],
    forWho: "長者、康復人士、想低衝擊帶氧運動嘅人。",
    cat: "戶外及體能",
    keys: ["北歐", "健走", "nordic"],
  },
  {
    slug: "roundnet", name: "圓網球", en: "Roundnet", icon: "🕸️",
    img: "assets/img/photos/emerging.jpg", tag: "年輕人最愛",
    time: "60 分鐘", level: "中等", ages: "12 歲以上",
    gear: "彈網同球由場地提供，著運動服波鞋",
    how: "兩隊各三人，三下之內回球過網，節奏快到爆",
    lead: "三下之內回球，節奏快、反應快，兩隊對打非常過癮。",
    why: ["反應", "爆發力", "團隊", "好玩"],
    forWho: "青少年、大學生、運動底子較好嘅人。",
    cat: "新興運動",
    keys: ["圓網", "roundnet"],
  },
  {
    slug: "rouliqiu", name: "柔力球", en: "Rouliqiu", icon: "🎾",
    img: "assets/img/photos/senior.jpg", tag: "長者／復康",
    time: "60 分鐘", level: "零基礎可", ages: "長者、復康人士",
    gear: "球拍同球由教練提供，著鬆身運動服",
    how: "用球拍畫圓接球，動作柔順連貫，唔靠撞擊",
    lead: "用球拍畫圓接球，動作柔順連貫，練協調同平衡。",
    why: ["平衡", "協調", "低衝擊", "適合長者"],
    forWho: "長者、復康、想溫和運動嘅人。",
    cat: "健體及新興",
    keys: ["柔力", "rouliqiu"],
  },
  {
    slug: "flexi-bar", name: "Flexi-Bar", en: "Flexi-Bar", icon: "〰️",
    img: "assets/img/photos/fitness.jpg", tag: "深層核心",
    time: "45 分鐘", level: "零基礎可", ages: "16 歲以上",
    gear: "震動桿由場地提供，著貼身運動服方便睇姿勢",
    how: "揸住震動桿穩定震頻，深層肌肉自動收緊",
    lead: "震動桿帶動深層肌肉，短時間高效練核心同肩背。",
    why: ["核心", "肩背", "短時高效", "低衝擊"],
    forWho: "久坐、肩背弱、想練核心但唔想舉重嘅人。",
    cat: "健體及新興",
    keys: ["flexi", "震動"],
  },
  {
    slug: "kids", name: "兒童健體", en: "Kids Fitness", icon: "🧒",
    img: "assets/img/photos/kids.jpg", tag: "3–12 歲",
    time: "45–60 分鐘", level: "分齡設計", ages: "3–12 歲（分齡分組）",
    gear: "所有器材由教練準備，小朋友著運動服、帶水同毛巾",
    how: "用遊戲練平衡、協調、反應，玩住做運動",
    lead: "用遊戲練平衡、協調、反應；小朋友放電，家長放心。",
    why: ["大小肌肉", "專注力", "社交", "放電"],
    forWho: "3–12 歲小朋友；幼稚園、小學、生日會。",
    cat: "兒童健體",
    keys: ["兒童", "小朋友", "kids"],
  },
];

// 舊／別名 slug → 正式 slug（我會喺舊 link 補 301-like stub）
const ALIASES = {
  archery: "air-storm",
  ringtennis: "roundnet",
  flexibar: "flexi-bar",
  kidsfit: "kids",
  "kids-fitness": "kids",
  kidsfitness: "kids",
  floorcurling: "floor-curling",
  "floor_curling": "floor-curling",
  nordicwalking: "nordic-walking",
  moelkkyla: "molkky",
  molkkyla: "molkky",
  stretching: "stretch",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SHARED_CSS = `
  .sp-hero{position:relative;border-radius:22px;overflow:hidden;min-height:260px;display:flex;align-items:flex-end;margin:0 0 14px}
  .sp-hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .sp-hero .veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05) 20%,rgba(0,0,0,.74) 100%)}
  .sp-hero .txt{position:relative;padding:18px;color:#fff}
  .sp-hero h1{margin:0;font-size:26px;line-height:1.2}
  .sp-hero .en{font-size:13px;opacity:.85;font-weight:600;letter-spacing:.4px}
  .sp-hero p{margin:6px 0 0;font-size:13.5px;opacity:.94}
  .chip{display:inline-block;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:999px;padding:4px 10px;font-size:12px;margin:0 6px 6px 0}
  .badges{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:0 0 12px}
  .badges div{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:9px 10px;font-size:12px;line-height:1.35}
  .badges span{display:block;color:var(--text-muted);font-size:11px;margin-bottom:2px}
  .badges b{font-size:13px}
  .why{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .why div{background:var(--surface-2);border-radius:12px;padding:9px 11px;font-size:13px}
  .navsp{display:flex;gap:8px;overflow-x:auto;padding:2px 0 10px;-webkit-overflow-scrolling:touch}
  .navsp a{white-space:nowrap;font-size:12px;padding:7px 12px;border-radius:999px;border:1px solid var(--border);color:var(--text);text-decoration:none;background:var(--surface)}
  .navsp a.on{background:var(--brand-500);border-color:var(--brand-500);color:#fff;font-weight:700}
  .cls{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:12px 0;border-bottom:1px solid var(--border)}
  .cls:last-child{border-bottom:0}
  .cls .meta{font-size:12.5px;color:var(--text-muted);margin-top:3px}
  .cls .price{font-weight:800;color:var(--brand-600)}
  .empty{color:var(--text-muted);font-size:13px;text-align:center;padding:12px 0}
  .sk{height:14px;border-radius:8px;background:linear-gradient(90deg,var(--surface-2) 25%,var(--border) 50%,var(--surface-2) 75%);background-size:200% 100%;animation:skm 1.2s infinite;margin:10px 0}
  @keyframes skm{0%{background-position:200% 0}100%{background-position:-200% 0}}
  .faq details{border-top:1px solid var(--border);padding:11px 0}
  .faq details:first-of-type{border-top:0}
  .faq summary{font-weight:700;font-size:14px;cursor:pointer;list-style:none}
  .faq summary::-webkit-details-marker{display:none}
  .faq summary::before{content:"＋ ";color:var(--brand-500)}
  .faq details[open] summary::before{content:"－ "}
  .faq p{margin:8px 0 0;font-size:13.5px;color:var(--text-muted);line-height:1.6}
  .wrap.ctapb{padding-bottom:calc(96px + env(safe-area-inset-bottom))}
  .cta-bar{position:fixed;left:0;right:0;bottom:0;z-index:40;background:var(--surface);border-top:1px solid var(--border);
    padding:10px 14px calc(10px + env(safe-area-inset-bottom));display:flex;gap:10px;align-items:center;justify-content:space-between;box-shadow:0 -6px 22px rgba(0,0,0,.08)}
  .cta-bar .p{font-size:11.5px;color:var(--text-muted);line-height:1.3}
  .cta-bar .p b{display:block;font-size:15px;color:var(--text)}
  .cta-bar .btn{white-space:nowrap;padding:11px 16px;font-size:14px}
  @media (max-width:360px){.badges{grid-template-columns:1fr 1fr}}
`;

function faqsFor(s) {
  return [
    ["需要自備裝備嗎？", s.gear + "。"],
    ["適合幾歲玩？", s.ages + "。教練會按參加者程度調整難度，新手一樣跟得上。"],
    ["著咩衫？", "一般運動服＋波鞋就可以，唔需要特別裝備；記得帶水同毛巾。"],
  ];
}

function head(s) {
  const enTag = s.en && s.en.toLowerCase() !== s.name.toLowerCase() ? ` ${s.en}` : "";
  const title = `${s.name}${enTag} 體驗班｜${s.tag}｜ZenPass 禪流`;
  const desc = `${s.lead} 香港「${s.cat}」體驗班，${s.time}，${s.level}，即刻睇最近開班時段。`;
  const url = `${SITE}/s/${s.slug}.html`;
  const img = `${SITE}/${s.img}`;
  const faq = faqsFor(s);
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FAQPage",
        mainEntity: faq.map(([q, a]) => ({
          "@type": "Question", name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "ZenPass 禪流", item: SITE + "/" },
          { "@type": "ListItem", position: 2, name: "運動項目", item: SITE + "/sport.html" },
          { "@type": "ListItem", position: 3, name: s.name, item: url },
        ],
      },
    ],
  };
  return `<!doctype html>
<html lang="zh-HK">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="theme-color" content="#ff6b35" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="ZenPass 禪流" />
<meta property="og:locale" content="zh_HK" />
<meta property="og:title" content="${esc(s.icon + " " + title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:image" content="${img}" />
<meta property="og:url" content="${url}" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="stylesheet" href="/assets/v2.css?v=26" />
<link rel="stylesheet" href="/assets/ui-v3.css?v=5" />
<style>${SHARED_CSS}</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>`;
}

function navChips(current) {
  return `<div class="navsp">${SPORTS.map(
    (x) => `<a href="/s/${x.slug}.html" class="${x.slug === current ? "on" : ""}">${x.icon} ${esc(x.name)}</a>`
  ).join("")}</div>`;
}

function classesBlock(s) {
  return `<div class="card" id="classes-card" style="margin-bottom:12px"><div class="body">
    <b>即將開班</b>
    <div id="classes" style="margin-top:8px">
      <div class="sk" style="width:70%"></div><div class="sk" style="width:45%"></div><div class="sk" style="width:60%"></div>
    </div>
  </div></div>`;
}

function staticPage(s) {
  const faq = faqsFor(s);
  const waText = encodeURIComponent(`我想查詢「${s.name}」班組安排`);
  return `${head(s)}
<body>
  <div class="topbar"><a class="back" href="/explore.html" aria-label="返回">‹</a><div class="title">${esc(s.name)}</div></div>
  <div class="wrap ctapb">
    ${navChips(s.slug)}

    <div class="sp-hero">
      <img src="/${s.img}" alt="${esc(s.name)} ${esc(s.en)} 體驗班" onerror="this.style.display='none'" />
      <div class="veil"></div>
      <div class="txt">
        <div class="en">${esc(s.en)}</div>
        <h1>${s.icon} ${esc(s.name)}</h1>
        <div style="margin-top:8px">
          <span class="chip">${esc(s.tag)}</span><span class="chip">⏱ ${esc(s.time)}</span><span class="chip">✅ ${esc(s.level)}</span>
        </div>
        <p>${esc(s.lead)}</p>
      </div>
    </div>

    <div class="badges">
      <div><span>🎯 玩法核心</span><b>${esc(s.how)}</b></div>
      <div><span>⏱ 上手難度</span><b>${esc(s.level)}</b></div>
      <div><span>👥 適合對象</span><b>${esc(s.ages)}</b></div>
    </div>

    <div class="card" style="margin-bottom:12px"><div class="body">
      <b>學到咩</b>
      <div class="why" style="margin-top:8px">${s.why.map((w) => `<div>✅ ${esc(w)}</div>`).join("")}</div>
    </div></div>

    <div class="card" style="margin-bottom:12px"><div class="body">
      <b>適合邊個</b>
      <div class="kv" style="margin-top:6px;color:var(--text-muted);font-size:13.5px;line-height:1.6">${esc(s.forWho)}</div>
    </div></div>

    ${classesBlock(s)}

    <div class="card faq" style="margin-bottom:12px"><div class="body">
      <b>常見問題</b>
      <div style="margin-top:6px">${faq
        .map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`)
        .join("")}</div>
    </div></div>

    <div class="card"><div class="body">
      <b>想開班／包團？</b>
      <div style="margin:6px 0 10px;color:var(--text-muted);font-size:13.5px">可以按你嘅人數、地點、時間安排，歡迎直接問。</div>
      <a class="btn btn-primary btn-block" href="https://wa.me/${WA}?text=${waText}" target="_blank" rel="noopener">💬 WhatsApp 查詢</a>
    </div></div>

    <div class="spacer"></div>
  </div>

  <div class="cta-bar">
    <div class="p"><b id="ctaPrice">首堂體驗</b><span id="ctaSub">睇最近開班時段</span></div>
    <a class="btn btn-primary" href="#classes-card">查看開班時段 →</a>
  </div>

  <script src="/assets/api.js?v=3"></script>
  <script>
  (function () {
    var CAT = ${JSON.stringify(s.cat)};
    var NAME = ${JSON.stringify(s.name)};
    var SLUG = ${JSON.stringify(s.slug)};
    var KEYS = ${JSON.stringify(s.keys || [s.name])};
    var el = document.getElementById("classes");
    function fmt(t) {
      try { return new Date(t).toLocaleString("zh-HK", { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }); }
      catch (e) { return "待定"; }
    }
    function render(list) {
      if (!list.length) {
        el.innerHTML = '<div class="empty">最近班別籌備中 — 想我哋開班？<br><a href="https://wa.me/${WA}?text=' + encodeURIComponent("我想「" + NAME + "」開班，請通知我") + '" target="_blank" rel="noopener" style="color:var(--brand-600);font-weight:700">登記開班通知 →</a></div>';
        return;
      }
      el.innerHTML = list.slice(0, 3).map(function (c) {
        var schs = (c.schedules || []).filter(function (x) { return x.start_time && new Date(x.start_time).getTime() > Date.now(); });
        var sch = schs[0] || (c.schedules || [])[0] || {};
        var when = sch.start_time ? fmt(sch.start_time) : "待定";
        var cap = sch.max_participants || c.max_participants || 0;
        var left = cap ? (cap - (sch.enrolled_count || 0)) : null;
        var price = c.price_hkd ? '<span class="price">HK$' + Math.round(c.price_hkd) + '</span>' : "";
        var leftTxt = left !== null && left >= 0 ? " · 🔥 剩 " + left + " 位" : "";
        return '<div class="cls"><span><b>' + (c.title || NAME) + '</b>' +
          '<div class="meta">' + when + (c.venue_name ? " · " + c.venue_name : "") + leftTxt + '</div></span>' +
          '<span style="text-align:right;display:flex;gap:8px;align-items:center">' + price +
          '<a class="btn btn-primary" style="padding:8px 12px;font-size:13px" href="/detail.html?id=' + encodeURIComponent(c.id) + '">即刻預約</a></span></div>';
      }).join("");
      var prices = list.map(function (c) { return c.price_hkd || 0; }).filter(function (p) { return p > 0; });
      if (prices.length) {
        document.getElementById("ctaPrice").textContent = "HK$" + Math.round(Math.min.apply(null, prices)) + " 起";
        document.getElementById("ctaSub").textContent = NAME + " 體驗班";
      }
    }
    api.get("/classes?category=" + encodeURIComponent(CAT) + "&limit=30")
      .then(function (r) {
        var arr = (r && (r.classes || r.items || (r.data && (r.data.classes || r.data.items)))) || [];
        // 優先 sport_slug，其次標題關鍵字；唔 match 就唔好亂顯示其他運動
        var mine = arr.filter(function (c) {
          if (c.sport_slug) return c.sport_slug === SLUG;
          var t = (c.title || "").toLowerCase();
          return KEYS.some(function (k) { return t.indexOf(String(k).toLowerCase()) >= 0; });
        });
        render(mine);
      })
      .catch(function () {
        el.innerHTML = '<div class="empty">暫時載入唔到班次，<a href="/courses.html" style="color:var(--brand-600);font-weight:700">睇全部課程 →</a></div>';
      });
  })();
  </script>
</body>
</html>
`;
}

function aliasPage(from, to) {
  const t = SPORTS.find((x) => x.slug === to) || { name: to, en: "" };
  const url = `/s/${to}.html`;
  return `<!doctype html>
<html lang="zh-HK">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(t.name)} · ZenPass 禪流</title>
<meta name="robots" content="noindex,follow" />
<link rel="canonical" href="${SITE}${url}" />
<meta http-equiv="refresh" content="0; url=${url}" />
<script>location.replace("${url}");</script>
<style>body{font-family:-apple-system,'PingFang HK',sans-serif;text-align:center;padding:40px;color:#6b7280}a{color:#ff6b35}</style>
</head>
<body>
<p>帶你去 <b>${esc(t.name)}</b>…</p>
<p><a href="${url}">開啟頁面</a></p>
</body>
</html>
`;
}

function sportIndex() {
  return `<!doctype html>
<html lang="zh-HK">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="theme-color" content="#ff6b35" />
<title>運動項目 · ZenPass 禪流</title>
<meta name="description" content="ZenPass 禪流 — 新興運動體驗，一個 Pass 通行全城。芬蘭木柱、地板冰壺、布袋球、圓網球、身心伸展等。" />
<link rel="canonical" href="${SITE}/sport.html" />
<meta property="og:title" content="運動項目 · ZenPass 禪流" />
<meta property="og:description" content="新興運動體驗，一個 Pass 通行全城。" />
<meta property="og:image" content="${SITE}/assets/img/photos/emerging.jpg" />
<meta property="og:url" content="${SITE}/sport.html" />
<link rel="stylesheet" href="assets/v2.css?v=26" />
<link rel="stylesheet" href="assets/ui-v3.css?v=5" />
<style>${SHARED_CSS}</style>
</head>
<body>
  <div class="topbar"><a class="back" href="explore.html">‹</a><div class="title" id="topTitle">運動項目</div></div>
  <div class="wrap">
    <div id="hero"><div class="card"><div class="body">
      <b style="font-size:16px">揀一項運動了解多啲</b>
      <div style="margin-top:6px;color:var(--text-muted);font-size:13.5px">每項運動都有獨立介紹、適合對象同即將開班時段。</div>
    </div></div></div>
    <div id="navsp"></div>
    <div style="margin-top:12px"><div class="card"><div class="body" style="padding:0" id="list"></div></div></div>
    <div class="spacer"></div>
  </div>
  <script src="assets/api.js?v=3"></script>
  <script>
  (function () {
    var SPORTS = ${JSON.stringify(SPORTS.map((x) => ({
      slug: x.slug, name: x.name, icon: x.icon, tag: x.tag, lead: x.lead,
    })))};
    var q = (new URLSearchParams(location.search).get("slug") || "").toLowerCase();
    var ALIAS = ${JSON.stringify(ALIASES)};
    if (q && ALIAS[q]) q = ALIAS[q];
    if (q && SPORTS.some(function (s) { return s.slug === q; })) {
      location.replace("/s/" + q + ".html");
      return;
    }
    document.getElementById("navsp").innerHTML = '<div class="navsp">' + SPORTS.map(function (s) {
      return '<a href="/s/' + s.slug + '.html">' + s.icon + " " + s.name + "</a>";
    }).join("") + "</div>";
    document.getElementById("list").innerHTML = SPORTS.map(function (s) {
      return '<a class="cls" style="text-decoration:none;color:inherit;padding:14px 16px" href="/s/' + s.slug + '.html">' +
        "<span><b>" + s.icon + " " + s.name + '</b><div class="meta">' + s.lead.slice(0, 34) + "…</div></span>" +
        '<span class="pill">' + s.tag + "</span></a>";
    }).join("");
  })();
  </script>
</body>
</html>
`;
}

// ---- write ----
fs.mkdirSync(path.join(ROOT, "s"), { recursive: true });
for (const s of SPORTS) {
  fs.writeFileSync(path.join(ROOT, "s", s.slug + ".html"), staticPage(s), "utf8");
}
for (const [from, to] of Object.entries(ALIASES)) {
  if (SPORTS.some((s) => s.slug === from)) continue;
  fs.writeFileSync(path.join(ROOT, "s", from + ".html"), aliasPage(from, to), "utf8");
}
fs.writeFileSync(path.join(ROOT, "sport.html"), sportIndex(), "utf8");

// sitemap: 補 /s/*.html（保留原有條目，去重）
const smPath = path.join(ROOT, "sitemap.xml");
if (fs.existsSync(smPath)) {
  let sm = fs.readFileSync(smPath, "utf8");
  const add = SPORTS.map((s) => `${SITE}/s/${s.slug}.html`).filter((u) => !sm.includes(`<loc>${u}</loc>`));
  if (add.length) {
    const today = new Date().toISOString().slice(0, 10);
    const block = add.map((u) => `  <url><loc>${u}</loc><changefreq>weekly</changefreq><priority>0.8</priority><lastmod>${today}</lastmod></url>`).join("\n");
    sm = sm.replace("</urlset>", block + "\n</urlset>");
    fs.writeFileSync(smPath, sm, "utf8");
  }
  console.log("sitemap 新增:", add.length);
}
console.log("生成完成:", SPORTS.length, "個項目頁 +", Object.keys(ALIASES).length, "個別名 + sport.html");
