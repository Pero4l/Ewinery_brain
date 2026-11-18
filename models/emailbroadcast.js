'use strict';

/** An admin email sent to every customer. Progress lives in EmailBroadcastRecipient rows. */
const STATUS = { RUNNING: 'RUNNING', COMPLETED: 'COMPLETED' };

module.exports = (sequelize, DataTypes) => {
  const EmailBroadcast = sequelize.define('EmailBroadcast', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    subject: { type: DataTypes.STRING(150), allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: STATUS.RUNNING },
    totalRecipients: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdBy: { type: DataTypes.UUID, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'email_broadcasts',
    indexes: [{ fields: ['status'] }, { fields: ['createdAt'] }]
  });

  EmailBroadcast.STATUS = STATUS;

  EmailBroadcast.associate = models => {
    EmailBroadcast.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
    EmailBroadcast.hasMany(models.EmailBroadcastRecipient, { foreignKey: 'broadcastId', as: 'recipients', onDelete: 'CASCADE' });
  };

  return EmailBroadcast;
};
