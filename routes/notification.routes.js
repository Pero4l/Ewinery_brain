'use strict';

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const validators = require('../validators/notification.validator');

router.get('/', protect, validate(validators.notificationQuery, 'query'), notificationController.listNotifications);
router.get('/counts', protect, notificationController.getCounts);
router.post('/tokens', protect, validate(validators.registerToken), notificationController.registerToken);
router.delete('/tokens', protect, validate(validators.deleteTokenQuery, 'query'), notificationController.removeToken);
router.patch('/:id/read', protect, validate(validators.notificationIdParams, 'params'), notificationController.markRead);
router.post('/read-all', protect, notificationController.markAllRead);

module.exports = router;