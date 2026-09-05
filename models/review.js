'use strict';

const { REVIEW_STATUS_VALUES, REVIEW_STATUS } = require('../config/constants');

/**
 * Product review.
 *
 * A user may only review a given product once (unique index on
 * userId + productId). `orderItemId` links the review back to the purchase
 * that entitles the user to write it.
 */
module.exports = (sequelize, DataTypes) => {
  const Review = sequelize.define('Review', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    productId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    orderId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    orderItemId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: { args: [1], msg: 'Rating must be between 1 and 5' },
        max: { args: [5], msg: 'Rating must be between 1 and 5' }
      }
    },
    title: {
      type: DataTypes.STRING(140),
      allowNull: true
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM(...REVIEW_STATUS_VALUES),
      allowNull: false,
      defaultValue: REVIEW_STATUS.APPROVED
    },
    /** True when the review is tied to a delivered order item. */
    isVerifiedPurchase: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    /** Admin moderation note, never exposed to customers. */
    moderationNote: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    editedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'reviews',
    paranoid: true,
    indexes: [
      { fields: ['productId', 'status', 'createdAt'] },
      { fields: ['userId'] },
      { unique: true, fields: ['userId', 'productId'], where: { deletedAt: null } }
    ]
  });

  Review.associate = models => {
    Review.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });
    Review.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    Review.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
    Review.belongsTo(models.OrderItem, { foreignKey: 'orderItemId', as: 'orderItem' });
  };

  return Review;
};
