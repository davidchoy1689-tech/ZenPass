/**
 * ZenPass 禪流 - 編號產生器
 * 為所有 entities 產生人類可讀、永不重複嘅參考編號
 * 格式：PREFIX-YYYYMMDD-XXXX (4位隨機)
 */

function genRef(prefix) {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return prefix + '-' + dateStr + '-' + suffix;
}

module.exports = {
  genRef,
  // 各 entity 專用 prefix
  PREFIXES: {
    user: 'US',
    class: 'CL',
    booking: 'ZP',
    transaction: 'TX',
    membership: 'MB',
    payout: 'PO',
    earning: 'ER',
    application: 'AP'
  }
};
