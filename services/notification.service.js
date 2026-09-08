'use strict';

/**
 * Centralized notification service.
 *
 * Every notification goes through `notify` / `fanOutToAdmins`, which dispatch
 * it across channels (currently IN_APP + EMAIL). The channel list is data
 * driven, so PUSH can be added later without touching callers.
 *
 * Rules:
 *  - A notification is always scoped to ONE recipient (fan-out creates a row
 *    per admin).
 *  - Email dispatch is fire-and-forget and can never break the main request.
 *  - IN_APP failures are logged, never thrown.
 */
const { sequelize, User, Notification } = require('../models');
const config = require('../config');
const logger = require('../utils/logger');
const { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, RESOURCE_TYPE, ROLES } = require('../config/constants');
const { sendAsync } = require('./email.service');

/** Maps a notification type to the email template type (see email.service). */
const EMAIL_TEMPLATE_BY_TYPE = {
  [NOTIFICATION_TYPE.WELCOME]: 'welcome',
  [NOTIFICATION_TYPE.EMAIL_VERIFICATION]: 'email_verification',
  [NOTIFICATION_TYPE.EMAIL_VERIFIED]: 'email_verified',
  [NOTIFICATION_TYPE.PASSWORD_RESET_REQUESTED]: 'password_reset',
  [NOTIFICATION_TYPE.PASSWORD_CHANGED]: 'password_changed',
  [NOTIFICATION_TYPE.LOGIN_ALERT]: 'login_alert',
  [NOTIFICATION_TYPE.ORDER_CREATED]: 'order_confirmation',
  [NOTIFICATION_TYPE.PAYMENT_SUCCESSFUL]: 'payment_success',
  [NOTIFICATION_TYPE.PAYMENT_FAILED]: 'payment_failed',
  [NOTIFICATION_TYPE.ORDER_STATUS_CHANGED]: 'order_status',
  [NOTIFICATION_TYPE.ORDER_OUT_FOR_DELIVERY]: 'order_status',
  [NOTIFICATION_TYPE.ORDER_DELIVERED]: 'order_delivered',
  [NOTIFICATION_TYPE.ORDER_COMPLETED]: 'order_completed',
  [NOTIFICATION_TYPE.ORDER_CANCELLED]: 'order_status',
  [NOTIFICATION_TYPE.SUPPORT_REPLY]: 'support_reply',
  [NOTIFICATION_TYPE.NEW_SUPPORT_TICKET]: 'support_ticket'
};

/** Types that only produce in-app rows (no email). */
const IN_APP_ONLY = new Set([
  NOTIFICATION_TYPE.NEW_USER_REGISTERED,
  NOTIFICATION_TYPE.NEW_ORDER,
  NOTIFICATION_TYPE.PRODUCT_CREATED,
  NOTIFICATION_TYPE.PRODUCT_LOW_STOCK,
  NOTIFICATION_TYPE.PRODUCT_OUT_OF_STOCK,
  NOTIFICATION_TYPE.NEW_REVIEW,
  NOTIFICATION_TYPE.NEW_SUPPORT_MESSAGE,
  NOTIFICATION_TYPE.SUPPORT_TICKET_STATUS_CHANGED
]);

/** Maps an internal notification type to the client-facing category. */
const CLIENT_TYPE_BY_INTERNAL = {
  [NOTIFICATION_TYPE.WELCOME]: 'system',
  [NOTIFICATION_TYPE.EMAIL_VERIFICATION]: 'system',
  [NOTIFICATION_TYPE.EMAIL_VERIFIED]: 'system',
  [NOTIFICATION_TYPE.PASSWORD_RESET_REQUESTED]: 'system',
  [NOTIFICATION_TYPE.PASSWORD_CHANGED]: 'system',
  [NOTIFICATION_TYPE.LOGIN_ALERT]: 'system',
  [NOTIFICATION_TYPE.NEW_USER_REGISTERED]: 'system',
  [NOTIFICATION_TYPE.ORDER_CREATED]: 'order',
  [NOTIFICATION_TYPE.ORDER_STATUS_CHANGED]: 'order',
  [NOTIFICATION_TYPE.ORDER_OUT_FOR_DELIVERY]: 'order',
  [NOTIFICATION_TYPE.ORDER_DELIVERED]: 'order',
  [NOTIFICATION_TYPE.ORDER_COMPLETED]: 'order',
  [NOTIFICATION_TYPE.ORDER_CANCELLED]: 'order',
  [NOTIFICATION_TYPE.NEW_ORDER]: 'order',
  [NOTIFICATION_TYPE.PAYMENT_SUCCESSFUL]: 'order',
  [NOTIFICATION_TYPE.PAYMENT_FAILED]: 'order',
  [NOTIFICATION_TYPE.PRODUCT_CREATED]: 'promo',
  [NOTIFICATION_TYPE.PRODUCT_LOW_STOCK]: 'system',
  [NOTIFICATION_TYPE.PRODUCT_OUT_OF_STOCK]: 'system',
  [NOTIFICATION_TYPE.NEW_REVIEW]: 'system',
  [NOTIFICATION_TYPE.NEW_SUPPORT_TICKET]: 'system',
  [NOTIFICATION_TYPE.NEW_SUPPORT_MESSAGE]: 'system',
  [NOTIFICATION_TYPE.SUPPORT_REPLY]: 'system',
  [NOTIFICATION_TYPE.SUPPORT_TICKET_STATUS_CHANGED]: 'system'
};

