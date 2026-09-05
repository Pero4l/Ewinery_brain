'use strict';

const Joi = require('joi');
const { id } = require('./common');
const { PRODUCT_STATUS_VALUES } = require('../config/constants');

const productIdParams = Joi.object({
  id: id()
});

const baseProductFields = {
  name: Joi.string().trim().min(2).max(180),
  description: Joi.string().trim().max(10000).allow(null, ''),
  price: Joi.number().precision(2).min(0),
  compareAtPrice: Joi.number().precision(2).min(0).allow(null),
  categoryId: Joi.string().guid({ version: ['uuidv4'] }),
  sku: Joi.string().trim().max(60).allow(null, ''),
  stockQuantity: Joi.number().integer().min(0),
  isAvailable: Joi.boolean(),
  status: Joi.string().valid(...PRODUCT_STATUS_VALUES),
  volumeMl: Joi.number().integer().positive().allow(null),
  alcoholPercentage: Joi.number().precision(2).min(0).max(100).allow(null),
  brand: Joi.string().trim().max(120).allow(null, ''),
  country: Joi.string().trim().max(100).allow(null, '')
};

const createProduct = Joi.object(baseProductFields).fork(
  ['name', 'price', 'categoryId'],
  schema => schema.required()
);

const updateProduct = Joi.object(baseProductFields).min(1);

const productQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  search: Joi.string().trim().max(120).allow(null, ''),
  category: Joi.string().trim().max(120).allow(null, ''),
  minPrice: Joi.number().precision(2).min(0),
  maxPrice: Joi.number().precision(2).min(0),
  brand: Joi.string().trim().max(120).allow(null, ''),
  inStock: Joi.boolean(),
  sort: Joi.string().valid(
    'newest', 'oldest', 'price_asc', 'price_desc', 'rating', 'popular', 'name'
  ).default('newest')
});

const adminProductQuery = productQuery.keys({
  status: Joi.string().valid(...PRODUCT_STATUS_VALUES),
  includeHidden: Joi.boolean()
});

const categoryIdParams = Joi.object({
  id: id()
});

const createCategory = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().max(2000).allow(null, ''),
  isActive: Joi.boolean().default(true),
  sortOrder: Joi.number().integer().min(0).default(0)
});

const updateCategory = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  description: Joi.string().trim().max(2000).allow(null, ''),
  isActive: Joi.boolean(),
  sortOrder: Joi.number().integer().min(0)
}).min(1);

const categoryQuery = Joi.object({
  includeInactive: Joi.boolean().default(false)
});

module.exports = {
  productIdParams,
  createProduct,
  updateProduct,
  productQuery,
  adminProductQuery,
  categoryIdParams,
  createCategory,
  updateCategory,
  categoryQuery
};