'use strict';

const crypto = require('crypto');

/**
 * Single table for every short-lived credential: refresh tokens, password
 * reset OTPs and email verification tokens.
 *
 * Only a SHA-256 hash of the secret is ever persisted, so a database leak
 * cannot be replayed against the API.
 */
const TOKEN_TYPE = {
  REFRESH: 'REFRESH',
  PASSWORD_RESET: 'PASSWORD_RESET',
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION'
};

module.exports = (sequelize, DataTypes) => {
  const AuthToken = sequelize.define('AuthToken', {
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
      type: DataTypes.ENUM(...Object.values(TOKEN_TYPE)),
      allowNull: false
    },
    /** SHA-256 hex digest of the raw token/OTP. */
    tokenHash: {
      type: DataTypes.STRING(64),
      allowNull: false
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    consumedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    /** Failed verification attempts — used to throttle OTP brute force. */
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    ipAddress: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    userAgent: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  }, {
    tableName: 'auth_tokens',
    indexes: [
      { fields: ['tokenHash'] },
      { fields: ['userId', 'type'] },
      { fields: ['expiresAt'] }
    ]
  });

  /** Hashes a raw token so it can be compared against `tokenHash`. */
  AuthToken.hashToken = raw => crypto.createHash('sha256').update(String(raw)).digest('hex');

  AuthToken.TOKEN_TYPE = TOKEN_TYPE;

  AuthToken.prototype.isUsable = function isUsable() {
    return !this.consumedAt && this.expiresAt > new Date();
  };

  AuthToken.associate = models => {
    AuthToken.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return AuthToken;
};
