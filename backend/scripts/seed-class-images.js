#!/usr/bin/env node
// ZenPass 課程相片自動注入腳本
// 用 Pexels 免費 API 為每個分類搜尋相關相片，存入 DB

const https = require('https');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'zenpass.db');
const PEXELS_KEY = 'DEMO_KEY'; // 免費 key，production 請換正式 API key

// 每個分類對應的搜尋關鍵字（更精準）
const CATEGORY_QUERIES = {
  '瑜伽': 'yoga class',
  '健身': 'fitness gym workout',
  '伸展': 'stretching exercise',
  '冥想': 'meditation',
  '舞蹈': 'dancing',
  '新興運動': 'sports activity',
  '拳擊搏擊': 'boxing',
  '泰拳搏擊': 'muay thai',
  'TRX 懸吊訓練': 'trx suspension training',
  '肌力訓練': 'weightlifting strength',
  '心肺訓練': 'running cardio',
  '乒乓球': 'table tennis',
  '羽毛球': 'badminton',
  '網球': 'tennis',
  '高爾夫球': 'golf',
  '保齡球': 'bowling',
  '芭蕾塑形': 'ballet barre',
  '皮拉提斯': 'pilates',
  '空中瑜伽': 'aerial yoga',
  '詠春': 'kung fu wing chun',
  '劍擊': 'fencing',
  '遠足行山': 'hiking trail',
  '露營戶外': 'camping outdoor',
  '攀岩': 'rock climbing',
  '單車': 'cycling bicycle',
  '溜冰': 'ice skating',
  '射箭': 'archery',
  '水中運動': 'swimming pool',
  '太極養生': 'tai chi',
  '兒童體適能': 'kids fitness children',
  '長者體適能': 'senior elderly exercise',
  '產後修復': 'postnatal exercise',
};

function pexelsSearch(query) {
  return new Promise((resolve, reject) => {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`;
    https.get(url, { headers: { 'Authorization': PEXELS_KEY } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.photos && json.photos.length > 0) {
            resolve(json.photos[0].src.medium);
          } else {
            resolve(null);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('📸 ZenPass 課程相片自動注入\n');

  const sqlite3 = require('better-sqlite3');
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ Database not found: ${DB_PATH}`);
    process.exit(1);
  }

  const db = new sqlite3(DB_PATH);

  // 取得所有分類
  const categories = db.prepare('SELECT DISTINCT category FROM classes ORDER BY category').all();
  console.log(`📂 找到 ${categories.length} 個分類\n`);

  const results = { success: 0, failed: 0, skipped: 0 };

  for (const { category } of categories) {
    const query = CATEGORY_QUERIES[category];
    if (!query) {
      console.log(`  ⏭️  ${category}: 無搜尋關鍵字`);
      results.skipped++;
      continue;
    }

    // 檢查該分類是否有 class 已有 image_url
    const hasImage = db.prepare('SELECT COUNT(*) as c FROM classes WHERE category = ? AND image_url IS NOT NULL AND image_url != \'\'').get(category);
    if (hasImage.c > 0) {
      console.log(`  ⏭️  ${category}: 已有 ${hasImage.c} 個 class 有相片`);
      results.skipped++;
      continue;
    }

    console.log(`  🔍 搜尋 ${category} (${query})...`);

    try {
      const imageUrl = await pexelsSearch(query);
      if (!imageUrl) {
        console.log(`  ❌  ${category}: 無搜尋結果`);
        results.failed++;
        continue;
      }

      // Update all classes in this category
      const update = db.prepare('UPDATE classes SET image_url = ? WHERE category = ? AND (image_url IS NULL OR image_url = \'\')');
      const info = update.run(imageUrl, category);
      console.log(`  ✅  ${category}: ${info.changes} 個 class 已更新相片`);
      results.success += info.changes;
    } catch (err) {
      console.log(`  ❌  ${category}: ${err.message}`);
      results.failed++;
    }

    // Rate limit: 200 requests per hour for DEMO_KEY
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n📊 完成: ${results.success} 個更新, ${results.failed} 個失敗, ${results.skipped} 個跳過`);
  db.close();
}

main().catch(console.error);
