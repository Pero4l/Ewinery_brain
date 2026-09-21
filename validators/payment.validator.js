'use strict';

const Joi = require('joi');
const { id, email } = require('./common');

const initializePayment = Joi.object({
  orderId: id(),
  callbackUrl: Joi.string().uri().optional().allow(null, '')
});

const initializeGuestPayment = Joi.object({
  orderId: id(),
  email: email(),
  callbackUrl: Joi.string().uri().optional().allow(null, '')
});

const verifyPaymentParams = Joi.object({
  reference: Joi.string().trim().min(5).max(80).required()
});

const verifyGuestPayment = Joi.object({
  reference: Joi.string().trim().min(5).max(80).required(),
  email: email()
});

const transactionQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  status: Joi.string().optional()
});

module.exports = { initializePayment, initializeGuestPayment, verifyPaymentParams, verifyGuestPayment, transactionQuery };