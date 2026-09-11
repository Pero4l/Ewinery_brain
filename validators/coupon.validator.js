'use strict';

const Joi = require('joi');
const { id } = require('./common');

/** Shared coupon-code fragment: normalized uppercase, alphanumeric. */
const couponCode = () => Joi.string().trim().uppercase().alphanum().min(2).max(30);

/** Guards that expiresAt is strictly after startsAt when both are provided. */
const expiryAfterStart = (value, helpers) => {
  if (value.expiresAt && value.startsAt && new Date(value.expiresAt) <= new Date(value.startsAt)) {
    return helpers.error('any.invalid', { message: 'Expiry time must be after the start time.' });
  }
  return value;
};

const createCoupon = Joi.object({
  code: couponCode().required(),
  name: Joi.string().trim().min(2).max(120).required(),
  description: Joi.string().trim().max(2000).optional().allow(null, ''),
  amount: Joi.number().positive().max(1000000).required(),
  startsAt: Joi.date().iso().required(),
  expiresAt: Joi.date().iso().greater(Joi.ref('startsAt')).required()
});

const updateCoupon = Joi.object({
  code: couponCode(),
  name: Joi.string().trim().min(2).max(120),
  description: Joi.string().trim().max(2000).optional().allow(null, ''),
  amount: Joi.number().positive().max(1000000),
  startsAt: Joi.date().iso(),
  expiresAt: Joi.date().iso(),
  isActive: Joi.boolean()
})
  .min(1)
  .custom(expiryAfterStart, 'expiry after start');

const assignCouponUsers = Joi.object({
  userIds: Joi.array().items(id()).min(1).max(100).required()
});

const revokeCouponUsers = Joi.object({
  userIds: Joi.array().items(id()).min(1).max(100).required()
});

const couponListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  isActive: Joi.boolean().optional()
});

const couponSearchQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  search: Joi.string().trim().max(120).optional().allow(null, ''),
  isActive: Joi.boolean().optional()
});

const couponIdParams = Joi.object({
  id: id()
});

const couponAssignmentQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  status: Joi.string().valid('REDEEMED', 'UNREDEEMED').optional()
});

const userCouponQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  status: Joi.string().valid('ACTIVE', 'REDEEMED', 'UPCOMING', 'EXPIRED').optional()
});

module.exports = {
  couponCode,
  createCoupon,
  updateCoupon,
  assignCouponUsers,
  revokeCouponUsers,
  couponListQuery,
  couponSearchQuery,
  couponIdParams,
  couponAssignmentQuery,
  userCouponQuery
};