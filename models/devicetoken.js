'use strict';

module.exports = (sequelize, DataTypes) => {
  const DeviceToken = sequelize.define('DeviceToken', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    token: {
      type: DataTypes.STRING(400),
      allowNull: false,
      comment: 'Expo push token (ExponentPushToken[...])'
    },
    platform: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'ios',
      comment: 'ios | android'
    },
    preferences: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: { orderUpdates: true, promotions: true }
    }
  }, {
    tableName: 'device_tokens',
    indexes: [
      { unique: true, fields: ['userId', 'token'] },
      { fields: ['token'] }
    ]
  });

  DeviceToken.associate = models => {
    DeviceToken.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return DeviceToken;
};