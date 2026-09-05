'use strict';

const bcrypt = require('bcrypt');
const config = require('../config');
const { ROLE_VALUES, ROLES } = require('../config/constants');

/**
 * User account.
 *
 * `passwordHash` is excluded from queries by the `defaultScope` so a plain
 * `findAll`/`findByPk` can never accidentally serialize it to a response.
 * Use the `withPassword` scope when a hash is genuinely needed (login).
 */
module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    fullName: {
      type: DataTypes.STRING(120),
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Full name is required' },
        len: { args: [2, 120], msg: 'Full name must be between 2 and 120 characters' }
      }
    },
    email: {
      type: DataTypes.STRING(160),
      allowNull: false,
      unique: { msg: 'An account with this email already exists' },
      validate: {
        isEmail: { msg: 'A valid email address is required' }
      },
      set(value) {
        this.setDataValue('email', typeof value === 'string' ? value.trim().toLowerCase() : value);
      }
    },
    phone: {
      type: DataTypes.STRING(30),
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Phone number is required' }
      }
    },
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    role: {
      type: DataTypes.ENUM(...ROLE_VALUES),
      allowNull: false,
      defaultValue: ROLES.USER
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    emailVerifiedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    /** Any access token issued before this moment is rejected (logout-all / password change). */
    tokensValidFrom: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'users',
    paranoid: true,
    defaultScope: {
      attributes: { exclude: ['passwordHash'] }
    },
    scopes: {
      withPassword: { attributes: { include: ['passwordHash'] } },
      admins: { where: { role: ROLES.ADMIN, isActive: true } },
      active: { where: { isActive: true } }
    },
    indexes: [
      { unique: true, fields: ['email'] },
      { fields: ['role'] },
      { fields: ['isActive'] },
      { fields: ['createdAt'] }
    ]
  });

  User.prototype.isEmailVerified = function isEmailVerified() {
    return Boolean(this.emailVerifiedAt);
  };

  User.prototype.isAdmin = function isAdmin() {
    return this.role === ROLES.ADMIN;
  };

  /** Timing-safe password check. Returns false when no hash is loaded. */
  User.prototype.verifyPassword = async function verifyPassword(plainPassword) {
    if (!this.passwordHash || !plainPassword) return false;
    return bcrypt.compare(plainPassword, this.passwordHash);
  };

  /** Hashes and assigns a new password (does not save). */
  User.prototype.setPassword = async function setPassword(plainPassword) {
    this.passwordHash = await bcrypt.hash(plainPassword, config.security.bcryptRounds);
    // Invalidate every previously issued token.
    this.tokensValidFrom = new Date();
  };

  /** Client-safe representation. */
  User.prototype.toPublicJSON = function toPublicJSON() {
    return {
      id: this.id,
      fullName: this.fullName,
      email: this.email,
      phone: this.phone,
      role: this.role,
      isActive: this.isActive,
      isEmailVerified: this.isEmailVerified(),
      lastLoginAt: this.lastLoginAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  };

  User.associate = models => {
    User.hasMany(models.Address, { foreignKey: 'userId', as: 'addresses', onDelete: 'CASCADE' });
    User.hasMany(models.AuthToken, { foreignKey: 'userId', as: 'authTokens', onDelete: 'CASCADE' });
    User.hasOne(models.Cart, { foreignKey: 'userId', as: 'cart', onDelete: 'CASCADE' });
    User.hasMany(models.Order, { foreignKey: 'userId', as: 'orders' });
    User.hasMany(models.Transaction, { foreignKey: 'userId', as: 'transactions' });
    User.hasMany(models.Review, { foreignKey: 'userId', as: 'reviews', onDelete: 'CASCADE' });
    User.hasMany(models.SupportTicket, { foreignKey: 'userId', as: 'supportTickets' });
    User.hasMany(models.SupportMessage, { foreignKey: 'senderId', as: 'supportMessages' });
    User.hasMany(models.Notification, { foreignKey: 'userId', as: 'notifications', onDelete: 'CASCADE' });
  };

  return User;
};
