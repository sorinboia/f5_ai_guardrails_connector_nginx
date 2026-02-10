// Type checking utilities

/**
 * Check if a value is a plain object (not null, not array).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check if a value is a valid HTTP(S) URL string.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isHttpUrl(value) {
  return typeof value === 'string' && /^(https?:)\/\//i.test(value);
}

/**
 * Coerce a value to boolean or return undefined if not coercible.
 * @param {unknown} value
 * @returns {boolean | undefined}
 */
export function coerceBoolean(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lower)) return true;
    if (['false', '0', 'no', 'off'].includes(lower)) return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

/**
 * Coerce a value to integer or return undefined if not coercible.
 * @param {unknown} value
 * @returns {number | undefined}
 */
export function coerceInteger(value) {
  if (value === undefined || value === null) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return undefined;
  return num;
}
