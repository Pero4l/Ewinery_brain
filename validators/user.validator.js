'use strict';

const Joi = require('joi');

const updateProfile = Joi.object({
  fullName: Joi.string().trim().min(2).max(120).optional(),
  phone: Joi.string().trim().min(7).max(30).optional()
}).min(1);

const changePassword = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().required()
});

const addressIdParams = Joi.object({
  id: Joi.string().guid({ version: ['uuidv4'] }).required()
});

const createAddress = Joi.object({
  recipientName: Joi.string().trim().min(2).max(120).required(),
  phone: Joi.string().trim().min(7).max(30).required(),
  street: Joi.string().trim().min(3).max(255).required(),
  city: Joi.string().trim().min(2).max(100).required(),
  state: Joi.string().trim().min(2).max(100).required(),
  postalCode: Joi.string().trim().max(20).optional().allow(null, ''),
  country: Joi.string().trim().max(100).default('Nigeria'),
  label: Joi.string().trim().max(50).optional().allow(null, ''),
  deliveryInstructions: Joi.string().trim().max(2000).optional().allow(null, ''),
  isDefault: Joi.boolean().default(false)
});

const updateAddress = createAddress.keys({
  recipientName: Joi.string().trim().min(2).max(120).optional(),
  phone: Joi.string().trim().min(7).max(30).optional(),
  street: Joi.string().trim().min(3).max(255).optional(),
  city: Joi.string().trim().min(2).max(100).optional(),
  state: Joi.string().trim().min(2).max(100).optional(),
  country: Joi.string().trim().max(100).optional(),
  isDefault: Joi.boolean().optional()
}).min(1);

const setDefaultAddress = Joi.object({});

module.exports = {
  updateProfile,
  changePassword,
  addressIdParams,
  createAddress,
  updateAddress,
  setDefaultAddress
};