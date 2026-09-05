'use strict';

const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { writeLimiter } = require('../middleware/rateLimiters');
const validators = require('../validators/payment.validator');

router.post('/initialize', protect, writeLimiter(), validate(validators.initializePayment), paymentController.initializePayment);
router.get('/verify/:reference', protect, validate(validators.verifyPaymentParams, 'params'), paymentController.verifyPayment);
// Raw body route (mounted with express.raw in app.js before JSON parsing).
router.post('/webhook', paymentController.handleWebhook);
router.get('/transactions', protect, validate(validators.transactionQuery, 'query'), paymentController.listMyTransactions);

module.exports = router;