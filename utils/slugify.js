/**
 * Slug helpers for categories and products.
 */
const { randomCode } = require('./tokens');

/** Converts a title into a URL-safe slug. */
const slugify = value =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'item';

/**
 * Generates a slug that does not collide with an existing row.
 *
 * @param {string} value  Source text.
 * @param {(slug: string) => Promise<boolean>} exists  Returns true if taken.
 * @returns {Promise<string>}
 */
const uniqueSlug = async (value, exists) => {
  const base = slugify(value);
  if (!(await exists(base))) return base;

  // Try short numeric suffixes first for readability, then fall back to random.
  for (let i = 2; i <= 5; i += 1) {
    const candidate = `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }

  let candidate;
  do {
    candidate = `${base}-${randomCode(5).toLowerCase()}`;
  } while (await exists(candidate));

  return candidate;
};

module.exports = { slugify, uniqueSlug };
