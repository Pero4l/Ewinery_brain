'use strict';

const {
  TICKET_STATUS_VALUES,
  TICKET_STATUS,
  TICKET_PRIORITY_VALUES,
  TICKET_PRIORITY
} = require('../config/constants');

/**
 * Customer support ticket.
 *
 * Visible to the owning user and to every admin. `assignedTo` lets one admin
 * claim a ticket so two admins do not answer the same issue in parallel.
 */
module.exports = (sequelize, DataTypes) => {
  const SupportTicket = sequelize.define('SupportTicket', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    /** Short human reference, e.g. TCK-4KD92M. */
    ticketNumber: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: { msg: 'Duplicate ticket number' }
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    subject: {
      type: DataTypes.STRING(180),
      allowNull: false,
      validate: { notEmpty: { msg: 'Subject is required' } }
    },
    status: {
      type: DataTypes.ENUM(...TICKET_STATUS_VALUES),
      allowNull: false,
      defaultValue: TICKET_STATUS.OPEN
    },
    priority: {
      type: DataTypes.ENUM(...TICKET_PRIORITY_VALUES),
      allowNull: false,
      defaultValue: TICKET_PRIORITY.MEDIUM
    },
    /** Admin who claimed the ticket. */
    assignedTo: {
      type: DataTypes.UUID,
      allowNull: true
    },
    assignedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    /** Optional link to the order the ticket is about. */
    orderId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    /** Unread counters so list views need no extra aggregate query. */
    unreadForUser: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    unreadForAdmin: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    resolvedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    closedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'support_tickets',
    indexes: [
      { unique: true, fields: ['ticketNumber'] },
      { fields: ['userId'] },
      { fields: ['status'] },
      { fields: ['assignedTo'] },
      { fields: ['lastMessageAt'] }
    ]
  });

  SupportTicket.prototype.isClosed = function isClosed() {
    return this.status === TICKET_STATUS.CLOSED;
  };

  SupportTicket.associate = models => {
    SupportTicket.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    SupportTicket.belongsTo(models.User, { foreignKey: 'assignedTo', as: 'agent' });
    SupportTicket.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
    SupportTicket.hasMany(models.SupportMessage, {
      foreignKey: 'ticketId',
      as: 'messages',
      onDelete: 'CASCADE'
    });
  };

  return SupportTicket;
};
