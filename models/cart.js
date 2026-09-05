'use strict';

/** One persistent cart per user. */
module.exports = (sequelize, DataTypes) => {
  const Cart = sequelize.define('Cart', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: { msg: 'This user already has a cart' }
    }
  }, {
    tableName: 'carts',
    indexes: [{ unique: true, fields: ['userId'] }]
  });

  Cart.associate = models => {
    Cart.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    Cart.hasMany(models.CartItem, { foreignKey: 'cartId', as: 'items', onDelete: 'CASCADE' });
  };

  return Cart;
};
