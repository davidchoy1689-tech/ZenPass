/**
 * 教練公開專頁路由（2026-11-04）
 *  - GET /api/coaches/:slug/profile  公開唯讀 JSON
 *  - GET /c/:slug                    SSR-lite HTML（注入 SEO meta / JSON-LD）
 * 規格：docs/coach-public-profile-spec-v2.md
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const { getDb } = require("../services/database");
const svc = require("../services/coach-profile");

const TEMPLATE = path.join(__dirname, "../../../frontend-v2/coach-public.html");
const DEFAULT_OG = "/assets/og/zenpass-og.jpg";

function flagOn() {
  return String(process.env.COACH_PUBLIC_PROFILE || "1") !== "0";
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonLdEsc(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "zenpass.hk").split(",")[0].trim();
  return `${proto}://${host}`;
}

function buildMeta(p, base) {
  const name = p.coach.name || "教練";
  const area = p.positioning.primary_area || "";
  const t = p.trust;
  const types = (p.positioning.service_types || []).map((x) => x.key);
  const seniorFocus = types.some((k) => ["stretching", "senior_fitness", "rehab_posture"].includes(k));
  const nicheFocus = types.includes("niche_sports");
  const suffix = seniorFocus
    ? "銀髮伸展・1對1 PT教練"
    : nicheFocus
      ? "新興運動・團隊活動教練"
      : types.includes("pt_1on1")
        ? "1對1 私人教練"
        : "運動教練";
  const title = area ? `${name}｜${area}${suffix}｜ZenPass` : `${name}｜${suffix}｜ZenPass`;
  const bits = [];
  if (t.verified_teaching_hours > 0) bits.push(`${t.verified_teaching_hours} 小時認證授課`);
  if (t.certificates_issued > 0) bits.push(`${t.certificates_issued} 張官方證書`);
  if (t.rating.count > 0) bits.push(`${t.rating.avg}★（${t.rating.count} 評價）`);
  const focus = seniorFocus ? "長者伸展／防肌少症／1對1 PT" : nicheFocus ? "芬蘭木柱／地板冰壺／團隊活動" : "個人化運動訓練";
  const desc = `${area ? area : "全港"}${focus}。${bits.length ? bits.join("、") + "。" : ""}平日日間班招生中。`;
  const url = `${base}/c/${p.coach.slug}`;
  const image = /^https?:\/\//.test(p.coach.avatar || "") ? p.coach.avatar : `${base}${DEFAULT_OG}`;
  return { title, desc: desc.slice(0, 160), url, image };
}

function buildJsonLd(p, meta) {
  const graph = [
    {
      "@type": "Person",
      "@id": meta.url + "#person",
      name: p.coach.name,
      jobTitle: "運動教練",
      description: p.coach.bio || p.coach.headline || "",
      image: meta.image,
      url: meta.url,
      knowsLanguage: p.coach.languages.length ? p.coach.languages : ["zh-HK"],
    },
  ];
  if (p.credentials.license_masked || p.credentials.first_aid.type) {
    graph[0].hasCredential = [];
    if (p.credentials.license_type) {
      graph[0].hasCredential.push({
        "@type": "EducationalOccupationalCredential",
        name: p.credentials.license_type,
        credentialCategory: "license",
        validUntil: p.credentials.license_expiry || undefined,
      });
    }
    if (p.credentials.first_aid.type) {
      graph[0].hasCredential.push({
        "@type": "EducationalOccupationalCredential",
        name: p.credentials.first_aid.type,
        credentialCategory: "certification",
        validUntil: p.credentials.first_aid.expiry || undefined,
      });
    }
  }
  const first = p.upcoming[0];
  if (first) {
    graph.push({
      "@type": "SportsActivityLocation",
      "@id": meta.url + "#venue",
      name: first.venue_name || "ZenPass 合作場地",
      address: {
        "@type": "PostalAddress",
        addressLocality: first.district || p.positioning.primary_area || "香港",
        addressCountry: "HK",
      },
    });
    graph.push({
      "@type": "Service",
      "@id": meta.url + "#service",
      name: first.title,
      serviceType: p.positioning.service_types.map((x) => x.label).join("、") || "運動課程",
      provider: { "@id": meta.url + "#person" },
      areaServed: p.positioning.districts.map((d) => d.label).join("、") || "香港",
      offers: {
        "@type": "Offer",
        price: first.price_hkd,
        priceCurrency: "HKD",
        availability: first.seats_left === 0 ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
        url: meta.url,
      },
    });
  }
  graph.push({
    "@type": "FAQPage",
    mainEntity: p.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  });
  return { "@context": "https://schema.org", "@graph": graph };
}

function renderPage(html, p, req) {
  const base = baseUrl(req);
  const meta = buildMeta(p, base);
  const ld = buildJsonLd(p, meta);
  const map = {
    META_TITLE: esc(meta.title),
    META_DESC: esc(meta.desc),
    CANONICAL: esc(meta.url),
    OG_TITLE: esc(meta.title),
    OG_DESC: esc(meta.desc),
    OG_IMAGE: esc(meta.image),
    OG_URL: esc(meta.url),
    JSONLD: jsonLdEsc(ld),
    COACH_SLUG: esc(p.coach.slug),
    COACH_NAME: esc(p.coach.name),
  };
  return html.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (map[k] !== undefined ? map[k] : m));
}

const apiRouter = express.Router();

apiRouter.get("/:slug/profile", (req, res) => {
  try {
    if (!flagOn()) return res.status(404).json({ success: false, error: "功能未開放" });
    const db = getDb();
    const p = svc.getPublicProfile(db, String(req.params.slug || ""));
    if (!p) return res.status(404).json({ success: false, error: "教練不存在" });
    if (p.redirect) return res.status(301).json({ success: false, redirect: "/c/" + p.redirect });
    const meta = buildMeta(p, baseUrl(req));
    p.og = { title: meta.title, description: meta.desc, image: meta.image, url: meta.url };
    res.set("Cache-Control", "public, max-age=300");
    res.json({ success: true, ...p });
  } catch (err) {
    console.error("coach profile error:", err.message);
    res.status(500).json({ success: false, error: "讀取失敗" });
  }
});

const pageRouter = express.Router();

pageRouter.get("/:slug", (req, res) => {
  try {
    const slug = String(req.params.slug || "");
    if (!flagOn() || !/^[a-z0-9-]{1,64}$/i.test(slug)) {
      return res.status(404).type("html").send(notFoundHtml());
    }
    const db = getDb();
    const p = svc.getPublicProfile(db, slug);
    if (!p) return res.status(404).type("html").send(notFoundHtml());
    if (p.redirect) return res.redirect(301, "/c/" + p.redirect);

    const html = fs.readFileSync(TEMPLATE, "utf8");
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    res.send(renderPage(html, p, req));
  } catch (err) {
    console.error("coach page error:", err.message);
    res.status(500).type("html").send(notFoundHtml("暫時無法載入"));
  }
});

function notFoundHtml(msg) {
  return `<!doctype html><html lang="zh-HK"><head><meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>找不到教練檔案｜ZenPass</title>
<style>body{font-family:system-ui,-apple-system,"PingFang HK",sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
a{color:#ea580c;font-weight:700}</style></head>
<body><div><div style="font-size:44px">🔍</div><h1 style="font-size:20px">${esc(msg || "找不到這位教練")}</h1>
<p style="color:#64748b;font-size:15px">連結可能已更新，或者教練檔案未公開。</p>
<p><a href="/coaches.html">睇全部教練</a> · <a href="/explore.html">探索課堂</a></p></div></body></html>`;
}

module.exports = { apiRouter, pageRouter, buildMeta, buildJsonLd, renderPage, notFoundHtml };
