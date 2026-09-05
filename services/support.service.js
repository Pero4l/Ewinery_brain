'use strict';

/**
 * Support ticket service.
 *
 * Tickets are visible to the owning user and to every admin. Unread counters
 * are maintained per side (user/admin) so list views need no extra queries.
 * When a user messages a closed ticket it is reopened; admins never see
 * internal notes leaking to customers.
 */
const { sequelize, SupportTicket, SupportMessage, User, Order } = require('../models');
const AppError = require('../utils/AppError');
const { ticketNumber } = require('../utils/tokens');
const { notify, fanOutToAdmins, NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, RESOURCE_TYPE } = require('./notification.service');
const { TICKET_STATUS, ROLES } = require('../config/constants');

const nextTicketNumber = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = ticketNumber();
    const exists = await SupportTicket.findOne({ where: { ticketNumber: candidate } });
    if (!exists) return candidate;
  }
  throw AppError.internal('Could not allocate a unique ticket number.');
};

const MESSAGE_INCLUDES = [{ model: User, as: 'sender', attributes: ['id', 'fullName', 'email', 'role'] }];

const loadMessageCount = async (ticketId, transaction) =>
  SupportMessage.count({ where: { ticketId }, transaction });

// --------------------------------------------------------------------------
// User side
// --------------------------------------------------------------------------

const createTicket = async ({ userId, subject, message, priority, orderId }) => {
  const result = await sequelize.transaction(async transaction => {
    if (orderId) {
      const owned = await Order.findOne({ where: { id: orderId, userId }, attributes: ['id'], transaction });
      if (!owned) throw AppError.notFound('Linked order not found.');
    }

    const ticket = await SupportTicket.create({
      ticketNumber: await nextTicketNumber(),
      userId,
      subject,
      priority: priority || 'MEDIUM',
      orderId: orderId || null,
      status: TICKET_STATUS.OPEN,
      lastMessageAt: new Date(),
      unreadForUser: 0,
      unreadForAdmin: 1
    }, { transaction });

    await SupportMessage.create({
      ticketId: ticket.id,
      senderId: userId,
      senderRole: ROLES.USER,
      message
    }, { transaction });

    return ticket;
  });

  await Promise.all([
    notify(userId, {
      type: NOTIFICATION_TYPE.NEW_SUPPORT_TICKET,
      title: 'Support ticket created',
      message: `Your ticket ${result.ticketNumber} has been created. Our team will respond shortly.`,
      channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
      resourceType: RESOURCE_TYPE.SUPPORT_TICKET,
      resourceId: result.id,
      data: { ticketNumber: result.ticketNumber }
    }),
    fanOutToAdmins({
      type: NOTIFICATION_TYPE.NEW_SUPPORT_TICKET,
      title: 'New support ticket',
      message: `Ticket ${result.ticketNumber}: ${result.subject}`,
      resourceType: RESOURCE_TYPE.SUPPORT_TICKET,
      resourceId: result.id,
      data: { ticketNumber: result.ticketNumber, subject: result.subject }
    })
  ]);

  return SupportTicket.findByPk(result.id);
};

const listUserTickets = async ({ userId, page, limit, status }) => {
  const where = { userId };
  if (status) where.status = status;

  const result = await SupportTicket.findAndCountAll({
    where,
    order: [['lastMessageAt', 'DESC']],
    offset: (page - 1) * limit,
    limit
  });
  return result;
};

const getTicketForUser = async ({ userId, ticketId }) => {
  const ticket = await SupportTicket.findOne({
    where: { id: ticketId, userId },
    include: [{
      model: SupportMessage,
      as: 'messages',
      where: { isInternalNote: false },
      required: false,
      include: MESSAGE_INCLUDES,
      order: [['createdAt', 'ASC']]
    }]
  });
  if (!ticket) throw AppError.notFound('Ticket not found.');

  // Clear the user's unread counter after reading.
  if (ticket.unreadForUser > 0) {
    await SupportTicket.update({ unreadForUser: 0 }, { where: { id: ticket.id } });
    ticket.unreadForUser = 0;
  }
  return ticket;
};

const addUserMessage = async ({ userId, ticketId, message }) => {
  const ticket = await SupportTicket.findOne({ where: { id: ticketId, userId } });
  if (!ticket) throw AppError.notFound('Ticket not found.');

  return sequelize.transaction(async transaction => {
    const nextStatus = ticket.status === TICKET_STATUS.CLOSED ? TICKET_STATUS.OPEN : ticket.status;
    await ticket.update({
      status: nextStatus,
      closedAt: nextStatus === TICKET_STATUS.OPEN ? null : ticket.closedAt,
      lastMessageAt: new Date(),
      unreadForAdmin: ticket.unreadForAdmin + 1
    }, { transaction });

    return SupportMessage.create({
      ticketId,
      senderId: userId,
      senderRole: ROLES.USER,
      message,
      isInternalNote: false
    }, { transaction });
  });
};

