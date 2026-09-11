'use strict';

/**
 * Order service.
 *
 * The backend always recalculates amounts from the products table — nothing
 * price-related is ever trusted from the client. Order creation, stock
 * reservation and the initial PENDING transaction happen in a single
 * database transaction, so a partial order can never exist.
 */
const { Op } = require('sequelize');
const { sequelize, Order, OrderItem, OrderStatusHistory, Product, Address, User, Transaction } = require('../models');
const config = require('../config');
const AppError = require('../utils/AppError');
const { sum: moneySum } = require('../utils/money');
const { orderNumber, paymentReference } = require('../utils/tokens');
const { getOrCreateCart } = require('./cart.service');
const couponService = require('./coupon.service');
const { notify, fanOutToAdmins, NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, RESOURCE_TYPE } = require('./notification.service');
const {
  ORDER_STATUS,
  ORDER_USER_CANCELLABLE_STATUSES,
  PAYMENT_STATUS,
  TRANSACTION_STATUS,
  PRODUCT_STATUS
} = require('../config/constants');

const STATUS_TIMESTAMP_FIELD = Order.STATUS_TIMESTAMP_FIELD;

const snapshotAddress = address => ({
  recipientName: address.recipientName,
  phone: address.phone,
  street: address.street,
  city: address.city,
  state: address.state,
  postalCode: address.postalCode || null,
  country: address.country || 'Nigeria',
  deliveryInstructions: address.deliveryInstructions || null
});

const nextOrderNumber = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = orderNumber();
    const exists = await Order.findOne({ where: { orderNumber: candidate } });
    if (!exists) return candidate;
  }
  throw AppError.internal('Could not allocate a unique order number.');
};

const deliveryFeeFor = subtotal =>
  subtotal >= (config.store.freeDeliveryThreshold || 0) ? 0 : (config.store.deliveryFee || 0);

/** Decrements stock atomically; returns false if insufficient. */
const reserveStock = async (productId, quantity, transaction) => {
  const [affected] = await Product.update(
    { stockQuantity: sequelize.literal(`"stockQuantity" - ${quantity}`) },
    {
      where: {
        id: productId,
        stockQuantity: { [Op.gte]: quantity },
        isAvailable: true,
        status: PRODUCT_STATUS.ACTIVE
      },
      transaction
    }
  );
  return affected > 0;
};

const incrementSales = async (productId, quantity, transaction) => {
  await Product.increment({ salesCount: quantity }, { where: { id: productId }, transaction });
};

/** Restores stock + sales counts for a cancelled order (idempotent). */
const restoreStock = async (order, transaction) => {
  if (!order.stockCommitted) return;
  const items = await OrderItem.findAll({ where: { orderId: order.id }, transaction });
  for (const item of items) {
    if (!item.productId) continue;
    await Product.increment({ stockQuantity: item.quantity, salesCount: -item.quantity }, {
      where: { id: item.productId },
      transaction
    });
  }
  await order.update({ stockCommitted: false }, { transaction });
};

const recordStatusHistory = async ({ order, toStatus, changedBy, note, transaction }) => {
  await OrderStatusHistory.create({
    orderId: order.id,
    fromStatus: order.status,
    toStatus,
    changedBy: changedBy || null,
    note: note || null
  }, { transaction });
};

const DEFAULT_INCLUDES = [
  { model: OrderItem, as: 'items' },
  { model: Transaction, as: 'transactions' },
  { model: OrderStatusHistory, as: 'statusHistory', order: [['createdAt', 'DESC']] }
];

// --------------------------------------------------------------------------
// Creation
// --------------------------------------------------------------------------

/**
 * Creates an order from the user's cart within a single transaction.
 * Returns the order together with its pending payment reference.
 */
