'use strict';

/**
 * Line in a user's cart.
 *
 * Deliberately stores only productId + quantity: the price is always resolved
 * from the products table at checkout so a stale or tampered cart can never
 * influence what the customer is charged.
 */
module.exports = (sequelize, DataTypes) => {
  const CartItem = sequelize.define('CartItem', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    cartId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    productId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      validate: {
        min: { args: [1], msg: 'Quantity must be at least 1' }
      }
    }
  }, {
    tableName: 'cart_items',
    indexes: [
      { fields: ['cartId'] },
      { unique: true, fields: ['cartId', 'productId'] }
    ]
  });

  CartItem.associate = models => {
    CartItem.belongsTo(models.Cart, { foreignKey: 'cartId', as: 'cart' });
    CartItem.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });
  };

  return CartItem;
};
