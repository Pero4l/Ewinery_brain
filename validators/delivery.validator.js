'use strict';

const Joi = require('joi');
const { id } = require('./common');

/** Whole naira, 0 … 1,000,000. */
const naira = () => Joi.number().integer().min(0).max(1000000);
const text = max => Joi.string().trim().max(max);

const updateSettings = Joi.object({
  isDeliveryEnabled: Joi.boolean(),
  defaultFee: naira(),
  freeDeliveryThreshold: naira().allow(null),
  estimatedDeliveryText: text(120).allow(null, '')
}).min(1);

const zoneFields = {
  name: text(100).min(2),
  state: text(100).min(2),
  cities: Joi.array().items(text(100).min(1)).max(200),
  fee: naira(),
  freeDeliveryThreshold: naira().allow(null),
  estimatedDeliveryText: text(120).allow(null, ''),
  isActive: Joi.boolean(),
  sortOrder: Joi.number().integer().min(0).max(10000)
};

const createZone = Joi.object({
  ...zoneFields,
  name: zoneFields.name.required(),
  state: zoneFields.state.required(),
  fee: zoneFields.fee.required(),
  cities: zoneFields.cities.default([])
});

const updateZone = Joi.object(zoneFields).min(1);

const zoneIdParams = Joi.object({ id: id() });

const quote = Joi.object({
  subtotal: Joi.number().min(0).max(100000000).required(),
  state: text(100).allow(null, ''),
  city: text(100).allow(null, '')
});

module.exports = { updateSettings, createZone, updateZone, zoneIdParams, quote };
