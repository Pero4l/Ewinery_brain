'use strict';

/** Public delivery pricing for the app (no auth). */
const express = require('express');
const router = express.Router();
const deliveryController = require('../controllers/delivery.controller');
const { validate } = require('../middleware/validation.middleware');
const validators = require('../validators/delivery.validator');

router.get('/settings', deliveryController.getPublicSettings);
router.post('/quote', validate(validators.quote), deliveryController.getQuote);

module.exports = router;
