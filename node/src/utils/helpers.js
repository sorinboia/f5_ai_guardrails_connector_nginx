// Shared helper functions

import { DEFAULT_BLOCKING_RESPONSE } from '../config/constants.js';

/**
 * Generate a unique ID with a prefix.
 * @param {string} prefix
 * @returns {string}
 */
export function uniqueId(prefix) {
  const rand = Math.floor(Math.random() * 1e6).toString(36);
  return `${prefix}_${Date.now()}_${rand}`;
}

/**
 * Parse request body to object, handling various input types.
 * @param {object} request - Fastify request object
 * @returns {object}
 */
export function getBody(request) {
  if (!request.body) return {};
  if (typeof request.body === 'object') return request.body;
  try {
    return JSON.parse(request.body);
  } catch (err) {
    return {};
  }
}

/**
 * Sanitize a blocking response object with defaults.
 * @param {object} value
 * @returns {{ status: number, contentType: string, body: string }}
 */
export function sanitizeBlockingResponse(value) {
  const defaults = { ...DEFAULT_BLOCKING_RESPONSE };
  if (!value || typeof value !== 'object') return defaults;
  const sanitized = { ...defaults };
  if (Number.isInteger(value.status) && value.status >= 100 && value.status <= 999) sanitized.status = value.status;
  if (typeof value.contentType === 'string' && value.contentType.trim()) sanitized.contentType = value.contentType;
  if (typeof value.body === 'string') sanitized.body = value.body;
  return sanitized;
}

/**
 * Normalize an enum value against allowed values with optional aliases.
 * @param {string | null | undefined} value
 * @param {string[]} allowed
 * @param {string} fallback
 * @param {Record<string, string>} aliases
 * @returns {string}
 */
export function normalizeEnum(value, allowed, fallback, aliases = {}) {
  if (value === undefined || value === null) return fallback;
  const str = String(value).toLowerCase();
  if (aliases[str]) return aliases[str];
  if (allowed.includes(str)) return str;
  return fallback;
}
