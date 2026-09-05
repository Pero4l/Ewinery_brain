/**
 * Input sanitization helpers.
 *
 * Escaping happens at render time (email templates), not here; these helpers
 * only normalize whitespace, strip control characters and neutralize the
 * operator-object shapes that could reach Sequelize from a query string.
 */

/** Matches C0 and C1 control characters. */
const CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F]/g;

/** Strips control characters and trims surrounding whitespace. */
const cleanString = value => {
  if (typeof value !== 'string') return value;
  return value.replace(CONTROL_CHARS, '').trim();
};

/** Escapes HTML special characters for safe inclusion in email markup. */
const escapeHtml = value =>
  String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Escapes LIKE/ILIKE wildcards so user input cannot broaden a search. */
const escapeLike = value => String(cleanString(value) || '').replace(/[\\%_]/g, char => `\\${char}`);

/** Keys that must never be copied out of client-supplied objects. */
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Recursively cleans a request payload: strips control characters from
 * strings and drops keys that could be interpreted as Sequelize/Postgres
 * operators ($gt, $ne, ...) or that pollute the prototype chain.
 */
const deepClean = (input, depth = 0) => {
  if (depth > 10) return undefined;
  if (Array.isArray(input)) return input.map(item => deepClean(item, depth + 1));
  if (input === null || typeof input !== 'object') return cleanString(input);
  if (input instanceof Date) return input;

  return Object.entries(input).reduce((acc, [key, value]) => {
    if (DANGEROUS_KEYS.includes(key) || key.startsWith('$')) return acc;
    acc[key] = deepClean(value, depth + 1);
    return acc;
  }, Object.create(null));
};

module.exports = { cleanString, escapeHtml, escapeLike, deepClean };