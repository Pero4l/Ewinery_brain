'use strict';

const Joi = require('joi');
const { email, password } = require('./common');

const register = Joi.object({
  fullName: Joi.string().trim().min(2).max(120).required(),
  email: email(),
  phone: Joi.string().trim().min(7).max(30).required(),
  password: password()
});

const login = Joi.object({
  email: Joi.string().trim().lowercase().max(160),
  phone: Joi.string().trim().min(7).max(30),
  password: Joi.string().required()
}).xor('email', 'phone').messages({
  'object.missing': 'Email or phone number is required.',
  'object.xor': 'Provide either an email or a phone number, not both.'
});

const changePassword = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().required()
});

const refreshToken = Joi.object({
  refreshToken: Joi.string().required()
});

const resendVerification = Joi.object({
  email: email()
});

const verifyEmail = Joi.object({
  token: Joi.string().required()
});

const forgotPassword = Joi.object({
  email: email()
});

const resetPassword = Joi.object({
  email: email(),
  otp: Joi.string().pattern(/^\d{6}$/).required().messages({
    'string.pattern.base': 'OTP must be a 6 digit code'
  }),
  password: password(),
  confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({
    'any.only': 'Passwords do not match'
  })
});

module.exports = {
  register,
  login,
  changePassword,
  refreshToken,
  resendVerification,
  verifyEmail,
  forgotPassword,
  resetPassword
};