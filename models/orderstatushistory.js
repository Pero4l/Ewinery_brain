'use strict';

const { ORDER_STATUS_VALUES } = require('../config/constants');

/** Audit trail of every order status change. */
module.exports = (sequelize, DataTypes) => {
  const OrderStatusHistory = sequelize.define('OrderStatusHistory', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    orderId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    fromStatus: {
      type: DataTypes.ENUM(...ORDER_STATUS_VALUES),
      allowNull: true
    },
    toStatus: {
      type: DataTypes.ENUM(...ORDER_STATUS_VALUES),
      allowNull: false
    },
    /** Who made the change; null for system/webhook driven transitions. */
    changedBy: {
      type: DataTypes.UUID,
      allowNull: true
    },
    note: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  }, {
    tableName: 'order_status_history',
    updatedAt: false,
    indexes: [{ fields: ['orderId', 'createdAt'] }]
  });

  OrderStatusHistory.associate = models => {
    OrderStatusHistory.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
    OrderStatusHistory.belongsTo(models.User, { foreignKey: 'changedBy', as: 'actor' });
  };

  return OrderStatusHistory;
};
