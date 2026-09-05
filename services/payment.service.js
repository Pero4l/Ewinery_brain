'use strict';

/**
 * Paystack payment service.
 *
 * Security model:
 *  - The order is NEVER marked paid on the word of the frontend. Success is
 *    only applied after the Paystack API verification or a signed webhook.
 *  - Webhooks are verified with an HMAC-SHA512 signature over the raw body.
 *  - A unique transaction reference is the idempotency key, and the success
 *    application runs inside a row-locked transaction, so duplicate webhooks
 *    or a concurrent verify call cannot credit the same order twice.
 */
const crypto = require('crypto');
const { sequelize, Transaction, Order, OrderStatusHistory } = require('../models');
const config = require('../config');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { toMinor, toMajor, equals: moneyEquals } = require('../utils/money');
const { safeEqual } = require('../utils/tokens');
const { notify, fanOutToAdmins, NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, RESOURCE_TYPE } = require('./notification.service');
const { TRANSACTION_STATUS, PAYMENT_STATUS, ORDER_STATUS } = require('../config/constants');

/** Paystack REST client. */
const paystackRequest = async (method, path, body) => {
  if (!config.paystack.secretKey) {
    throw AppError.serviceUnavailable('Payments are not configured. Please set PAYSTACK_SECRET_KEY.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.paystack.timeoutMs);

  try {
    const response = await fetch(`${config.paystack.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.paystack.secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status === false) {
      throw AppError.badRequest(data.message || 'Payment provider rejected the request.');
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw AppError.serviceUnavailable('Payment provider timed out. Please try again.');
    }
    if (err.isOperational) throw err;
    logger.error('Paystack request error', { message: err.message });
    throw AppError.serviceUnavailable('Payment provider is temporarily unavailable.');
  } finally {
    clearTimeout(timer);
  }
};

// --------------------------------------------------------------------------
// Initialize
// --------------------------------------------------------------------------

/** Starts Paystack checkout for an order's pending transaction. */
const initializePayment = async ({ order, user, callbackUrl }) => {
  if (order.paymentStatus === PAYMENT_STATUS.PAID) {
    throw AppError.conflict('This order has already been paid.');
  }

  const tx = await Transaction.findOne({
    where: { orderId: order.id, status: TRANSACTION_STATUS.PENDING },
    order: [['createdAt', 'DESC']]
  });
  if (!tx) {
    throw AppError.badRequest('No pending payment was found for this order. Please create the order first.');
  }

  // Reuse a previously generated authorization URL (idempotent initialize).
  if (tx.authorizationUrl) {
    return {
      reference: tx.reference,
      authorizationUrl: tx.authorizationUrl,
      accessCode: tx.accessCode
    };
  }

  const data = await paystackRequest('POST', '/transaction/initialize', {
    email: user.email,
    amount: toMinor(tx.amount),
    reference: tx.reference,
    currency: tx.currency || 'NGN',
    callback_url: callbackUrl || config.paystack.callbackUrl,
    metadata: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: user.id,
      custom_fields: [
        { display_name: 'Ewinery order', variable_name: 'order_number', value: order.orderNumber }
      ]
    }
  });

  await tx.update({
    authorizationUrl: data.data?.authorization_url || null,
    accessCode: data.data?.access_code || null,
    providerResponse: data
  });

  return {
    reference: tx.reference,
    authorizationUrl: data.data?.authorization_url,
    accessCode: data.data?.access_code
  };
};

// --------------------------------------------------------------------------
// Verify (client-side call after redirect)
// --------------------------------------------------------------------------

const verifyPayment = async ({ reference, userId }) => {
  const tx = await Transaction.findOne({ where: { reference } });
  if (!tx) throw AppError.notFound('Transaction not found.');

  const order = await Order.findByPk(tx.orderId);
  if (!order || order.userId !== userId) {
    throw AppError.notFound('Transaction not found.');
  }

  // Idempotent: already successful.
  if (tx.isSuccessful() && tx.isProcessed()) {
    return { status: TRANSACTION_STATUS.SUCCESS, alreadyProcessed: true, order, transaction: tx };
  }

  const data = await paystackRequest('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  const payload = data.data || {};
  const providerStatus = String(payload.status || '').toLowerCase();

  const baseUpdates = {
    providerTransactionId: payload.id ? String(payload.id) : tx.providerTransactionId,
    channel: payload.channel || payload.authorization?.channel || null,
    providerResponse: data
  };

  if (providerStatus === 'success') {
    await applySuccessfulPayment(tx.id, { event: data, verifiedVia: 'VERIFY' });
    return { status: TRANSACTION_STATUS.SUCCESS, order, transaction: await Transaction.findByPk(tx.id) };
  }

  // Failed / abandoned -> update both transaction and order.
  await tx.update({
    ...baseUpdates,
    status: providerStatus === 'abandoned' ? TRANSACTION_STATUS.ABANDONED : TRANSACTION_STATUS.FAILED,
    failureReason: payload.gateway_response || null,
    paidAt: payload.paid_at ? new Date(payload.paid_at) : null
  });
  await order.update({ paymentStatus: PAYMENT_STATUS.FAILED });
  await dispatchPaymentNotifications(order.id, TRANSACTION_STATUS.FAILED);

  return { status: tx.status, order, transaction: tx, failureReason: payload.gateway_response };
};

// --------------------------------------------------------------------------
// Success application (idempotent, row-locked)
// --------------------------------------------------------------------------

const applySuccessfulPayment = async (transactionId, { event, verifiedVia }) => {
  return sequelize.transaction(async transaction => {
    const tx = await Transaction.findOne({
      where: { id: transactionId },
      lock: transaction.LOCK.UPDATE,
      transaction
    });
    if (!tx) throw AppError.notFound('Transaction not found.');

    // Double-credit guard.
    if (tx.isProcessed()) {
      return { transaction: tx, alreadyProcessed: true };
    }

    const order = await Order.findOne({
      where: { id: tx.orderId },
      lock: transaction.LOCK.UPDATE,
      transaction
    });
    if (!order) {
      throw AppError.internal('Order missing for transaction.');
    }

    const payload = event?.data || {};
    const paidAmount = payload.amount ? toMajor(payload.amount) : tx.amount;

    // Cross-check the paid amount against what the backend calculated.
    if (!moneyEquals(paidAmount, tx.amount)) {
      logger.error('Payment amount mismatch', {
        transactionId: tx.id,
        orderId: order.id,
        paidAmount,
        expected: tx.amount
      });
      throw AppError.badRequest(`Paystack reported ${paidAmount} but the order expects ${tx.amount}.`);
    }

    const now = new Date();
    await tx.update({
      status: TRANSACTION_STATUS.SUCCESS,
      paidAt: now,
      processedAt: now,
      providerTransactionId: payload.id ? String(payload.id) : tx.providerTransactionId,
      channel: payload.channel || payload.authorization?.channel || tx.channel,
      verifiedVia,
      providerResponse: event
    }, { transaction });

    const previousStatus = order.status;
    await order.update({
      paymentStatus: PAYMENT_STATUS.PAID,
      status: ORDER_STATUS.PAID,
      paidAt: now
    }, { transaction });

    await OrderStatusHistory.create({
      orderId: order.id,
      fromStatus: previousStatus,
      toStatus: ORDER_STATUS.PAID,
      note: `Payment confirmed via Paystack (${verifiedVia})`
    }, { transaction });

    return { transaction: tx, order };
  });
};

/** Notifies the customer and all admins about a payment outcome. */
const dispatchPaymentNotifications = async (orderId, paymentResult) => {
  const order = await Order.findByPk(orderId, {
    attributes: ['id', 'userId', 'orderNumber', 'totalAmount', 'status']
  });
  if (!order) return;

  const success = paymentResult === TRANSACTION_STATUS.SUCCESS;
  await Promise.all([
    notify(order.userId, {
      type: success ? NOTIFICATION_TYPE.PAYMENT_SUCCESSFUL : NOTIFICATION_TYPE.PAYMENT_FAILED,
      title: success ? 'Payment successful' : 'Payment failed',
      message: success
        ? `Payment of ${order.totalAmount} for order ${order.orderNumber} was received.`
        : `We could not process payment for order ${order.orderNumber}. Please try again.`,
      channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
      resourceType: RESOURCE_TYPE.ORDER,
      resourceId: order.id,
      data: { orderNumber: order.orderNumber, amount: order.totalAmount }
    }),
    fanOutToAdmins({
      type: success ? NOTIFICATION_TYPE.PAYMENT_SUCCESSFUL : NOTIFICATION_TYPE.PAYMENT_FAILED,
      title: success ? 'Payment received' : 'Payment failed',
      message: success
        ? `Order ${order.orderNumber} was paid (${order.totalAmount}).`
        : `Payment for order ${order.orderNumber} failed.`,
      resourceType: RESOURCE_TYPE.ORDER,
      resourceId: order.id,
      data: { orderNumber: order.orderNumber, amount: order.totalAmount }
    })
  ]);
};

// --------------------------------------------------------------------------
// Webhook
// --------------------------------------------------------------------------

const WEBHOOK_EVENTS = new Set(['charge.success']);

/**
 * Processes a Paystack webhook.
 * `rawBody` must be the exact bytes Paystack signed (use express.raw).
 */
const handleWebhook = async ({ signature, rawBody }) => {
  if (!config.paystack.secretKey) {
    throw AppError.serviceUnavailable('Payments are not configured.');
  }

  const expected = crypto
    .createHmac('sha512', config.paystack.secretKey)
    .update(rawBody)
    .digest('hex');

  if (!safeEqual(expected, signature || '')) {
    logger.warn('Paystack webhook signature mismatch');
    throw AppError.unauthorized('Invalid webhook signature.');
  }

  const event = JSON.parse(rawBody.toString('utf8'));

  if (!WEBHOOK_EVENTS.has(event?.event)) {
    return { event: event?.event, handled: false };
  }

  const reference = event.data?.reference;
  if (!reference) {
    logger.warn('Paystack webhook missing reference');
    return { event: event.event, handled: false };
  }

  const tx = await Transaction.findOne({ where: { reference } });
  if (!tx) {
    logger.warn('Paystack webhook for unknown reference', { reference });
    throw AppError.notFound('No transaction matches this reference.');
  }

  const result = await applySuccessfulPayment(tx.id, { event, verifiedVia: 'WEBHOOK' });
  await dispatchPaymentNotifications(tx.orderId, TRANSACTION_STATUS.SUCCESS);
  return { event: event.event, handled: true, alreadyProcessed: result.alreadyProcessed === true };
};

// --------------------------------------------------------------------------
// Reads (IDOR-safe)
// --------------------------------------------------------------------------

const listTransactionsForUser = async ({ userId, page, limit, status }) => {
  const where = { userId };
  if (status) where.status = status;

  const result = await Transaction.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
    include: [{ model: Order, as: 'order', attributes: ['id', 'orderNumber', 'status', 'totalAmount'] }]
  });
  return result;
};

const listTransactionsForAdmin = async ({ page, limit, status }) => {
  const where = status ? { status } : {};
  const result = await Transaction.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
    include: [{ model: Order, as: 'order', attributes: ['id', 'orderNumber', 'status', 'totalAmount'] }]
  });
  return result;
};

module.exports = {
  initializePayment,
  verifyPayment,
  handleWebhook,
  applySuccessfulPayment,
  listTransactionsForUser,
  listTransactionsForAdmin
};