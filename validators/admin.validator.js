'use strict';

const Joi = require('joi');
const { id } = require('./common');
const {
  ORDER_STATUS_VALUES,
  REVIEW_STATUS_VALUES,
  TICKET_STATUS_VALUES,
  TICKET_PRIORITY_VALUES
} = require('../config/constants');

const adminOrderStatusUpdate = Joi.object({
  status: Joi.string().valid(...ORDER_STATUS_VALUES).required(),
  note: Joi.string().trim().max(255).optional().allow(null, '')
});

const adminUserQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  search: Joi.string().trim().max(120).allow(null, ''),
  role: Joi.string().valid('USER', 'ADMIN'),
  isActive: Joi.boolean()
});

const adminOrderQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  status: Joi.string().valid(...ORDER_STATUS_VALUES).optional(),
  search: Joi.string().trim().max(120).optional()
});

const adminTransactionQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  status: Joi.string().optional()
});

const adminReviewQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  status: Joi.string().valid(...REVIEW_STATUS_VALUES).optional()
});

const adminReviewModeration = Joi.object({
  status: Joi.string().valid(...REVIEW_STATUS_VALUES).required(),
  moderationNote: Joi.string().trim().max(255).optional().allow(null, '')
});

const adminTicketQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100),
  status: Joi.string().valid(...TICKET_STATUS_VALUES).optional(),
  priority: Joi.string().valid(...TICKET_PRIORITY_VALUES).optional()
});

const adminIdParams = Joi.object({
  id: id()
});

const adminStockUpdate = Joi.object({
  quantity: Joi.number().integer().min(0),
  isAvailable: Joi.boolean(),
  status: Joi.string().valid('DRAFT', 'ACTIVE', 'ARCHIVED')
}).min(1);

const adminNote = Joi.object({
  message: Joi.string().trim().min(1).max(5000).required(),
  isInternalNote: Joi.boolean().default(false)
});

const adminTicketStatus = Joi.object({
  status: Joi.string().valid(...TICKET_STATUS_VALUES).required(),
  note: Joi.string().trim().max(500).optional().allow(null, '')
});

const adminAssign = Joi.object({
  agentId: Joi.string().guid({ version: ['uuidv4'] }).optional().allow(null)
});

const adminOrderStatusQuery = Joi.object({
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional()
});

module.exports = {
  adminOrderStatusUpdate,
  adminUserQuery,
  adminOrderQuery,
  adminTransactionQuery,
  adminReviewQuery,
  adminReviewModeration,
  adminTicketQuery,
  adminIdParams,
  adminOrderStatusQuery,
  adminStockUpdate,
  adminNote,
  adminTicketStatus,
  adminAssign
};