/**
 * Shapes a Notification row into the API contract consumed by the client:
 * `{ id, title, body, type, isRead, createdAt }`. `body` maps to the stored
 * `message` and `isRead` derives from `readAt`.
 */
const toAPIShape = n => ({
  id: n.id,
  title: n.title,
  body: n.message || null,
  type: CLIENT_TYPE_BY_INTERNAL[n.type] || 'system',
  isRead: Boolean(n.readAt),
  createdAt: n.createdAt
});

const activeAdmins = async () => User.scope('admins').findAll({
  attributes: ['id', 'email', 'fullName']
});

/**
 * Notifies a single recipient across channels.
 *
 * @param {string} userId
 * @param {object} payload
 * @param {string} payload.type  NOTIFICATION_TYPE.*
 * @param {string} payload.title
 * @param {string} payload.message
 * @param {Array<string>} [payload.channels]  ['IN_APP', 'EMAIL']. Default ['IN_APP'].
 * @param {string} [payload.resourceType]
 * @param {string} [payload.resourceId]
 * @param {object} [payload.data]  Structured payload for deep links.
 */
const notify = async (userId, {
  type,
  title,
  message,
  channels = [NOTIFICATION_CHANNEL.IN_APP],
  resourceType,
  resourceId,
  data = {},
  emailParams = {}
} = {}) => {
  if (!userId) return null;

  const channelSet = new Set(channels);
  const wantsEmail = channelSet.has(NOTIFICATION_CHANNEL.EMAIL) && !IN_APP_ONLY.has(type);

  // Load recipient for email dispatch.
  let recipient = null;
  if (wantsEmail) {
    recipient = await User.findByPk(userId, { attributes: ['id', 'email', 'fullName'] });
  }

  if (channelSet.has(NOTIFICATION_CHANNEL.IN_APP)) {
    try {
      const row = await Notification.create({
        userId,
        type,
        channel: NOTIFICATION_CHANNEL.IN_APP,
        title,
        message,
        resourceType: resourceType || null,
        resourceId: resourceId || null,
        data: data || null
      });
      return row;
    } catch (err) {
      logger.error('Failed to persist notification', { userId, type, message: err.message });
    }
  }

  if (wantsEmail && recipient?.email) {
    sendAsync({
      to: recipient.email,
      type: EMAIL_TEMPLATE_BY_TYPE[type] || 'generic',
      params: {
        name: recipient.fullName,
        orderNumber: data.orderNumber,
        amount: data.amount,
        status: data.status,
        ticketNumber: data.ticketNumber,
        // Carry template-relevant data (e.g. { code } for OTP emails).
        ...data,
        ...emailParams
      }
    });
  }

  return null;
};

/**
 * Creates one notification per active administrator. Used for admin-relevant
 * events (new user, new order, new ticket, payments, ...).
 */
const fanOutToAdmins = async ({ type, title, message, resourceType, resourceId, data = {} }) => {
  try {
    const admins = await activeAdmins();
    const created = [];
    for (const admin of admins) {
      try {
        const row = await Notification.create({
          userId: admin.id,
          type,
          channel: NOTIFICATION_CHANNEL.IN_APP,
          title,
          message,
          resourceType: resourceType || null,
          resourceId: resourceId || null,
          data: data || null
        });
        created.push(row);
      } catch (err) {
        logger.error('Admin fan-out failed', { adminId: admin.id, type, message: err.message });
      }
    }
    return created;
  } catch (err) {
    logger.error('Admin fan-out aborted', { type, message: err.message });
    return [];
  }
};

/** Fetches a paginated set of the recipient's notifications. */
const listForUser = async ({ userId, page = 1, limit = 20, unreadOnly = false }) => {
  const where = { userId };
  if (unreadOnly) where.readAt = null;

  const result = await Notification.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit
  });
  return { rows: result.rows.map(toAPIShape), count: result.count };
};

const AppError = require('../utils/AppError');

/** Marks a single notification read; throws if it belongs to another user. */
const markRead = async ({ notificationId, userId }) => {
  const notification = await Notification.findOne({ where: { id: notificationId, userId } });
  if (!notification) throw AppError.notFound('Notification not found.');
  if (!notification.readAt) {
    notification.readAt = new Date();
    await notification.save({ fields: ['readAt'] });
  }
  return toAPIShape(notification);
};

/** Marks every notification for the user as read. */
const markAllRead = async userId => {
  const [count] = await Notification.update(
    { readAt: new Date() },
    { where: { userId, readAt: null } }
  );
  return count;
};

/** Unread/read counts so the badge can be rendered without a list query. */
const getCounts = async userId => {
  const [unread, total] = await Promise.all([
    Notification.count({ where: { userId, readAt: null } }),
    Notification.count({ where: { userId } })
  ]);
  return { unread, total };
};

module.exports = {
  notify,
  fanOutToAdmins,
  listForUser,
  markRead,
  markAllRead,
  getCounts,
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  RESOURCE_TYPE
};