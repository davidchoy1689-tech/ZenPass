/**
 * ZenPass 禪流 - 統一 API Response Helper
 * TypeScript 版本 — 完整型別安全
 */

import { Response } from 'express';

// ===== Type Definitions =====
interface SuccessBody<T = unknown> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

interface ErrorBody {
  success: false;
  error: string;
  details?: unknown;
}

type ApiResponse = SuccessBody | ErrorBody;

// ===== Response Helpers =====

/**
 * 200 OK — 成功回應
 */
function ok<T>(res: Response, data: T, meta?: Record<string, unknown>): void {
  const body: SuccessBody<T> = { success: true, data };
  if (meta !== undefined) body.meta = meta;
  res.status(200).json(body);
}

/**
 * 201 Created — 建立成功
 */
function created<T>(res: Response, data: T, meta?: Record<string, unknown>): void {
  const body: SuccessBody<T> = { success: true, data };
  if (meta !== undefined) body.meta = meta;
  res.status(201).json(body);
}

/**
 * 400 Bad Request
 */
function fail(res: Response, message = '請求失敗', details?: unknown): void {
  const body: ErrorBody = { success: false, error: message };
  if (details !== undefined) body.details = details;
  res.status(400).json(body);
}

/**
 * 401 Unauthorized
 */
function unauthorized(res: Response, message = '需要登入認證'): void {
  res.status(401).json({ success: false, error: message } satisfies ErrorBody);
}

/**
 * 403 Forbidden
 */
function forbidden(res: Response, message = '權限不足'): void {
  res.status(403).json({ success: false, error: message } satisfies ErrorBody);
}

/**
 * 404 Not Found
 */
function notFound(res: Response, message = '資源不存在'): void {
  res.status(404).json({ success: false, error: message } satisfies ErrorBody);
}

/**
 * 429 Rate Limited
 */
function rateLimited(res: Response, message = '太多請求，請稍後再試'): void {
  res.status(429).json({ success: false, error: message } satisfies ErrorBody);
}

/**
 * 500 Internal Server Error
 */
function serverError(res: Response, message = '伺服器內部錯誤'): void {
  res.status(500).json({ success: false, error: message } satisfies ErrorBody);
}

export { ok, created, fail, unauthorized, forbidden, notFound, rateLimited, serverError };
export type { SuccessBody, ErrorBody, ApiResponse };
