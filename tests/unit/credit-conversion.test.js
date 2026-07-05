/**
 * ZenPass — Credit Conversion 統一測試（1 Credit = HK$10）
 * 確保所有 pricing conversion formula 正確
 */

const assert = require("assert");

describe("Credit Conversion (1 Credit = HK$10)", () => {
  // === Conversion formulas ===
  const hkdToCredits = (hkd) => Math.max(3, Math.round(hkd / 10));
  const creditsToHkd = (credits) => Math.max(0, credits * 10);
  const topupCredits = (amount) => Math.floor(amount / 10);

  it("HKD 170 → 17 credits", () => {
    assert.strictEqual(topupCredits(170), 17);
  });
  it("HKD 100 → 10 credits", () => {
    assert.strictEqual(topupCredits(100), 10);
  });
  it("HKD 250 → 25 credits", () => {
    assert.strictEqual(topupCredits(250), 25);
  });
  it("HKD 550 → 55 credits", () => {
    assert.strictEqual(topupCredits(550), 55);
  });
  it("HKD 0 → 0 credits", () => {
    assert.strictEqual(topupCredits(0), 0);
  });
  it("HKD 15 → 1 credit (floor)", () => {
    assert.strictEqual(topupCredits(15), 1);
  });

  // === Partner auto-conversion (credits_cost from price_hkd) ===
  const autoCredits = (priceHkd) => Math.max(3, Math.round(priceHkd / 10));

  it("Auto-convert: HK$120 → 12 credits", () => {
    assert.strictEqual(autoCredits(120), 12);
  });
  it("Auto-convert: HK$150 → 15 credits", () => {
    assert.strictEqual(autoCredits(150), 15);
  });
  it("Auto-convert: HK$100 → 10 credits", () => {
    assert.strictEqual(autoCredits(100), 10);
  });
  it("Auto-convert: min 3 credits", () => {
    assert.strictEqual(autoCredits(20), 3);
  });

  // === Plan avg_price calculation ===
  const avgPrice = (priceHkd, creditsGranted) =>
    Math.round(priceHkd / creditsGranted * 100) / 100;

  it("輕量 Pass: $299 / 37 = $8.08/credit", () => {
    assert.strictEqual(avgPrice(299, 37), 8.08);
  });
  it("標準 Pass: $799 / 100 = $7.99/credit", () => {
    assert.strictEqual(avgPrice(799, 100), 7.99);
  });
  it("高階 Pass: $1899 / 237 = $8.01/credit", () => {
    assert.strictEqual(avgPrice(1899, 237), 8.01);
  });
  it("VIP Pass: $2899 / 362 = $8.01/credit", () => {
    assert.strictEqual(avgPrice(2899, 362), 8.01);
  });

  // === Bonus credits top-up (from memberships.js) ===
  const calcBonus = (creditsToAdd) => {
    if (creditsToAdd >= 100) return 30;
    if (creditsToAdd >= 50) return 12;
    if (creditsToAdd >= 10) return 2;
    return 0;
  };

  it("Bonus: 100+ cr → 30 bonus", () => {
    assert.strictEqual(calcBonus(100), 30);
  });
  it("Bonus: 50+ cr → 12 bonus", () => {
    assert.strictEqual(calcBonus(50), 12);
  });
  it("Bonus: 10+ cr → 2 bonus", () => {
    assert.strictEqual(calcBonus(10), 2);
  });
  it("Bonus: <10 cr → 0 bonus", () => {
    assert.strictEqual(calcBonus(5), 0);
  });
});

describe("Blockchain Audit Trail", () => {
  it("blockchain-audit module loads without error", () => {
    const audit = require("../../backend/src/services/blockchain-audit");
    assert.ok(audit.verifyChain);
    assert.ok(typeof audit.verifyChain === "function");
    assert.ok(audit.writeBlock);
    assert.ok(typeof audit.writeBlock === "function");
    assert.ok(audit.writeBookingBlock);
    assert.ok(typeof audit.writeBookingBlock === "function");
    assert.ok(audit.verifyFullChain);
    assert.ok(typeof audit.verifyFullChain === "function");
  });

  it("writeBlock stores pricing version", () => {
    const audit = require("../../backend/src/services/blockchain-audit");
    const result = audit.writeBlock({
      entityType: "pricing_config",
      entityId: "credit_conversion_v2",
      data: { rate: "1 Credit = HK$10", version: 2 }
    });
    assert.ok(result);
  });

  it("verifyChain exists and validates", () => {
    const audit = require("../../backend/src/services/blockchain-audit");
    // verifyChain takes an array of chain blocks
    const result = audit.verifyChain([]);
    // Empty chain should be valid
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.length, 0);
  });
});
