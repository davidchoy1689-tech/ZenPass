/**
 * ZenPass 禪流 - API 回應格式統一中介軟體
 *
 * 攔截所有 res.json()，確保回應包含 success 字段。
 * 保持向後相容（保留原有 data key），不影響現有前端。
 */

function responseNormalizer(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    // Skip non-object responses (strings, buffers, etc.)
    if (
      body === null ||
      body === undefined ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return originalJson(body);
    }

    // Already has success field — leave as-is
    if (body.hasOwnProperty("success")) {
      // But ensure the field is boolean
      if (typeof body.success !== "boolean") {
        body.success = body.success ? true : false;
      }
      return originalJson(body);
    }

    // Has error key → wrap as failure
    if (body.error) {
      const normalized = {
        success: false,
        error: body.error,
      };
      // Preserve any extra fields (like detail)
      for (const key of Object.keys(body)) {
        if (key !== "error") {
          normalized[key] = body[key];
        }
      }
      return originalJson(normalized);
    }

    // It's a successful response without success field — add it
    body.success = true;
    return originalJson(body);
  };

  next();
}

module.exports = responseNormalizer;
