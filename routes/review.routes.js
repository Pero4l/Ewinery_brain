'use strict';

const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/review.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { writeLimiter } = require('../middleware/rateLimiters');
const validators = require('../validators/review.validator');

router.get('/my', protect, validate(validators.productReviewsQuery, 'query'), reviewController.listMyReviews);
router.patch('/:id', protect, writeLimiter(), validate(validators.reviewIdParams, 'params'), validate(validators.updateReview), reviewController.updateReview);
router.delete('/:id', protect, writeLimiter(), validate(validators.reviewIdParams, 'params'), reviewController.deleteReview);

module.exports = router;