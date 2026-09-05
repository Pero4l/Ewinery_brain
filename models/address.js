'use strict';

/**
 * Delivery address. A user may own several; exactly one may be the default.
 * The "single default" rule is enforced in the service layer inside a
 * transaction, plus a partial unique index created by the migration.
 */
module.exports = (sequelize, DataTypes) => {
  const Address = sequelize.define('Address', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    recipientName: {
      type: DataTypes.STRING(120),
      allowNull: false,
      validate: { notEmpty: { msg: 'Recipient name is required' } }
    },
    phone: {
      type: DataTypes.STRING(30),
      allowNull: false,
      validate: { notEmpty: { msg: 'Recipient phone number is required' } }
    },
    street: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: { notEmpty: { msg: 'Street address is required' } }
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { notEmpty: { msg: 'City is required' } }
    },
    state: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { notEmpty: { msg: 'State is required' } }
    },
    postalCode: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    country: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: 'Nigeria'
    },
    label: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'User friendly tag such as Home or Office'
    },
    deliveryInstructions: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }
  }, {
    tableName: 'addresses',
    paranoid: true,
    indexes: [
      { fields: ['userId'] },
      { fields: ['userId', 'isDefault'] }
    ]
  });

  Address.associate = models => {
    Address.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    Address.hasMany(models.Order, { foreignKey: 'addressId', as: 'orders' });
  };

  return Address;
};
