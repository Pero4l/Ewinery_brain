'use strict';

/** Legal consent helpers shared by the consent middleware and services. */
const TERMS_VERSION_MAX = 32;

/**
 * Builds the persisted consent record. Timestamps always come from the server
 * clock — any client-sent timestamp is ignored.
 */
const buildConsentRecord = ({ termsVersion, ipAddress, userAgent }) => {
  const now = new Date();
  return {
    termsAcceptedAt: now,
    termsVersion: String(termsVersion).trim().slice(0, TERMS_VERSION_MAX),
    ageConfirmedAt: now,
    consentIpAddress: ipAddress ? String(ipAddress).slice(0, 64) : null,
    consentUserAgent: userAgent ? String(userAgent).slice(0, 255) : null
  };
};

module.exports = { buildConsentRecord, TERMS_VERSION_MAX };