const createOrder = async ({ userId, addressId, customerNote, couponCode }) => {
  if (config.security.requireVerifiedEmailForCheckout) {
    const user = await User.findByPk(userId, { attributes: ['id', 'emailVerifiedAt'] });
    if (!user?.emailVerifiedAt) {
      throw AppError.badRequest('Please verify your email address before checking out.');
    }
  }

  const deliveryAddress = await (async () => {
    if (addressId) {
      const owned = await Address.findOne({ where: { id: addressId, userId } });
      if (!owned) throw AppError.notFound('Delivery address not found.');
      return owned;
    }
    let def = await Address.findOne({ where: { userId, isDefault: true } });
    if (!def) def = await Address.findOne({ where: { userId }, order: [['createdAt', 'DESC']] });
    if (!def) throw AppError.badRequest('Please add a delivery address before placing an order.');
    return def;
  })();

  const result = await sequelize.transaction(async transaction => {
    const cart = await getOrCreateCart(userId, { transaction });
    const cartItems = await cart.getItems({ transaction, include: [{ model: Product, as: 'product' }] });

    if (!cartItems.length) {
      throw AppError.badRequest('Your cart is empty.');
    }

    let subtotal = 0;
    let itemCount = 0;
    const lines = [];

    for (const cartItem of cartItems) {
      const product = cartItem.product;
      if (!product) {
        await cartItem.destroy({ transaction });
        continue;
      }
      if (!product.isPurchasable(cartItem.quantity)) {
        throw AppError.badRequest(`"${product.name}" has insufficient stock for this order.`);
      }

      const qty = cartItem.quantity;
      const unitPrice = product.price;
      const lineTotal = Number((unitPrice * qty).toFixed(2));
      subtotal = moneySum(subtotal, lineTotal);
      itemCount += qty;
      lines.push({ product, qty, unitPrice, lineTotal });
    }

    if (!lines.length) throw AppError.badRequest('Your cart is empty.');

    const deliveryFee = deliveryFeeFor(subtotal);
    let discount = 0;
    let couponId = null;
    let couponCodeSnapshot = null;

    if (couponCode) {
      const applied = await couponService.applyCouponAtCheckout({
        code: couponCode,
        userId,
        subtotal,
        transaction
      });
      discount = applied.discount;
      couponId = applied.coupon.id;
      couponCodeSnapshot = applied.coupon.code;
    }

    const totalAmount = moneySum(subtotal, deliveryFee) - discount;

    const orderNumberValue = await nextOrderNumber();
    const order = await Order.create({
      orderNumber: orderNumberValue,
      userId,
      addressId: deliveryAddress.id,
      shippingAddress: snapshotAddress(deliveryAddress),
      status: ORDER_STATUS.PENDING,
      paymentStatus: PAYMENT_STATUS.PENDING,
      subtotal,
      deliveryFee,
      discount,
      totalAmount,
      currency: 'NGN',
      itemCount,
      customerNote: customerNote || null,
      couponId,
      couponCode: couponCodeSnapshot
    }, { transaction });

    for (const line of lines) {
      const galleryUrl = Array.isArray(line.product.gallery) && line.product.gallery.length
        ? line.product.gallery[0].url
        : null;
      await OrderItem.create({
        orderId: order.id,
        productId: line.product.id,
        productName: line.product.name,
        productImageUrl: line.product.imageUrl || galleryUrl,
        unitPrice: line.unitPrice,
        quantity: line.qty,
        lineTotal: line.lineTotal
      }, { transaction });
    }

    // Atomic inventory reservation.
    for (const line of lines) {
      const reserved = await reserveStock(line.product.id, line.qty, transaction);
      if (!reserved) {
        throw AppError.badRequest(`Insufficient stock for "${line.product.name}". Please adjust your cart.`);
      }
      await incrementSales(line.product.id, line.qty, transaction);
    }
    await order.update({ stockCommitted: true }, { transaction });

    await recordStatusHistory({ order, toStatus: ORDER_STATUS.PENDING, transaction });

    const transactionRow = await Transaction.create({
      reference: paymentReference(),
      orderId: order.id,
      userId,
      provider: 'PAYSTACK',
      status: TRANSACTION_STATUS.PENDING,
      amount: totalAmount,
      currency: 'NGN'
    }, { transaction });

    // Redeem a used coupon (single-use per assignment) within the same txn.
    if (couponId) {
      await couponService.redeemCoupon({ couponId, userId, orderId: order.id, transaction });
    }

    // Clear the cart after a successful order creation.
    for (const item of cartItems) {
      await item.destroy({ transaction });
    }

    return { order, transactionRow };
  });

  const { order, transactionRow } = result;

  // Post-commit notifications (fire and forget; never part of the txn).
  await Promise.all([
    notify(order.userId, {
      type: NOTIFICATION_TYPE.ORDER_CREATED,
      title: 'Order confirmed',
      message: `Your order ${order.orderNumber} (${order.totalAmount}) is pending payment.`,
      channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
      resourceType: RESOURCE_TYPE.ORDER,
      resourceId: order.id,
      data: { orderNumber: order.orderNumber, amount: order.totalAmount }
    }),
    fanOutToAdmins({
      type: NOTIFICATION_TYPE.NEW_ORDER,
      title: 'New order received',
      message: `Order ${order.orderNumber} for ${order.totalAmount} was placed.`,
      resourceType: RESOURCE_TYPE.ORDER,
      resourceId: order.id,
      data: { orderNumber: order.orderNumber, amount: order.totalAmount }
    })
  ]);

  return { order, transactionReference: transactionRow.reference };
};

