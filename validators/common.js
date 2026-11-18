'use strict';

/** Shared Joi fragments reused by validators. */
const Joi = require('joi');
const config = require('../config');

const id = () => Joi.string().guid({ version: ['uuidv4'] }).required();

const email = () => Joi.string().trim().lowercase().email().max(160)
  .required()
  .messages({
    'string.email': 'A valid email address is required',
    'any.required': 'Email is required'
  });

const password = () => Joi.string()
  .min(config.security.passwordMinLength || 6)
  .max(72)
  .pattern(/[A-Za-z]/)
  .pattern(/[0-9]/)
  .required()
  .messages({
    'string.min': `Password must be at least ${config.security.passwordMinLength || 6} characters`,
    'string.pattern.base': 'Password must contain a mix of letters and numbers',
    'any.required': 'Password is required'
  });

/**
 * Legal consent fields. Enforced strictly (400) by
 * middleware/consent.middleware.js; declared here so `stripUnknown` keeps them.
 */
const consent = () => ({
  acceptedTerms: Joi.boolean().strict().valid(true).required(),
  termsVersion: Joi.string().trim().min(1).max(32).required(),
  ageConfirmed: Joi.boolean().strict().valid(true).required()
});

/** 6-digit numeric verification / reset code. */
const otpCode = () => Joi.string().trim().pattern(/^\d{6}$/).required().messages({
  'string.pattern.base': 'Code must be a 6 digit number',
  'any.required': 'Code is required'
});

module.exports = { id, email, password, consent, otpCode };