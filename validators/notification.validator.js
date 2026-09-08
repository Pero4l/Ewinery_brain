'use strict';

const Joi = require('joi');
const { id } = require('./common');

const notificationQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50),
  unreadOnly: Joi.boolean().default(false)
});

const notificationIdParams = Joi.object({
  id: id()
});

const registerToken = Joi.object({
  token: Joi.string().trim().min(10).max(400).required(),
  platform: Joi.string().valid('ios', 'android').default('ios'),
  preferences: Joi.object({
    orderUpdates: Joi.boolean().default(true),
    promotions: Joi.boolean().default(true)
  }).default({ orderUpdates: true, promotions: true })
});

const deleteTokenQuery = Joi.object({
  token: Joi.string().trim().min(10).max(400).required()
});

module.exports = { notificationQuery, notificationIdParams, registerToken, deleteTokenQuery };