// --------------------------------------------------------------------------
// Reading (IDOR-safe)
// --------------------------------------------------------------------------

const getOrderForUser = async ({ userId, orderId }) => {
  const order = await Order.findOne({
    where: { id: orderId, userId },
    include: DEFAULT_INCLUDES
  });
  if (!order) throw AppError.notFound('Order not found.');
  return order;
};

const listOrdersForUser = async ({ userId, page, limit, status }) => {
  const where = { userId };
  if (status) where.status = status;

  const result = await Order.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
    include: [{ model: OrderItem, as: 'items' }]
  });
  return result;
};

const getOrderForAdmin = async orderId => {
  const order = await Order.findByPk(orderId, {
    include: [
      ...DEFAULT_INCLUDES,
      { model: User, as: 'user', attributes: ['id', 'fullName', 'email', 'phone'] },
      { model: Address, as: 'address' }
    ]
  });
  if (!order) throw AppError.notFound('Order not found.');
  return order;
};

const listOrdersForAdmin = async ({ page, limit, status, search }) => {
  const where = {};
  if (status) where.status = status;
  if (search) {
    where[Op.or] = [
      { orderNumber: { [Op.iLike]: `%${search}%` } },
      { '$user.email$': { [Op.iLike]: `%${search}%` } }
    ];
  }

  const result = await Order.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
    distinct: true,
    include: [
      { model: User, as: 'user', attributes: ['id', 'fullName', 'email', 'phone'] },
      { model: Transaction, as: 'transactions' }
    ]
  });
  return result;
};

// --------------------------------------------------------------------------
// Status transitions
// --------------------------------------------------------------------------

const setOrderStatus = async ({ order, toStatus, changedBy, note, transaction }) => {
  if (!order.canTransitionTo(toStatus)) {
    throw AppError.badRequest(`Order cannot transition from ${order.status} to ${toStatus}.`);
  }

  const previous = order.status;
  const patch = { status: toStatus };
  const timestampField = STATUS_TIMESTAMP_FIELD[toStatus];
  if (timestampField) patch[timestampField] = new Date();
  if (toStatus === ORDER_STATUS.PAID) patch.paymentStatus = PAYMENT_STATUS.PAID;

  await order.update(patch, { transaction });

  if (toStatus === ORDER_STATUS.CANCELLED) {
    await restoreStock(order, transaction);
    await Transaction.update(
      { status: TRANSACTION_STATUS.ABANDONED },
      { where: { orderId: order.id, status: TRANSACTION_STATUS.PENDING }, transaction }
    );
  }

  await recordStatusHistory({ order, toStatus, changedBy, note, transaction });
  return { previous, current: toStatus };
};

/** Admin-driven status update with notification dispatch. */
const updateOrderStatus = async ({ orderId, status, changedBy, note }) => {
  const outcome = await sequelize.transaction(async transaction => {
    const order = await Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!order) throw AppError.notFound('Order not found.');
    if (status === order.status) {
      throw AppError.badRequest(`Order is already ${status}.`);
    }
    return setOrderStatus({ order, toStatus: status, changedBy, note, transaction });
  });

  await dispatchStatusNotifications(orderId, status);
  return orderId;
};

