'use strict';

const Joi = require('joi');
const { id } = require('./common');
const { TICKET_STATUS_VALUES, TICKET_PRIORITY_VALUES } = require('../config/constants');

const createTicket = Joi.object({
  subject: Joi.string().trim().min(3).max(180).required(),
  message: Joi.string().trim().min(1).max(5000).required(),
  priority: Joi.string().valid(...TICKET_PRIORITY_VALUES).optional(),
  orderId: Joi.string().guid({ version: ['uuidv4'] }).optional().allow(null)
});

const ticketIdParams = Joi.object({
  id: id()
});

const ticketQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  status: Joi.string().valid(...TICKET_STATUS_VALUES).optional()
});

const addTicketMessage = Joi.object({
  message: Joi.string().trim().min(1).max(5000).required()
});

const adminAddNote = Joi.object({
  message: Joi.string().trim().min(1).max(5000).required(),
  isInternalNote: Joi.boolean().default(false)
});

const updateTicketStatus = Joi.object({
  status: Joi.string().valid(...TICKET_STATUS_VALUES).required(),
  note: Joi.string().trim().max(500).optional().allow(null, '')
});

const assignTicket = Joi.object({
  agentId: Joi.string().guid({ version: ['uuidv4'] }).optional().allow(null)
});

module.exports = {
  createTicket,
  ticketIdParams,
  ticketQuery,
  addTicketMessage,
  adminAddNote,
  updateTicketStatus,
  assignTicket
};