'use strict';

/**
 * Location-based delivery price override.
 *
 * A zone covers specific `cities` within a `state`, or the whole state when
 * `cities` is empty. `freeDeliveryThreshold = null` falls back to the global
 * threshold. Matching rules live in services/delivery.service.js.
 */
module.exports = (sequelize, DataTypes) => {
  const DeliveryZone = sequelize.define('DeliveryZone', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    state: { type: DataTypes.STRING(100), allowNull: false },
    cities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    fee: { type: DataTypes.INTEGER, allowNull: false },
    freeDeliveryThreshold: { type: DataTypes.INTEGER, allowNull: true },
    estimatedDeliveryText: { type: DataTypes.STRING(120), allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'delivery_zones',
    indexes: [
      { fields: ['state'] },
      { fields: ['isActive', 'sortOrder'] }
    ]
  });

  return DeliveryZone;
};
