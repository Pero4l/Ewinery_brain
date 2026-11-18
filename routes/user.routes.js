'use strict';

const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { requireLegalConsent } = require('../middleware/consent.middleware');
const validators = require('../validators/user.validator');

router.get('/me', protect, userController.getProfile);
router.patch('/me', protect, validate(validators.updateProfile), userController.updateProfile);
router.post('/me/terms', protect, requireLegalConsent, validate(validators.acceptTerms), userController.acceptTerms);
router.get('/me/notification-preferences', protect, userController.getNotificationPreferences);
router.patch('/me/notification-preferences', protect, validate(validators.notificationPreferences), userController.updateNotificationPreferences);
router.post('/change-password', protect, validate(validators.changePassword), userController.changePassword);

router.get('/addresses', protect, userController.listAddresses);
router.post('/addresses', protect, validate(validators.createAddress), userController.createAddress);
router.put('/addresses/:id/default', protect, validate(validators.addressIdParams, 'params'), userController.setDefaultAddress);
router.patch('/addresses/:id', protect, validate(validators.addressIdParams, 'params'), validate(validators.updateAddress), userController.updateAddress);
router.delete('/addresses/:id', protect, validate(validators.addressIdParams, 'params'), userController.deleteAddress);

module.exports = router;