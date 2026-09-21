'use strict';

const {
  TRANSACTION_STATUS_VALUES,
  TRANSACTION_STATUS,
  PAYMENT_PROVIDER_VALUES,
  PAYMENT_PROVIDER
} = require('../config/constants');

/**
 * Payment transaction record.
 *
 * `reference` is unique — it is the idempotency key that stops a webhook and a
 * client-side verify call from both crediting the same order.
 */
module.exports = (sequelize, DataTypes) => {
  const Transaction = sequelize.define('Transaction', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    /** Our generated reference sent to Paystack. */
    reference: {
      type: DataTypes.STRING(80),
      allowNull: false,
      unique: { msg: 'Duplicate transaction reference' }
    },
    orderId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    /** Null for guest (non-registered) checkout orders. */
    userId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    provider: {
      type: DataTypes.ENUM(...PAYMENT_PROVIDER_VALUES),
      allowNull: false,
      defaultValue: PAYMENT_PROVIDER.PAYSTACK
    },
    /** Provider side identifier (Paystack numeric transaction id). */
    providerTransactionId: {
      type: DataTypes.STRING(80),
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM(...TRANSACTION_STATUS_VALUES),
      allowNull: false,
      defaultValue: TRANSACTION_STATUS.PENDING
    },
    /** Amount in the major unit (naira), mirroring order.totalAmount. */
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      get() {
        const raw = this.getDataValue('amount');
        return raw === null || raw === undefined ? raw : Number(raw);
      }
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'NGN'
    },
    channel: {
      type: DataTypes.STRING(40),
      allowNull: true,
      comment: 'card, bank_transfer, ussd, ...'
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    /** Set the moment a success is applied to the order — guards double credit. */
    processedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    authorizationUrl: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    accessCode: {
      type: DataTypes.STRING(120),
      allowNull: true
    },
    failureReason: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    /** Raw provider payload for auditing/reconciliation. */
    providerResponse: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    /** 'WEBHOOK' | 'VERIFY' — how the final status was confirmed. */
    verifiedVia: {
      type: DataTypes.STRING(20),
      allowNull: true
    }
  }, {
    tableName: 'transactions',
    indexes: [
      { unique: true, fields: ['reference'] },
      { fields: ['orderId'] },
      { fields: ['userId'] },
      { fields: ['status'] },
      { fields: ['createdAt'] }
    ]
  });

  Transaction.prototype.isSuccessful = function isSuccessful() {
    return this.status === TRANSACTION_STATUS.SUCCESS;
  };

  /** True when this transaction has already been applied to its order. */
  Transaction.prototype.isProcessed = function isProcessed() {
    return Boolean(this.processedAt);
  };

  Transaction.associate = models => {
    Transaction.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
    Transaction.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return Transaction;
};
