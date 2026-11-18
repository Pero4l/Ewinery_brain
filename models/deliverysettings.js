'use strict';

/**
 * Global delivery pricing, edited by admins. Always a single row (id = 1).
 * Fees are whole naira. `freeDeliveryThreshold = null` means delivery is
 * never free.
 */
module.exports = (sequelize, DataTypes) => {
  const DeliverySettings = sequelize.define('DeliverySettings', {
    id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
    isDeliveryEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    defaultFee: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1500 },
    freeDeliveryThreshold: { type: DataTypes.INTEGER, allowNull: true },
    estimatedDeliveryText: { type: DataTypes.STRING(120), allowNull: true },
    updatedBy: { type: DataTypes.UUID, allowNull: true }
  }, {
    tableName: 'delivery_settings'
  });

  DeliverySettings.SINGLETON_ID = 1;

  DeliverySettings.associate = models => {
    DeliverySettings.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
  };

  return DeliverySettings;
};