/** Customer confirms receipt: DELIVERED -> COMPLETED (via DELIVERED if needed). */
const confirmReceipt = async ({ userId, orderId }) => {
  const result = await sequelize.transaction(async transaction => {
    const order = await Order.findOne({
      where: { id: orderId, userId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!order) throw AppError.notFound('Order not found.');

    if (order.status === ORDER_STATUS.OUT_FOR_DELIVERY) {
      await setOrderStatus({ order, toStatus: ORDER_STATUS.DELIVERED, transaction });
    }
    if (order.status !== ORDER_STATUS.DELIVERED) {
      throw AppError.badRequest('Only delivered orders can be confirmed as received.');
    }

    await setOrderStatus({ order, toStatus: ORDER_STATUS.COMPLETED, transaction });
    return { orderNumber: order.orderNumber, completedAt: new Date() };
  });

  await Promise.all([
    notify(userId, {
      type: NOTIFICATION_TYPE.ORDER_COMPLETED,
      title: 'Order completed',
      message: `Order ${result.orderNumber} has been completed. Thank you for shopping with eWinery!`,
      channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
      resourceType: RESOURCE_TYPE.ORDER,
      resourceId: orderId,
      data: { orderNumber: result.orderNumber }
    }),
    fanOutToAdmins({
      type: NOTIFICATION_TYPE.ORDER_COMPLETED,
      title: 'Order completed',
      message: `Order ${result.orderNumber} was marked completed by the customer.`,
      resourceType: RESOURCE_TYPE.ORDER,
      resourceId: orderId,
      data: { orderNumber: result.orderNumber }
    })
  ]);

  return result;
};

/** Customer cancels a cancellable (PENDING) order. */
const cancelOrderByUser = async ({ userId, orderId, reason }) => {
  const result = await sequelize.transaction(async transaction => {
    const order = await Order.findOne({
      where: { id: orderId, userId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!order) throw AppError.notFound('Order not found.');
    if (!ORDER_USER_CANCELLABLE_STATUSES.includes(order.status)) {
      throw AppError.badRequest('This order can no longer be cancelled.');
    }
    return setOrderStatus({
      order,
      toStatus: ORDER_STATUS.CANCELLED,
      changedBy: userId,
      note: reason || 'Cancelled by customer',
      transaction
    });
  });

  await dispatchCancellationNotifications(orderId, userId);
  return result;
};

/** Admin cancels any non-terminal order. */
const cancelOrderByAdmin = async ({ orderId, changedBy, reason }) => {
  const outcome = await sequelize.transaction(async transaction => {
    const order = await Order.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!order) throw AppError.notFound('Order not found.');
    if (order.isTerminal()) {
      throw AppError.badRequest('Terminal orders cannot be cancelled.');
    }
    return setOrderStatus({
      order,
      toStatus: ORDER_STATUS.CANCELLED,
      changedBy,
      note: reason || 'Cancelled by administrator',
      transaction
    });
  });

  await dispatchCancellationNotifications(orderId, changedBy);
  return outcome;
};

const dispatchStatusNotifications = async (orderId, status) => {
  const order = await Order.findByPk(orderId, { attributes: ['id', 'userId', 'orderNumber', 'totalAmount'] });
  if (!order) return;

  const typeMap = {
    [ORDER_STATUS.OUT_FOR_DELIVERY]: NOTIFICATION_TYPE.ORDER_OUT_FOR_DELIVERY,
    [ORDER_STATUS.DELIVERED]: NOTIFICATION_TYPE.ORDER_DELIVERED,
    [ORDER_STATUS.COMPLETED]: NOTIFICATION_TYPE.ORDER_COMPLETED
  };

  await Promise.all([
    notify(order.userId, {
      type: typeMap[status] || NOTIFICATION_TYPE.ORDER_STATUS_CHANGED,
      title: `Order ${order.orderNumber} is now ${status}`,
      message: `Your order ${order.orderNumber} status changed to ${status}.`,
      channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
      resourceType: RESOURCE_TYPE.ORDER,
      resourceId: order.id,
      data: { orderNumber: order.orderNumber, status }
    }),
    fanOutToAdmins({
      type: NOTIFICATION_TYPE.ORDER_STATUS_CHANGED,
      title: 'Order status changed',
      message: `Order ${order.orderNumber} is now ${status}.`,
      resourceType: RESOURCE_TYPE.ORDER,
      resourceId: order.id,
      data: { orderNumber: order.orderNumber, status }
    })
  ]);
};

const dispatchCancellationNotifications = async (orderId, actorId) => {
  const order = await Order.findByPk(orderId, { attributes: ['id', 'userId', 'orderNumber', 'totalAmount'] });
  if (!order) return;

  await Promise.all([
    notify(order.userId, {
      type: NOTIFICATION_TYPE.ORDER_CANCELLED,
      title: 'Order cancelled',
      message: `Your order ${order.orderNumber} has been cancelled.`,
      channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
      resourceType: RESOURCE_TYPE.ORDER,
      resourceId: order.id,
      data: { orderNumber: order.orderNumber }
    }),
    fanOutToAdmins({
      type: NOTIFICATION_TYPE.ORDER_CANCELLED,
      title: 'Order cancelled',
      message: `Order ${order.orderNumber} was cancelled.`,
      resourceType: RESOURCE_TYPE.ORDER,
      resourceId: order.id,
      data: { orderNumber: order.orderNumber }
    })
  ]);
};

module.exports = {
  createOrder,
  getOrderForUser,
  listOrdersForUser,
  getOrderForAdmin,
  listOrdersForAdmin,
  updateOrderStatus,
  confirmReceipt,
  cancelOrderByUser,
  cancelOrderByAdmin,
  setOrderStatus
};