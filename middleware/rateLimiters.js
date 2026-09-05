'use strict';

/**
 * Centralized rate limiters using express-rate-limit.
 *
 * Every limiter returns the standard JSON error envelope so the client always
 * receives a consistent response shape.
 */
const rateLimit = require('express-rate-limit');
const config = require('../config');

const standardHandler = (req, res, next) => {
  res.status(429).json({
    success: false,
    message: 'Too many requests, please try again later.'
  });
};

const createLimiter = options => rateLimit({
  windowMs: options.windowMs,
  limit: options.limit,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
  ...options.extra
});

/** General API limiter applied to everything. */
const globalLimiter = () => {
  const windowMs = config.rateLimit.globalWindowMinutes * 60 * 1000;
  return createLimiter({ windowMs, limit: config.rateLimit.globalMax });
};

/** Stricter limiter for authentication routes (login, register). */
const authLimiter = () => {
  const windowMs = config.rateLimit.globalWindowMinutes * 60 * 1000;
  return createLimiter({ windowMs, limit: config.rateLimit.authMax });
};

/** Very strict limiter for password reset routes — prevents OTP brute force. */
const passwordResetLimiter = () => {
  const windowMs = config.rateLimit.globalWindowMinutes * 60 * 1000;
  return createLimiter({ windowMs, limit: config.rateLimit.passwordResetMax });
};

/** Limiter for write-heavy routes (creating orders, tickets, messages). */
const writeLimiter = () => {
  const windowMs = config.rateLimit.globalWindowMinutes * 60 * 1000;
  return createLimiter({ windowMs, limit: config.rateLimit.writeMax });
};

/** Plain-NON-API limiter so controllers/services can opt out when disabled. */
const isRateLimitEnabled = () => config.rateLimit.enabled;

module.exports = {
  globalLimiter,
  authLimiter,
  passwordResetLimiter,
  writeLimiter,
  isRateLimitEnabled
};