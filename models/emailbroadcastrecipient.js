'use strict';

/**
 * One customer's copy of a broadcast. Unique per (broadcastId, userId), so a
 * customer can never be queued twice for the same broadcast.
 */
const STATUS = {
  PENDING: 'PENDING',
  SENDING: 'SENDING',
  SENT: 'SENT',
  RETRY: 'RETRY',
  FAILED: 'FAILED'
};

module.exports = (sequelize, DataTypes) => {
  const EmailBroadcastRecipient = sequelize.define('EmailBroadcastRecipient', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    broadcastId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: true },
    email: { type: DataTypes.STRING(160), allowNull: false },
    name: { type: DataTypes.STRING(120), allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: STATUS.PENDING },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastError: { type: DataTypes.STRING(255), allowNull: true },
    claimedAt: { type: DataTypes.DATE, allowNull: true },
    nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
    sentAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'email_broadcast_recipients',
    indexes: [
      { unique: true, fields: ['broadcastId', 'userId'], name: 'email_broadcast_recipients_unique_user' },
      { fields: ['broadcastId', 'status'] }
    ]
  });

  EmailBroadcastRecipient.STATUS = STATUS;

  EmailBroadcastRecipient.associate = models => {
    EmailBroadcastRecipient.belongsTo(models.EmailBroadcast, { foreignKey: 'broadcastId', as: 'broadcast' });
    EmailBroadcastRecipient.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return EmailBroadcastRecipient;
};
