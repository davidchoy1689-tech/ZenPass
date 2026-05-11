/**
 * ZenPass 禪流 - 統一 API Response Helper
 * 所有 API 回傳統一格式
 */

function ok(res, data = null, meta = null, status = 200) {
  const body = { success: true };
  if (data !== null) body.data = data;
  if (meta !== null) body.meta = meta;
  return res.status(status).json(body);
}

function created(res, data = null, meta = null) {
  return ok(res, data, meta, 201);
}

function fail(res, message = "請求失敗", status = 400, details = null) {
  const body = { success: false, error: message };
  if (details !== null) body.details = details;
  return res.status(status).json(body);
}

function notFound(res, message = "資源不存在") {
  return fail(res, message, 404);
}

function unauthorized(res, message = "需要登入認證") {
  return fail(res, message, 401);
}

function forbidden(res, message = "權限不足") {
  return fail(res, message, 403);
}

function serverError(res, message = "伺服器內部錯誤") {
  return fail(res, message, 500);
}

module.exports = { ok, created, fail, notFound, unauthorized, forbidden, serverError };
