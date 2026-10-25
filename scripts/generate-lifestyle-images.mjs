#!/usr/bin/env node
/**
 * ZenPass — 真人實景圖自動生成（DALL·E 3）
 * 2026-10-25
 *
 * 用法：
 *   OPENAI_API_KEY=sk-... node scripts/generate-lifestyle-images.mjs            # 生成 + 寫入 mapping
 *   OPENAI_API_KEY=sk-... node scripts/generate-lifestyle-images.mjs --dry-run  # 只印 prompt 同成本估算
 *   node scripts/generate-lifestyle-images.mjs --manifest-only                  # 只重寫 mapping
 *
 * 產出：
 *   frontend-v2/assets/images/generated/<file>.jpg
 *   frontend-v2/assets/images/generated/images-manifest.json
 *   frontend-v2/assets/lifestyle-images.js   ← 前端讀 window.ZP_LIFESTYLE
 *
 * ⚠️ 成本：dall-e-3 1792x1024 standard ≈ US$0.08/張。4 張 ≈ US$0.32。
 *    執行前需要有 API key 同負責人批准。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const TARGET_DIR = path.join(ROOT, "frontend-v2/assets/images/generated");
const MAPPING_JS = path.join(ROOT, "frontend-v2/assets/lifestyle-images.js");

const TASKS = [
  {
    key: "molkky",
    slug: "molkky",
    filename: "molkky-session.jpg",
    prompt:
      "Authentic editorial lifestyle photograph of young Asian adults playing Mölkky (Finnish wooden pin throwing game) in a bright Hong Kong indoor turf studio. One man mid-throw, pins scattering, candid laughter, warm natural window light, 35mm film look, shallow depth of field, real sports apparel, no text, no logos, no emojis.",
  },
  {
    key: "floor-curling",
    slug: "floor-curling",
    filename: "curling-session.jpg",
    prompt:
      "Documentary photograph of people playing indoor floor curling in a modern Hong Kong sports hall. A focused Asian woman kneeling on one knee pushing a wheeled curling stone toward a red and blue target circle on smooth flooring, dynamic motion, bright even lighting, no text, no logos, no emojis.",
  },
  {
    key: "stretch",
    slug: "stretch",
    filename: "stretch-session.jpg",
    prompt:
      "Editorial photograph of a small Asian group doing a guided stretching class in a warm minimalist Hong Kong studio, mats on light wood floor, soft morning light through large windows, relaxed focused expressions, real athletic wear, no text, no logos, no emojis.",
  },
  {
    key: "kids",
    slug: "kids",
    filename: "kids-session.jpg",
    prompt:
      "Candid photograph of Hong Kong primary school children playing a fun coordination game in a bright school hall with a coach in athletic wear, genuine smiles, motion, natural light, documentary style, no text, no logos, no emojis.",
  },
  {
    key: "coach",
    slug: "_coach",
    filename: "star-coach-portrait.jpg",
    prompt:
      "Warm professional lifestyle portrait of a certified Asian sports coach in his early thirties wearing athletic trainer apparel with a whistle, smiling naturally in a bright modern fitness studio, soft window light, editorial photography, no text, no logos, no emojis.",
  },
  {
    key: "venue",
    slug: "_venue",
    filename: "venue-bright-studio.jpg",
    prompt:
      "Architectural lifestyle photograph of a boutique fitness studio in Hong Kong: warm light wood flooring, floor-to-ceiling windows with soft daylight, clean minimal interior, neatly stacked mats and mirrors, airy welcoming atmosphere, no people, no text, no logos.",
  },
];

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const MANIFEST_ONLY = args.has("--manifest-only");

function writeMapping(manifest) {
  const map = {};
  for (const t of TASKS) {
    if (manifest[t.key]) map[t.slug] = manifest[t.key];
  }
  const js = `/* 自動生成 — 由 scripts/generate-lifestyle-images.mjs 寫入 */\nwindow.ZP_LIFESTYLE = ${JSON.stringify(map, null, 2)};\n`;
  fs.writeFileSync(MAPPING_JS, js, "utf8");
  const jsonPath = path.join(TARGET_DIR, "images-manifest.json");
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log("🗺  mapping →", MAPPING_JS);
  console.log("🗂  manifest →", jsonPath);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  if (MANIFEST_ONLY) {
    let manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(path.join(TARGET_DIR, "images-manifest.json"), "utf8")); } catch (e) {}
    writeMapping(manifest);
    return;
  }

  if (DRY) {
    console.log(`📋 將生成 ${TASKS.length} 張圖（dall-e-3 · 1792x1024 · standard）`);
    console.log(`💰 估算成本：US$${(TASKS.length * 0.08).toFixed(2)}`);
    for (const t of TASKS) console.log(`\n• ${t.key} → ${t.filename}\n  ${t.prompt}`);
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('❌ 未設定 OPENAI_API_KEY。請先：export OPENAI_API_KEY="sk-..."（或加 --dry-run 預覽）');
    process.exit(1);
  }

  let manifest = {};
  for (const t of TASKS) {
    const dest = path.join(TARGET_DIR, t.filename);
    if (fs.existsSync(dest) && !args.has("--force")) {
      console.log(`⏭  ${t.key} 已存在，跳過（要覆蓋加 --force）`);
      manifest[t.key] = `/assets/images/generated/${t.filename}`;
      continue;
    }
    try {
      console.log(`⏳ 生成 ${t.key} …`);
      const r = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: t.prompt,
          n: 1,
          size: "1792x1024",
          quality: "standard",
          response_format: "url",
        }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error.message);
      const url = data.data?.[0]?.url;
      if (!url) throw new Error("沒有回傳圖片 URL");
      const bytes = await download(url, dest);
      manifest[t.key] = `/assets/images/generated/${t.filename}`;
      console.log(`✅ ${t.key} → ${dest} (${(bytes / 1024).toFixed(0)} KB)`);
    } catch (e) {
      console.error(`❌ ${t.key} 失敗：${e.message}`);
    }
  }
  writeMapping(manifest);
  console.log("\n🎉 完成。記住部署：git add frontend-v2/assets && git commit && git push");
}

main().catch((e) => { console.error(e); process.exit(1); });
