'use strict';

const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cart.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { writeLimiter } = require('../middleware/rateLimiters');
const validators = require('../validators/cart.validator');

router.get('/', protect, cartController.getCart);
router.post('/items', protect, writeLimiter(), validate(validators.addCartItem), cartController.addItem);
router.patch('/items/:id', protect, writeLimiter(), validate(validators.cartItemIdParams, 'params'), validate(validators.updateCartItem), cartController.updateItem);
router.delete('/items/:id', protect, validate(validators.cartItemIdParams, 'params'), cartController.removeItem);
router.delete('/', protect, cartController.clearCart);

module.exports = router;