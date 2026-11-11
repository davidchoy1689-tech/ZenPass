/**
 * Phase 2.1-PROD — Stripe 金鑰工廠
 *
 * STRIPE_MODE=test|live 決定用邊一組 key；嚴禁把 key 硬編碼或寫入 git。
 * 兼容舊變數：STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET（視為 test 遺留）。
 */
let cached = { mode: null, client: null };

function mode() {
  const m = String(process.env.STRIPE_MODE || "test").toLowerCase();
  return m === "live" ? "live" : "test";
}

function secretKey() {
  return mode() === "live"
    ? process.env.STRIPE_LIVE_SK || ""
    : process.env.STRIPE_TEST_SK || process.env.STRIPE_SECRET_KEY || "";
}

function publishableKey() {
  return mode() === "live"
    ? process.env.STRIPE_LIVE_PK || ""
    : process.env.STRIPE_TEST_PK || process.env.STRIPE_PUBLISHABLE_KEY || "";
}

function webhookSecret() {
  return mode() === "live"
    ? process.env.STRIPE_LIVE_WEBHOOK_SECRET || ""
    : process.env.STRIPE_TEST_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || "";
}

function isConfigured() {
  const sk = secretKey();
  return !!sk && !/^(sk_tes…xxxx|sk_test_xxx|sk_live_xxx)$/.test(sk);
}

function client() {
  const m = mode();
  if (cached.client && cached.mode === m) return cached.client;
  if (!isConfigured()) return null;
  const Stripe = require("stripe");
  cached = { mode: m, client: new Stripe(secretKey()) };
  if (m === "live") console.warn("[STRIPE] WARNING: RUNNING IN LIVE REAL-MONEY MODE");
  else console.log("[STRIPE] mode=test (no real money)");
  return cached.client;
}

function publicConfig() {
  return {
    stripe_publishable_key: publishableKey(),
    is_production_mode: mode() === "live",
    mode: mode(),
    payments_ready: isConfigured(),
  };
}

module.exports = { mode, secretKey, publishableKey, webhookSecret, isConfigured, client, publicConfig };
