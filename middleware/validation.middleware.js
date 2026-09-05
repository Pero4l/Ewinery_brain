'use strict';

/**
 * Request validation middleware.
 *
 * Sanitizes the payload first (stripping control characters, Sequelize
 * operator keys and prototype-pollution keys) then validates against a Joi
 * schema. The validated, coerced value replaces `req[source]`.
 */
const Joi = require('joi');
const AppError = require('../utils/AppError');
const { deepClean } = require('../utils/sanitize');

/**
 * Replaces the request field with the validated value.
 *
 * Express 5 defines `req.query`/`req.params` as getter-only properties, so a
 * plain assignment silently throws. Redefining the own property works because
 * the prototype getter is configurable.
 */
const setRequestSource = (req, source, value) => {
  if (source === 'body') {
    req[source] = value;
    return;
  }
  Object.defineProperty(req, source, {
    value,
    writable: true,
    configurable: true,
    enumerable: true
  });
};

/**
 * @param {Joi.Schema} schema
 * @param {'body'|'query'|'params'} [source='body']
 */
const validate = (schema, source = 'body') => {
  const cleanSource = ['body', 'query', 'params'].includes(source) ? source : 'body';

  return (req, res, next) => {
    const raw = req[cleanSource];
    const sanitized = deepClean(raw);

    const { error, value } = schema.validate(sanitized === undefined ? {} : sanitized, {
      abortEarly: false,
      stripUnknown: true,
      convert: true
    });

    if (error) {
      const details = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message.replace(/['"]/g, '')
      }));
      return next(AppError.validation(details));
    }

    setRequestSource(req, cleanSource, value);
    return next();
  };
};

/** Joi schema for pagination query strings reused across list endpoints. */
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100)
});

module.exports = { validate, paginationSchema };