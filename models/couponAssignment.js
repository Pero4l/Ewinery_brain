'use strict';

/**
 * Grant of a coupon to a single user (many-to-many join).
 *
 * One row per coupon + user; the unique (couponId, userId) index prevents
 * duplicates. `redeemedAt` makes an assignment single-use: once set the user
 * can no longer use the coupon, and `orderId` records which order consumed it.
 */
module.exports = (sequelize, DataTypes) => {
  const CouponAssignment = sequelize.define('CouponAssignment', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    couponId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    /** Admin who granted the coupon. */
    assignedBy: {
      type: DataTypes.UUID,
      allowNull: true
    },
    redeemedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    /** Order that consumed this assignment (set on redemption). */
    orderId: {
      type: DataTypes.UUID,
      allowNull: true
    }
  }, {
    tableName: 'coupon_assignments',
    indexes: [
      { unique: true, fields: ['couponId', 'userId'] },
      { fields: ['userId'] },
      { fields: ['couponId'] },
      { fields: ['redeemedAt'] }
    ]
  });

  CouponAssignment.prototype.isRedeemed = function isRedeemed() {
    return Boolean(this.redeemedAt);
  };

  CouponAssignment.associate = models => {
    CouponAssignment.belongsTo(models.Coupon, { foreignKey: 'couponId', as: 'coupon' });
    CouponAssignment.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    CouponAssignment.belongsTo(models.User, { foreignKey: 'assignedBy', as: 'assigner' });
    CouponAssignment.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
  };

  return CouponAssignment;
};