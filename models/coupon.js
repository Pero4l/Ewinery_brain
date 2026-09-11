'use strict';

/**
 * Coupon / pay-off-the-bill discount voucher.
 *
 * A coupon is a fixed naira discount valid inside a time window
 * [startsAt, expiresAt]. It only applies to users it has explicitly been
 * assigned to (see coupon_assignments), and each assignment is single-use.
 *
 * Money is stored as DECIMAL(12,2) and exposed as a Number by the getter so
 * JSON responses stay numeric, matching every other money field in the app.
 */
module.exports = (sequelize, DataTypes) => {
  const Coupon = sequelize.define('Coupon', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    /** Case-insensitive code the customer types at checkout, stored + compared uppercase. */
    code: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: { msg: 'A coupon with this code already exists' },
      set(value) {
        this.setDataValue('code', typeof value === 'string' ? value.trim().toUpperCase() : value);
      },
      get() {
        const raw = this.getDataValue('code');
        return raw === null || raw === undefined ? raw : String(raw).toUpperCase();
      }
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      validate: { notEmpty: { msg: 'Coupon name is required' } }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    /** Fixed discount amount in naira. */
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      validate: { min: { args: [0], msg: 'Coupon amount cannot be negative' } },
      get() {
        const raw = this.getDataValue('amount');
        return raw === null || raw === undefined ? raw : Number(raw);
      }
    },
    startsAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    /** Denormalized redemption counter (drives admin usage stats). */
    usedCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    /** Admin user who created the coupon. */
    createdBy: {
      type: DataTypes.UUID,
      allowNull: false
    }
  }, {
    tableName: 'coupons',
    indexes: [
      { unique: true, fields: ['code'] },
      { fields: ['isActive'] },
      { fields: ['startsAt'] },
      { fields: ['expiresAt'] },
      { fields: ['createdAt'] }
    ]
  });

  /** True when the coupon can be used at the given moment. */
  Coupon.prototype.isValidAt = function isValidAt(now = new Date()) {
    return this.isActive && now >= new Date(this.startsAt) && now <= new Date(this.expiresAt);
  };

  /** Client-facing lifecycle: ACTIVE / UPCOMING / EXPIRED / INACTIVE. */
  Coupon.prototype.statusAt = function statusAt(now = new Date()) {
    if (!this.isActive) return 'INACTIVE';
    if (now < new Date(this.startsAt)) return 'UPCOMING';
    if (now > new Date(this.expiresAt)) return 'EXPIRED';
    return 'ACTIVE';
  };

  Coupon.associate = models => {
    Coupon.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
    Coupon.hasMany(models.CouponAssignment, { foreignKey: 'couponId', as: 'assignments', onDelete: 'CASCADE' });
    Coupon.hasMany(models.Order, { foreignKey: 'couponId', as: 'orders' });
  };

  return Coupon;
};