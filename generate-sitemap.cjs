/**
 * generate-sitemap.js — Dynamic sitemap generator for ZenPass
 *
 * Run: node generate-sitemap.js
 * Auto-regenerates sitemap.xml from static + dynamic page data.
 * Should be triggered by cron daily (or after course updates).
 */

const fs = require('fs');
const path = require('path');

const baseUrl = 'https://zenpass.hk';
const today = new Date().toISOString().split('T')[0];

// ─── Static Pages ────────────────────────────────────────────────
const staticPages = [
  { url: '/',                    priority: 1.0, changefreq: 'daily'   },
  { url: '/explore.html',        priority: 0.9, changefreq: 'daily'   },
  { url: '/class-detail.html',   priority: 0.9, changefreq: 'daily'   },
  { url: '/coaches.html',        priority: 0.8, changefreq: 'daily'   },
  { url: '/coach-profile.html',  priority: 0.7, changefreq: 'daily'   },
  { url: '/membership.html',     priority: 0.9, changefreq: 'weekly'  },
  { url: '/buy-credits.html',    priority: 0.7, changefreq: 'weekly'  },
  { url: '/wallet.html',         priority: 0.6, changefreq: 'weekly'  },
  { url: '/payment.html',        priority: 0.6, changefreq: 'monthly' },
  { url: '/faq.html',            priority: 0.8, changefreq: 'weekly'  },
  { url: '/guides.html',         priority: 0.7, changefreq: 'weekly'  },
  { url: '/referral.html',       priority: 0.6, changefreq: 'weekly'  },
  { url: '/checkin.html',        priority: 0.5, changefreq: 'weekly'  },
  { url: '/signup.html',         priority: 0.7, changefreq: 'monthly' },
  { url: '/my-bookings.html',    priority: 0.5, changefreq: 'weekly'  },
  { url: '/coach-apply.html',    priority: 0.7, changefreq: 'weekly'  },
  { url: '/partner-apply.html',  priority: 0.7, changefreq: 'weekly'  },
  { url: '/partners.html',       priority: 0.6, changefreq: 'weekly'  },
  { url: '/corporate-guide.html',priority: 0.7, changefreq: 'weekly'  },
  { url: '/about.html',          priority: 0.6, changefreq: 'monthly' },
  { url: '/privacy.html',        priority: 0.4, changefreq: 'monthly' },
  { url: '/terms.html',          priority: 0.4, changefreq: 'monthly' },
];

// ─── Dynamic Courses (from SQLite DB) ──────────────────────────
// When real course data is in the DB, uncomment below:
/*
const Database = require('better-sqlite3');
const db = new Database('./backend/data/zenpass.db');  // run from project root
const rows = db.prepare('SELECT id, title FROM classes WHERE status = ? OR status IS NULL').all('active');
rows.forEach(row => {
  dynamicCourses.push({ id: row.id, title: row.title });
});
db.close();
console.log('   DB courses:', rows.length);
*/
const dynamicCourses = [];

// ─── Generator ──────────────────────────────────────────────────
function generateSitemap() {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;

  // Static pages
  staticPages.forEach(page => {
    xml += `  <url>
    <loc>${baseUrl}${page.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>\n`;
  });

  // Dynamic course pages
  dynamicCourses.forEach(course => {
    xml += `  <url>
    <loc>${baseUrl}/class-detail.html?id=${course.id}</loc>
    <lastmod>${course.lastmod || today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>\n`;
  });

  xml += `</urlset>\n`;

  // Write to frontend directory (served at /sitemap.xml)
  const outputPath = path.join(__dirname, 'frontend', 'sitemap.xml');
  // Also write to root for GitHub Pages compatibility
  const rootPath = path.join(__dirname, 'sitemap.xml');

  fs.writeFileSync(outputPath, xml, 'utf8');
  fs.writeFileSync(rootPath, xml, 'utf8');
  console.log(`✅ Sitemap generated (${staticPages.length} static + ${dynamicCourses.length} dynamic pages)`);
  console.log(`   → ${outputPath}`);
  console.log(`   lastmod: ${today}`);
}

generateSitemap();
