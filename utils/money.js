/**
 * Money helpers.
 *
 * All arithmetic is done in integer minor units (kobo) to avoid binary
 * floating point drift, then converted back to a 2-dp major unit value.
 */

/** Rounds a major-unit amount to 2 decimal places. */
const round = amount => Math.round((Number(amount) + Number.EPSILON) * 100) / 100;

/** Major unit (naira) -> minor unit (kobo) integer, as required by Paystack. */
const toMinor = amount => Math.round(Number(amount) * 100);

/** Minor unit (kobo) -> major unit (naira). */
const toMajor = minor => round(Number(minor) / 100);

/** Sums major-unit amounts without floating point error. */
const sum = (...amounts) => toMajor(amounts.flat().reduce((acc, a) => acc + toMinor(a || 0), 0));

/** unitPrice * quantity, exact. */
const multiply = (amount, quantity) => toMajor(toMinor(amount) * Number(quantity));

/** Compares two major-unit amounts for equality at kobo precision. */
const equals = (a, b) => toMinor(a) === toMinor(b);

/** Formats for display in emails/notifications, e.g. ₦12,500.00 */
const format = (amount, currency = 'NGN') => {
  const symbols = { NGN: '₦', USD: '$', GBP: '£', EUR: '€' };
  const symbol = symbols[currency] || `${currency} `;
  const value = round(amount).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${symbol}${value}`;
};

module.exports = { round, toMinor, toMajor, sum, multiply, equals, format };
