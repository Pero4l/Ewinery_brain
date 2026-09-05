'use strict';

const Joi = require('joi');
const { id } = require('./common');

const initializePayment = Joi.object({
  orderId: id()
});

const verifyPaymentParams = Joi.object({
  reference: Joi.string().trim().min(5).max(80).required()
});

const transactionQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  status: Joi.string().optional()
});

module.exports = { initializePayment, verifyPaymentParams, transactionQuery };