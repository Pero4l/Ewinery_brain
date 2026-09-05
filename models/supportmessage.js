'use strict';

/** One message in a support ticket conversation. */
module.exports = (sequelize, DataTypes) => {
  const SupportMessage = sequelize.define('SupportMessage', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    ticketId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    senderId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    /** Snapshot of the sender's role at send time: USER or ADMIN. */
    senderRole: {
      type: DataTypes.STRING(10),
      allowNull: false
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: { notEmpty: { msg: 'Message cannot be empty' } }
    },
    /** Admin-only note not shown to the customer. */
    isInternalNote: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'support_messages',
    indexes: [
      { fields: ['ticketId', 'createdAt'] },
      { fields: ['senderId'] }
    ]
  });

  SupportMessage.associate = models => {
    SupportMessage.belongsTo(models.SupportTicket, { foreignKey: 'ticketId', as: 'ticket' });
    SupportMessage.belongsTo(models.User, { foreignKey: 'senderId', as: 'sender' });
  };

  return SupportMessage;
};
