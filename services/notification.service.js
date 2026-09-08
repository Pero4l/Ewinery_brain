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
const { Op } = require('sequelize');
const { sequelize, User, Notification, DeviceToken } = require('../models');
const config = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
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
      // Best-effort Expo push (fire-and-forget, never blocks the request).
      sendPush({ userId, title, body: message, type, resourceId });
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

// --------------------------------------------------------------------------
// Expo push notifications
// --------------------------------------------------------------------------

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Maps an internal notification type to the push consent/preference key and
 * Android channel. Transactional updates honour `orderUpdates`; promotional
 * campaigns honour `promotions`.
 */
const PUSH_POLICY = {
  [NOTIFICATION_TYPE.WELCOME]: { permission: 'orderUpdates', channelId: 'orders' },
  [NOTIFICATION_TYPE.ORDER_CREATED]: { permission: 'orderUpdates', channelId: 'orders' },
  [NOTIFICATION_TYPE.ORDER_STATUS_CHANGED]: { permission: 'orderUpdates', channelId: 'orders' },
  [NOTIFICATION_TYPE.ORDER_OUT_FOR_DELIVERY]: { permission: 'orderUpdates', channelId: 'orders' },
  [NOTIFICATION_TYPE.ORDER_DELIVERED]: { permission: 'orderUpdates', channelId: 'orders' },
  [NOTIFICATION_TYPE.ORDER_COMPLETED]: { permission: 'orderUpdates', channelId: 'orders' },
  [NOTIFICATION_TYPE.ORDER_CANCELLED]: { permission: 'orderUpdates', channelId: 'orders' },
  [NOTIFICATION_TYPE.PAYMENT_SUCCESSFUL]: { permission: 'orderUpdates', channelId: 'orders' },
  [NOTIFICATION_TYPE.PAYMENT_FAILED]: { permission: 'orderUpdates', channelId: 'orders' },
  [NOTIFICATION_TYPE.PRODUCT_CREATED]: { permission: 'promotions', channelId: 'promos' }
};

/**
 * Sends an Expo push to every registered device for a user who consents.
 * Fire-and-forget: never awaited by callers, failures only logged. On a
 * DeviceNotRegistered response the stale token is deleted.
 */
const sendPush = async ({ userId, title, body, type, resourceId }) => {
  if (!userId) return;
  try {
    const policy = PUSH_POLICY[type];
    if (!policy) return;

    const tokens = await DeviceToken.findAll({ where: { userId } });
    if (!tokens.length) return;

    const messages = tokens
      .filter(t => t.preferences?.[policy.permission])
      .map(t => ({
        to: t.token,
        title: title || 'eWinery',
        body: body || title || '',
        data: { type, orderId: resourceId || null },
        channelId: policy.channelId,
        sound: 'default'
      }));
    if (!messages.length) return;

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages)
    });
    if (!response.ok) {
      logger.warn('Expo push API returned non-OK', { userId, type, status: response.status });
      return;
    }

    const payload = await response.json().catch(() => null);
    const receipts = Array.isArray(payload?.data) ? payload.data : [];
    const dead = [];
    receipts.forEach((receipt, index) => {
      if (receipt?.error === 'DeviceNotRegistered' && messages[index]?.to) {
        dead.push(messages[index].to);
      }
    });
    if (dead.length) {
      await DeviceToken.destroy({
        where: { userId, token: { [Op.in]: dead } }
      });
      logger.debug('Removed stale Expo device tokens', { userId, count: dead.length });
    }
  } catch (err) {
    logger.warn('Expo push send failed', { userId, type, message: err.message });
  }
};

/**
 * Registers (upserts) an Expo push token for a user. Preferences update on
 * re-registration so the latest consent switches win.
 */
const upsertDeviceToken = async ({ userId, token, platform, preferences = {} }) => {
  if (!token) throw AppError.badRequest('Push token is required.');

  const prefs = {
    orderUpdates: preferences.orderUpdates !== undefined ? Boolean(preferences.orderUpdates) : true,
    promotions: preferences.promotions !== undefined ? Boolean(preferences.promotions) : true
  };
  const platformValue = ['ios', 'android'].includes(platform) ? platform : 'ios';

  const [record, created] = await DeviceToken.findOrCreate({
    where: { userId, token },
    defaults: { platform: platformValue, preferences: prefs }
  });
  if (!created) {
    await record.update({ platform: platformValue, preferences: prefs });
  }
  return { id: record.id, platform: record.platform, preferences: record.preferences };
};

/** Removes a device token (called on sign-out). */
const removeDeviceToken = async ({ userId, token }) => {
  if (!token) return;
  await DeviceToken.destroy({ where: { userId, token } });
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
  upsertDeviceToken,
  removeDeviceToken,
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  RESOURCE_TYPE
};