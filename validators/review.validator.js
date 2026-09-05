'use strict';

const Joi = require('joi');
const { id } = require('./common');

const createReview = Joi.object({
  productId: id(),
  rating: Joi.number().integer().min(1).max(5).required(),
  title: Joi.string().trim().max(140).optional().allow(null, ''),
  comment: Joi.string().trim().max(5000).optional().allow(null, '')
});

const updateReview = Joi.object({
  rating: Joi.number().integer().min(1).max(5),
  title: Joi.string().trim().max(140).allow(null, ''),
  comment: Joi.string().trim().max(5000).allow(null, '')
}).min(1);

const reviewIdParams = Joi.object({
  id: id()
});

const productReviewsQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(20).default(3)
});

module.exports = { createReview, updateReview, reviewIdParams, productReviewsQuery };