'use strict';

const express = require('express');
const router = express.Router();
const supportController = require('../controllers/support.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { writeLimiter } = require('../middleware/rateLimiters');
const validators = require('../validators/support.validator');

router.post('/tickets', protect, writeLimiter(), validate(validators.createTicket), supportController.createTicket);
router.get('/tickets', protect, validate(validators.ticketQuery, 'query'), supportController.listMyTickets);
router.get('/tickets/:id', protect, validate(validators.ticketIdParams, 'params'), supportController.getTicket);
router.post('/tickets/:id/messages', protect, writeLimiter(), validate(validators.ticketIdParams, 'params'), validate(validators.addTicketMessage), supportController.addMessage);

module.exports = router;