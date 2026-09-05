'use strict';

const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { writeLimiter } = require('../middleware/rateLimiters');
const validators = require('../validators/order.validator');

router.post('/', protect, writeLimiter(), validate(validators.createOrder), orderController.createOrder);
router.get('/', protect, validate(validators.orderQuery, 'query'), orderController.listMyOrders);
router.get('/:id', protect, validate(validators.orderIdParams, 'params'), orderController.getOrder);
router.post('/:id/confirm-receipt', protect, writeLimiter(), validate(validators.confirmReceiptParams, 'params'), orderController.confirmReceipt);
router.post('/:id/cancel', protect, writeLimiter(), validate(validators.orderIdParams, 'params'), orderController.cancelOrder);

module.exports = router;