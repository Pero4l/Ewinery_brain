'use strict';

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { validate } = require('../middleware/validation.middleware');
const { protect } = require('../middleware/auth.middleware');
const { authLimiter, passwordResetLimiter } = require('../middleware/rateLimiters');
const validators = require('../validators/auth.validator');

router.post('/register', authLimiter(), validate(validators.register), authController.register);
router.post('/login', authLimiter(), validate(validators.login), authController.login);
router.post('/refresh', authLimiter(), validate(validators.refreshToken), authController.refreshToken);
router.post('/logout', protect, validate(validators.refreshToken), authController.logout);
router.post('/logout-all', protect, authController.logoutAll);
router.post('/change-password', protect, validate(validators.changePassword), authController.changePassword);
router.post('/verify-email', authLimiter(), validate(validators.verifyEmail), authController.verifyEmail);
router.post('/resend-verification', authLimiter(), validate(validators.resendVerification), authController.resendVerification);
router.post('/forgot-password', passwordResetLimiter(), validate(validators.forgotPassword), authController.forgotPassword);
router.post('/reset-password', passwordResetLimiter(), validate(validators.resetPassword), authController.resetPassword);

module.exports = router;