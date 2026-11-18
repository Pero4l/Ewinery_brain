'use strict';

/**
 * Legal consent gate for sign-up and guest checkout.
 *
 * Runs BEFORE the Joi validator so a missing/false consent is always reported
 * as `400 VALIDATION_ERROR` (the generic validator answers 422), regardless of
 * any other field errors in the payload.
 *
 * Strict checks: `acceptedTerms` and `ageConfirmed` must be the JSON boolean
 * `true` (not "true", 1, ...); `termsVersion` must be a non-empty string.
 */
const AppError = require('../utils/AppError');
const { TERMS_VERSION_MAX } = require('../utils/consent');

const requireLegalConsent = (req, res, next) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const details = [];

  if (body.acceptedTerms !== true) {
    details.push({ field: 'acceptedTerms', message: 'You must accept the Terms and Conditions.' });
  }
  if (body.ageConfirmed !== true) {
    details.push({ field: 'ageConfirmed', message: 'You must confirm you are of legal drinking age.' });
  }
  const version = typeof body.termsVersion === 'string' ? body.termsVersion.trim() : '';
  if (!version) {
    details.push({ field: 'termsVersion', message: 'termsVersion is required.' });
  } else if (version.length > TERMS_VERSION_MAX) {
    details.push({ field: 'termsVersion', message: `termsVersion must be at most ${TERMS_VERSION_MAX} characters.` });
  }

  if (details.length) {
    return next(new AppError('Validation failed', 400, { code: 'VALIDATION_ERROR', details }));
  }
  return next();
};

module.exports = { requireLegalConsent };