// --------------------------------------------------------------------------
// Admin side
// --------------------------------------------------------------------------

const listTicketsAdmin = async ({ page, limit, status, priority }) => {
  const where = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;

  const result = await SupportTicket.findAndCountAll({
    where,
    order: [['lastMessageAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
    include: [
      { model: User, as: 'user', attributes: ['id', 'fullName', 'email', 'phone'] },
      { model: User, as: 'agent', attributes: ['id', 'fullName', 'email'] }
    ]
  });
  return result;
};

const getTicketForAdmin = async ticketId => {
  const ticket = await SupportTicket.findByPk(ticketId, {
    include: [
      { model: User, as: 'user', attributes: ['id', 'fullName', 'email', 'phone'] },
      { model: User, as: 'agent', attributes: ['id', 'fullName', 'email'] },
      { model: Order, as: 'order', attributes: ['id', 'orderNumber', 'status', 'totalAmount'] },
      { model: SupportMessage, as: 'messages', include: MESSAGE_INCLUDES, order: [['createdAt', 'ASC']] }
    ]
  });
  if (!ticket) throw AppError.notFound('Ticket not found.');

  if (ticket.unreadForAdmin > 0) {
    await SupportTicket.update({ unreadForAdmin: 0 }, { where: { id: ticket.id } });
    ticket.unreadForAdmin = 0;
  }
  return ticket;
};

const adminReply = async ({ ticketId, admin, message, isInternalNote = false }) => {
  const ticket = await SupportTicket.findByPk(ticketId);
  if (!ticket) throw AppError.notFound('Ticket not found.');

  const result = await sequelize.transaction(async transaction => {
    const patch = {
      lastMessageAt: new Date(),
      unreadForUser: ticket.unreadForUser + 1,
      assignedTo: ticket.assignedTo || admin.id,
      assignedAt: ticket.assignedAt || new Date()
    };
    // An internal note only bumps the admin counter (it is invisible to the user).
    if (isInternalNote) {
      patch.unreadForAdmin = 0;
      patch.unreadForUser = ticket.unreadForUser;
    }
    await ticket.update(patch, { transaction });

    return SupportMessage.create({
      ticketId,
      senderId: admin.id,
      senderRole: ROLES.ADMIN,
      message,
      isInternalNote
    }, { transaction });
  });

  if (!isInternalNote) {
    await notify(ticket.userId, {
      type: NOTIFICATION_TYPE.SUPPORT_REPLY,
      title: 'New reply on your ticket',
      message: `A support agent replied to ticket ${ticket.ticketNumber}.`,
      channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
      resourceType: RESOURCE_TYPE.SUPPORT_TICKET,
      resourceId: ticket.id,
      data: { ticketNumber: ticket.ticketNumber }
    });
  }

  return result;
};

const updateTicketStatus = async ({ ticketId, status, note, adminId }) => {
  const ticket = await SupportTicket.findByPk(ticketId);
  if (!ticket) throw AppError.notFound('Ticket not found.');

  await ticket.update({
    status,
    resolvedAt: status === TICKET_STATUS.RESOLVED ? new Date() : ticket.resolvedAt,
    closedAt: status === TICKET_STATUS.CLOSED ? new Date() : (status === TICKET_STATUS.OPEN ? null : ticket.closedAt)
  });

  await notify(ticket.userId, {
    type: NOTIFICATION_TYPE.SUPPORT_TICKET_STATUS_CHANGED,
    title: 'Ticket status updated',
    message: `Your ticket ${ticket.ticketNumber} is now ${status.replace(/_/g, ' ').toLowerCase()}.`,
    channels: [NOTIFICATION_CHANNEL.IN_APP],
    resourceType: RESOURCE_TYPE.SUPPORT_TICKET,
    resourceId: ticket.id,
    data: { ticketNumber: ticket.ticketNumber, status }
  });

  if (note) {
    await SupportMessage.create({
      ticketId,
      senderId: adminId,
      senderRole: ROLES.ADMIN,
      message: `Status changed to ${status}. ${note}`.trim(),
      isInternalNote: true
    });
  }

  return SupportTicket.findByPk(ticket.id);
};

const assignTicket = async ({ ticketId, agentId }) => {
  const ticket = await SupportTicket.findByPk(ticketId);
  if (!ticket) throw AppError.notFound('Ticket not found.');

  const patch = {
    assignedTo: agentId || null,
    assignedAt: agentId ? new Date() : null
  };
  await ticket.update(patch);
  return SupportTicket.findByPk(ticket.id);
};

module.exports = {
  createTicket,
  listUserTickets,
  getTicketForUser,
  addUserMessage,
  listTicketsAdmin,
  getTicketForAdmin,
  adminReply,
  updateTicketStatus,
  assignTicket
};