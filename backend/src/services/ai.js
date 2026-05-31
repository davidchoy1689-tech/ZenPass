/**
 * ZenPass 禪流 - AI 整合服務
 * 使用 OpenAI / Vercel AI SDK 提供智能功能
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * AI 課程推薦
 * 根據用戶偏好推薦最適合嘅課程
 */
async function recommendCourses(userProfile, availableCourses) {
  if (!OPENAI_API_KEY || OPENAI_API_KEY.startsWith("sk_test")) {
    return fallbackRecommendation(userProfile, availableCourses);
  }

  try {
    const OpenAI = require("openai");
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Fast + cheap
      messages: [
        {
          role: "system",
          content: `你係 ZenPass 運動推薦專家。根據用戶資料推薦 3 個最適合嘅課程。
          考慮用戶嘅運動習慣、偏好、budget。
          請用繁體中文回覆，只回覆課程名稱同原因。`,
        },
        {
          role: "user",
          content: `用戶偏好：${JSON.stringify(userProfile)}
          可用課程：${JSON.stringify(availableCourses)}`,
        },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    return {
      success: true,
      recommendation: completion.choices[0].message.content,
      source: "ai",
    };
  } catch (err) {
    console.error("AI recommendation error:", err.message);
    return fallbackRecommendation(userProfile, availableCourses);
  }
}

/**
 * Fallback — 當 AI 唔可用時用簡單規則
 */
function fallbackRecommendation(userProfile, availableCourses) {
  const { category, maxPrice } = userProfile;
  let filtered = availableCourses;

  if (category) {
    filtered = filtered.filter((c) =>
      c.category.toLowerCase().includes(category.toLowerCase()),
    );
  }
  if (maxPrice) {
    filtered = filtered.filter((c) => (c.price_hkd || 0) <= maxPrice);
  }

  // Pick 3 random from top matches
  const shuffled = [...filtered].sort(() => Math.random() - 0.5);
  const top3 = shuffled.slice(0, 3);

  return {
    success: true,
    recommendation: top3
      .map((c) => `🎯 ${c.title} — HK$${c.price_hkd} (${c.category})`)
      .join("\n"),
    source: "fallback",
  };
}

module.exports = { recommendCourses };
