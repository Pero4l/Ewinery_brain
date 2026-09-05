'use strict';

const {
  NOTIFICATION_TYPE_VALUES,
  NOTIFICATION_CHANNEL_VALUES,
  NOTIFICATION_CHANNEL,
  RESOURCE_TYPE_VALUES
} = require('../config/constants');

/**
 * In-app notification.
 *
 * Always scoped to a single recipient (`userId`) — fan-out to all admins
 * creates one row per admin rather than one shared row, so read state is
 * per-person. `channel` keeps the table ready for EMAIL/PUSH records without
 * a schema change.
 */
module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define('Notification', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM(...NOTIFICATION_TYPE_VALUES),
      allowNull: false
    },
    channel: {
      type: DataTypes.ENUM(...NOTIFICATION_CHANNEL_VALUES),
      allowNull: false,
      defaultValue: NOTIFICATION_CHANNEL.IN_APP
    },
    title: {
      type: DataTypes.STRING(180),
      allowNull: false
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    /** Related entity, so the client can deep-link. */
    resourceType: {
      type: DataTypes.ENUM(...RESOURCE_TYPE_VALUES),
      allowNull: true
    },
    resourceId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    /** Extra structured payload (order number, amount, ...). */
    data: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'notifications',
    indexes: [
      { fields: ['userId', 'readAt'] },
      { fields: ['userId', 'createdAt'] },
      { fields: ['type'] },
      { fields: ['resourceType', 'resourceId'] }
    ]
  });

  Notification.prototype.isRead = function isRead() {
    return Boolean(this.readAt);
  };

  Notification.associate = models => {
    Notification.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return Notification;
};
