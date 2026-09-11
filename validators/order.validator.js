'use strict';

const Joi = require('joi');
const { id } = require('./common');
const { couponCode } = require('./coupon.validator');

const createOrder = Joi.object({
  addressId: id().optional().allow(null, ''),
  customerNote: Joi.string().trim().max(2000).optional().allow(null, ''),
  couponCode: couponCode().optional().allow(null, ''),
  meta: Joi.object().max(10).optional()
});

const orderIdParams = Joi.object({
  id: id()
});

const orderQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  status: Joi.string().optional(),
  paymentStatus: Joi.string().optional()
});

const confirmReceiptParams = Joi.object({
  id: id()
});

module.exports = { createOrder, orderIdParams, orderQuery, confirmReceiptParams };