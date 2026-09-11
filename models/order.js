'use strict';

const {
  ORDER_STATUS_VALUES,
  ORDER_STATUS,
  PAYMENT_STATUS_VALUES,
  PAYMENT_STATUS,
  ORDER_STATUS_TRANSITIONS,
  ORDER_TERMINAL_STATUSES
} = require('../config/constants');

/**
 * Customer order.
 *
 * All monetary values are computed server-side from the products table. The
 * delivery address is snapshotted into `shippingAddress` (JSONB) so later
 * edits or deletion of the address record cannot rewrite order history.
 */
const decimalGetter = field => function get() {
  const raw = this.getDataValue(field);
  return raw === null || raw === undefined ? raw : Number(raw);
};

module.exports = (sequelize, DataTypes) => {
  const Order = sequelize.define('Order', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    /** Human friendly reference shown to the customer, e.g. EW-8F3K2Q. */
    orderNumber: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: { msg: 'Duplicate order number' }
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    addressId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Nullable so deleting an address never destroys order history'
    },
    /** Immutable snapshot of the delivery details at checkout time. */
    shippingAddress: {
      type: DataTypes.JSONB,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM(...ORDER_STATUS_VALUES),
      allowNull: false,
      defaultValue: ORDER_STATUS.PENDING
    },
    paymentStatus: {
      type: DataTypes.ENUM(...PAYMENT_STATUS_VALUES),
      allowNull: false,
      defaultValue: PAYMENT_STATUS.PENDING
    },
    subtotal: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      get: decimalGetter('subtotal')
    },
    deliveryFee: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      get: decimalGetter('deliveryFee')
    },
    discount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      get: decimalGetter('discount')
    },
    /** Final payable amount = subtotal + deliveryFee - discount. */
    totalAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      get: decimalGetter('totalAmount')
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'NGN'
    },
    itemCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    customerNote: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    /** Internal admin-only note, never returned to customers. */
    adminNote: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    /** Coupon snapshot at checkout (set when a coupon discounted the order). */
    couponId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    couponCode: {
      type: DataTypes.STRING(30),
      allowNull: true
    },
    cancelReason: {
      type: DataTypes.STRING(255),
      allowNull: true
    },

    // Lifecycle timestamps
    paidAt: { type: DataTypes.DATE, allowNull: true },
    processingAt: { type: DataTypes.DATE, allowNull: true },
    readyAt: { type: DataTypes.DATE, allowNull: true },
    dispatchedAt: { type: DataTypes.DATE, allowNull: true },
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    cancelledAt: { type: DataTypes.DATE, allowNull: true },

    /** True once stock has been decremented, so it is only ever done once. */
    stockCommitted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }
  }, {
    tableName: 'orders',
    indexes: [
      { unique: true, fields: ['orderNumber'] },
      { fields: ['userId'] },
      { fields: ['status'] },
      { fields: ['paymentStatus'] },
      { fields: ['createdAt'] },
      { fields: ['userId', 'status'] },
      { fields: ['couponId'] },
      { fields: ['couponCode'] }
    ]
  });

  /** Maps a status to the column that records when it was entered. */
  Order.STATUS_TIMESTAMP_FIELD = {
    [ORDER_STATUS.PAID]: 'paidAt',
    [ORDER_STATUS.PROCESSING]: 'processingAt',
    [ORDER_STATUS.READY_FOR_DELIVERY]: 'readyAt',
    [ORDER_STATUS.OUT_FOR_DELIVERY]: 'dispatchedAt',
    [ORDER_STATUS.DELIVERED]: 'deliveredAt',
    [ORDER_STATUS.COMPLETED]: 'completedAt',
    [ORDER_STATUS.CANCELLED]: 'cancelledAt'
  };

  Order.prototype.canTransitionTo = function canTransitionTo(nextStatus) {
    const allowed = ORDER_STATUS_TRANSITIONS[this.status] || [];
    return allowed.includes(nextStatus);
  };

  Order.prototype.isTerminal = function isTerminal() {
    return ORDER_TERMINAL_STATUSES.includes(this.status);
  };

  Order.prototype.isPaid = function isPaid() {
    return this.paymentStatus === PAYMENT_STATUS.PAID;
  };

  Order.associate = models => {
    Order.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    Order.belongsTo(models.Address, { foreignKey: 'addressId', as: 'address' });
    Order.belongsTo(models.Coupon, { foreignKey: 'couponId', as: 'coupon' });
    Order.hasMany(models.OrderItem, { foreignKey: 'orderId', as: 'items', onDelete: 'CASCADE' });
    Order.hasMany(models.Transaction, { foreignKey: 'orderId', as: 'transactions' });
    Order.hasMany(models.Review, { foreignKey: 'orderId', as: 'reviews' });
    Order.hasMany(models.OrderStatusHistory, { foreignKey: 'orderId', as: 'statusHistory', onDelete: 'CASCADE' });
  };

  return Order;
};
