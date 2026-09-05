/**
 * Cryptographic helpers for references, OTPs and opaque tokens.
 * All randomness comes from `crypto.randomBytes` / `randomInt`.
 */
const crypto = require('crypto');

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Uniformly random string over CROCKFORD_ALPHABET (no confusable chars). */
const randomCode = (length = 8) => {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CROCKFORD_ALPHABET[bytes[i] % CROCKFORD_ALPHABET.length];
  }
  return out;
};

/** URL-safe opaque token, e.g. for refresh tokens and email verification. */
const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

/** Numeric OTP of the requested length, unbiased. */
const numericOtp = (digits = 6) => {
  let out = '';
  for (let i = 0; i < digits; i += 1) out += crypto.randomInt(0, 10);
  return out;
};

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');

/** Constant-time string comparison; false on length mismatch. */
const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/** Order reference, e.g. EW-K4M2QP7X. */
const orderNumber = () => `EW-${randomCode(8)}`;

/** Support ticket reference, e.g. TCK-9F3XQ2. */
const ticketNumber = () => `TCK-${randomCode(6)}`;

/**
 * Paystack payment reference. Time prefix keeps references sortable and
 * effectively collision free even under heavy concurrency.
 */
const paymentReference = () => `EWP-${Date.now().toString(36).toUpperCase()}-${randomCode(6)}`;

module.exports = {
  randomCode,
  randomToken,
  numericOtp,
  sha256,
  safeEqual,
  orderNumber,
  ticketNumber,
  paymentReference
};
