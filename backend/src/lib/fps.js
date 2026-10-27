/**
 * FPS 收款識別碼清洗（2026-10-28）
 * 香港家長常見輸入：+852 9123 4567 / 9123-4567 / (912) 34567 / 91234567 / email
 * 管理員要將呢個值直接貼入銀行 App，所以必須標準化：
 *  - 純數字（含 +852 前綴）→ 去掉 +852／852 前綴、空格、括號、橫線，保留數字
 *  - Email → trim + 轉細楷
 *  - 其他（例如 FPS ID 帶英文字母）→ 只保留英數
 */
function normalizeFpsId(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  if (s.includes("@")) return s.toLowerCase().replace(/\s+/g, "");

  let digits = s.replace(/[^\d]/g, "");
  // +852 / 852 前綴：只有在剩餘剛好 8 位（香港手機）時才剔除
  if (digits.length === 11 && digits.startsWith("852")) digits = digits.slice(3);
  if (digits.length === 8) return digits;
  // 非標準：保留英數（可為 FPS ID / 商戶編號）
  return s.replace(/[\s\-()]/g, "").replace(/^\+/, "");
}

/** 顯示用：8 位香港手機 → 9123 4567（其餘原樣） */
function formatFpsId(id) {
  const s = normalizeFpsId(id);
  return /^\d{8}$/.test(s) ? s.slice(0, 4) + " " + s.slice(4) : s;
}

module.exports = { normalizeFpsId, formatFpsId };
