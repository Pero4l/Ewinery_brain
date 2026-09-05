'use strict';

const Joi = require('joi');

const addCartItem = Joi.object({
  productId: Joi.string().guid({ version: ['uuidv4'] }).required(),
  quantity: Joi.number().integer().min(1).max(50).default(1)
});

const updateCartItem = Joi.object({
  quantity: Joi.number().integer().min(1).max(50).required()
});

const cartItemIdParams = Joi.object({
  id: Joi.string().guid({ version: ['uuidv4'] }).required()
});

module.exports = { addCartItem, updateCartItem, cartItemIdParams };