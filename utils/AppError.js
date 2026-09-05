/**
 * Operational error class.
 *
 * Anything thrown as an AppError is considered "expected" and its message is
 * safe to return to the client. Everything else is treated as an unexpected
 * failure and masked by the global error handler.
 */
class AppError extends Error {
  /**
   * @param {string} message  Client-safe message.
   * @param {number} statusCode  HTTP status code.
   * @param {object} [options]
   * @param {string} [options.code]  Machine readable error code.
   * @param {Array|object} [options.details]  Field level details (validation).
   */
  constructor(message, statusCode = 500, options = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = options.code || null;
    this.details = options.details || null;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad request', options) {
    return new AppError(message, 400, { code: 'BAD_REQUEST', ...options });
  }

  static validation(details, message = 'Validation failed') {
    return new AppError(message, 422, { code: 'VALIDATION_ERROR', details });
  }

  static unauthorized(message = 'Authentication required', options) {
    return new AppError(message, 401, { code: 'UNAUTHENTICATED', ...options });
  }

  static forbidden(message = 'You do not have permission to perform this action', options) {
    return new AppError(message, 403, { code: 'FORBIDDEN', ...options });
  }

  static notFound(message = 'Resource not found', options) {
    return new AppError(message, 404, { code: 'NOT_FOUND', ...options });
  }

  static conflict(message = 'Resource already exists', options) {
    return new AppError(message, 409, { code: 'CONFLICT', ...options });
  }

  static tooManyRequests(message = 'Too many requests, please try again later', options) {
    return new AppError(message, 429, { code: 'RATE_LIMITED', ...options });
  }

  static unprocessable(message = 'Request could not be processed', options) {
    return new AppError(message, 422, { code: 'UNPROCESSABLE', ...options });
  }

  static serviceUnavailable(message = 'Service temporarily unavailable', options) {
    return new AppError(message, 503, { code: 'SERVICE_UNAVAILABLE', ...options });
  }

  static internal(message = 'Internal server error', options) {
    return new AppError(message, 500, { code: 'INTERNAL_ERROR', ...options });
  }
}

module.exports = AppError;
