'use strict';

const express = require('express');
const router = express.Router();
const couponController = require('../controllers/coupon.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const couponValidators = require('../validators/coupon.validator');

router.get('/', protect, validate(couponValidators.userCouponQuery, 'query'), couponController.listMyCoupons);

module.exports = router;