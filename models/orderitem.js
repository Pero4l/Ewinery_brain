'use strict';

/**
 * Order line item.
 *
 * Product name/price are copied at purchase time so the invoice remains
 * accurate even if the product is later renamed, repriced or deleted.
 */
const decimalGetter = field => function get() {
  const raw = this.getDataValue(field);
  return raw === null || raw === undefined ? raw : Number(raw);
};

module.exports = (sequelize, DataTypes) => {
  const OrderItem = sequelize.define('OrderItem', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    orderId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    productId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Nullable so a deleted product does not destroy order history'
    },
    /** Snapshot fields */
    productName: {
      type: DataTypes.STRING(180),
      allowNull: false
    },
    productImageUrl: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    unitPrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      get: decimalGetter('unitPrice')
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: { args: [1], msg: 'Quantity must be at least 1' } }
    },
    /** unitPrice * quantity, computed server-side. */
    lineTotal: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      get: decimalGetter('lineTotal')
    }
  }, {
    tableName: 'order_items',
    indexes: [
      { fields: ['orderId'] },
      { fields: ['productId'] }
    ]
  });

  OrderItem.associate = models => {
    OrderItem.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
    OrderItem.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });
    OrderItem.hasOne(models.Review, { foreignKey: 'orderItemId', as: 'review' });
  };

  return OrderItem;
};
