'use strict';

/**
 * Authentication middleware.
 *
 * `protect` verifies the Bearer access token, reloads the user from the
 * database (so deactivation and `tokensValidFrom` are always current) and
 * attaches the client-safe user object to `req.user`.
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { User } = require('../models');
const { ROLES } = require('../config/constants');

const extractBearerToken = req => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
};

/**
 * Required: a valid access token belonging to an active user.
 * Attaches `req.user` (public shape) and `req.auth = { token, iat }`.
 */
const protect = async (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw AppError.unauthorized('Authentication required. Please log in.');
    }

    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret, {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw AppError.unauthorized('Session expired. Please log in again.', { code: 'TOKEN_EXPIRED' });
      }
      throw AppError.unauthorized('Invalid authentication token.');
    }

    const user = await User.findByPk(payload.sub);
    if (!user || !user.isActive) {
      throw AppError.unauthorized('Account not found or has been deactivated.');
    }

    // Reject any token that was issued before the user changed their password
    // or explicitly invalidated all sessions.
    const issuedAt = new Date(payload.iat * 1000);
    if (new Date(user.tokensValidFrom).getTime() > issuedAt.getTime()) {
      throw AppError.unauthorized('Session no longer valid. Please log in again.', { code: 'TOKEN_INVALIDATED' });
    }

    req.user = user;
    req.auth = { token, iat: payload.iat };
    return next();
  } catch (err) {
    return next(err);
  }
};

/** Requires an authenticated administrator. */
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return next(AppError.unauthorized('Authentication required. Please log in.'));
  }
  if (req.user.role !== ROLES.ADMIN) {
    logger.warn('Admin endpoint accessed by non-admin', { userId: req.user.id, path: req.originalUrl });
    return next(AppError.forbidden('Access denied. Administrator privileges required.'));
  }
  return next();
};

/** Requires role in the given list. */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(AppError.unauthorized('Authentication required. Please log in.'));
  if (!roles.includes(req.user.role)) {
    return next(AppError.forbidden('Access denied. Insufficient privileges.'));
  }
  return next();
};

module.exports = { protect, requireAdmin, requireRole };