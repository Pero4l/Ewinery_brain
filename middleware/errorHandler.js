'use strict';

/**
 * Global centralized error handler.
 *
 * AppError instances always carry a client-safe message. Everything else is
 * mapped to 500 and masked in production so raw SQL errors, stack traces and
 * internal state never leak.
 */
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || err.status || 500;
  if (statusCode < 400) statusCode = 500;

  let message = err.message || 'Internal Server Error';
  let code = err.code || null;
  let details = err.details || null;

  // --- Known error families ---------------------------------------------
  if (err instanceof AppError) {
    // Already client-safe.
  } else if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    statusCode = 400;
    message = err.errors && err.errors.length
      ? err.errors.map(e => e.message).join(', ')
      : 'Validation error';
  } else if (err.name === 'SequelizeForeignKeyConstraintError') {
    statusCode = 409;
    code = 'CONFLICT';
    message = 'This record is in use and cannot be modified or removed.';
  } else if (err.name === 'SequelizeDatabaseError' || err.name === 'SequelizeConnectionError') {
    statusCode = 500;
    message = 'Database operation failed.';
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid authentication token.';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Authentication token expired.';
  } else if (err.name === 'MulterError') {
    statusCode = 400;
    code = 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Uploaded file is too large.'
      : err.code === 'LIMIT_FILE_COUNT'
        ? 'Too many files uploaded.'
        : `Upload failed: ${err.message}`;
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Invalid JSON payload.';
  } else {
    // Unexpected — never expose internals.
    message = 'Internal Server Error';
    code = 'INTERNAL_ERROR';
  }

  // Unexpected errors should be loud in the logs (and never surfaced to clients).
  if (statusCode >= 500) {
    logger.error('Unhandled request error', { method: req.method, url: req.originalUrl, message: err.message });
  } else {
    logger.warn('Request error', { method: req.method, url: req.originalUrl, statusCode, message });
  }

  const body = { success: false, message };
  if (code) body.code = code;
  if (details) body.errors = details;
  if (configIsDevelopment()) body.stack = err.stack;

  return res.status(statusCode).json(body);
};

const configIsDevelopment = () => require('../config').isDevelopment;

module.exports = errorHandler;