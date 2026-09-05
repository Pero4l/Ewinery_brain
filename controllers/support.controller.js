'use strict';

/** Support ticket controllers (user side). */
const supportService = require('../services/support.service');
const { ok, created } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const pagination = require('../utils/pagination');

const createTicket = asyncHandler(async (req, res) => {
  const ticket = await supportService.createTicket({ userId: req.user.id, ...req.body });
  return created(res, 'Support ticket created.', { ticket });
});

const listMyTickets = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await supportService.listUserTickets({
    userId: req.user.id,
    page: paging.page,
    limit: paging.limit,
    status: req.query.status
  });
  return ok(res, 'Tickets retrieved.', pagination.format(result, paging, 'tickets'));
});

const getTicket = asyncHandler(async (req, res) => {
  const ticket = await supportService.getTicketForUser({ userId: req.user.id, ticketId: req.params.id });
  return ok(res, 'Ticket retrieved.', { ticket });
});

const addMessage = asyncHandler(async (req, res) => {
  const message = await supportService.addUserMessage({
    userId: req.user.id,
    ticketId: req.params.id,
    message: req.body.message
  });
  return created(res, 'Message sent.', { message });
});

module.exports = { createTicket, listMyTickets, getTicket, addMessage };