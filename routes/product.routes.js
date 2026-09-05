'use strict';

const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');
const reviewController = require('../controllers/review.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { writeLimiter } = require('../middleware/rateLimiters');
const validators = require('../validators/product.validator');
const reviewValidators = require('../validators/review.validator');

// Storefront categories
router.get('/', validate(validators.productQuery, 'query'), productController.listProducts);
router.get('/categories', productController.listCategories);
router.get('/categories/:id', validate(validators.categoryIdParams, 'params'), productController.getCategory);

// Single product
router.get('/:id', validate(validators.productIdParams, 'params'), productController.getProduct);

// Product reviews (public list, authenticated create)
router.get('/:id/reviews', validate(validators.productIdParams, 'params'), validate(reviewValidators.productReviewsQuery, 'query'), reviewController.listProductReviews);
router.post(
  '/:id/reviews',
  protect,
  writeLimiter(),
  (req, res, next) => {
    req.body = { productId: req.params.id, ...req.body };
    next();
  },
  validate(reviewValidators.createReview),
  reviewController.createReview
);

module.exports = router;