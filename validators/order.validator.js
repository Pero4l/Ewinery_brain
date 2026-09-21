'use strict';

const Joi = require('joi');
const { id, email } = require('./common');
const { couponCode } = require('./coupon.validator');

const createOrder = Joi.object({
  addressId: id().optional().allow(null, ''),
  customerNote: Joi.string().trim().max(2000).optional().allow(null, ''),
  couponCode: couponCode().optional().allow(null, ''),
  meta: Joi.object().max(10).optional()
});

const guestAddress = Joi.object({
  recipientName: Joi.string().trim().min(2).max(120).required(),
  street: Joi.string().trim().min(3).max(255).required(),
  city: Joi.string().trim().min(2).max(100).required(),
  state: Joi.string().trim().min(2).max(100).required(),
  postalCode: Joi.string().trim().max(20).optional().allow(null, ''),
  country: Joi.string().trim().max(100).default('Nigeria'),
  deliveryInstructions: Joi.string().trim().max(2000).optional().allow(null, '')
});

const createGuestOrder = Joi.object({
  items: Joi.array().items(Joi.object({
    productId: id(),
    quantity: Joi.number().integer().min(1).max(50).default(1)
  })).min(1).max(100).required(),
  email: email(),
  phone: Joi.string().trim().min(6).max(30).required(),
  address: guestAddress.required(),
  customerNote: Joi.string().trim().max(2000).optional().allow(null, '')
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

module.exports = { createOrder, createGuestOrder, orderIdParams, orderQuery, confirmReceiptParams };