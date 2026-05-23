/**
 * ZenPass 禪流 - 輕量輸入驗證中間件
 * 無需第三方 library，簡單夠用
 */

/**
 * 驗證規則組合
 * @param {Object} schema - { field: [rules...] }
 * @returns {Function} express middleware
 */
function validate(schema) {
  return (req, res, next) => {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      for (const rule of rules) {
        if (rule.required && (value === undefined || value === null || value === '')) {
          errors.push({ field, message: rule.message || `${field} 為必填` });
          break;
        }

        if (value === undefined || value === null || value === '') continue;

        if (rule.type === 'string' && typeof value !== 'string') {
          errors.push({ field, message: rule.message || `${field} 必須為文字` });
          break;
        }

        if (rule.type === 'number') {
          const num = Number(value);
          if (isNaN(num)) {
            errors.push({ field, message: rule.message || `${field} 必須為數字` });
            break;
          }
        }

        if (rule.minLength && typeof value === 'string' && value.length < rule.minLength) {
          errors.push({ field, message: rule.message || `${field} 最少 ${rule.minLength} 個字元` });
          break;
        }

        if (rule.maxLength && typeof value === 'string' && value.length > rule.maxLength) {
          errors.push({ field, message: rule.message || `${field} 最多 ${rule.maxLength} 個字元` });
          break;
        }

        if (rule.min !== undefined && Number(value) < rule.min) {
          errors.push({ field, message: rule.message || `${field} 最少為 ${rule.min}` });
          break;
        }

        if (rule.max !== undefined && Number(value) > rule.max) {
          errors.push({ field, message: rule.message || `${field} 最多為 ${rule.max}` });
          break;
        }

        if (rule.oneOf && !rule.oneOf.includes(value)) {
          errors.push({ field, message: rule.message || `${field} 必須為 ${rule.oneOf.join('/')} 其中之一` });
          break;
        }

        if (rule.pattern && !rule.pattern.test(value)) {
          errors.push({ field, message: rule.message || `${field} 格式不正確` });
          break;
        }

        if (rule.custom && !rule.custom(value)) {
          errors.push({ field, message: rule.message || `${field} 驗證失敗` });
          break;
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: '輸入驗證失敗',
        details: errors,
      });
    }

    next();
  };
}

/**
 * 常用 schema
 */
const schemas = {
  booking: {
    schedule_id: [
      { required: true, type: 'string', message: '時段 ID 為必填' },
    ],
    class_id: [
      { required: true, type: 'string', message: '課程 ID 為必填' },
    ],
    payment_type: [
      { required: true, oneOf: ['single', 'credits', 'membership_trial', 'free'], message: '付款方式無效' },
    ],
    amount: [
      { type: 'number', min: 0, max: 99999, message: '金額無效' },
    ],
  },

  payment_confirm: {
    booking_id: [
      { required: true, type: 'string', message: '預約編號為必填' },
    ],
    payment_method: [
      { required: true, oneOf: ['stripe', 'fps', 'payme'], message: '付款方式無效' },
    ],
    payment_reference: [
      { required: true, type: 'string', minLength: 1, maxLength: 255, message: '付款參考編號為必填' },
    ],
    amount: [
      { type: 'number', min: 0, max: 99999 },
    ],
  },

  fps_payment: {
    amount: [
      { required: true, type: 'number', min: 1 },
    ],
    booking_id: [
      { required: false, type: 'string' },
    ],
    fps_reference: [
      { required: true, type: 'string', minLength: 1, maxLength: 255, message: '請提供轉數快參考編號' },
    ],
  },

  auth_login: {
    email: [
      { required: true, type: 'string', maxLength: 255 },
    ],
    password: [
      { required: true, type: 'string', minLength: 1, maxLength: 128 },
    ],
  },

  class_create: {
    title: [
      { required: true, type: 'string', minLength: 1, maxLength: 100, message: '課程名稱為必填，最多 100 字' },
    ],
    category: [
      { required: true, type: 'string', maxLength: 50 },
    ],
    duration: [
      { required: true, type: 'number', min: 5, max: 480, message: '時長必須為 5-480 分鐘' },
    ],
    price_hkd: [
      { required: true, type: 'number', min: 0, max: 99999 },
    ],
  },
};

module.exports = { validate, schemas };
