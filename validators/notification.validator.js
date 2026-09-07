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

module.exports = { notificationQuery, notificationIdParams };