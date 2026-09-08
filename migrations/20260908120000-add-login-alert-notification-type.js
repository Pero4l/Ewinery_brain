'use strict';

/**
 * Adds the LOGIN_ALERT value to the notifications.type ENUM so new-sign-in
 * alert notifications can be persisted (email channel is used today, but the
 * enum must accept the value for any future in-app usage).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      "ALTER TYPE enum_notifications_type ADD VALUE IF NOT EXISTS 'LOGIN_ALERT'"
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      "ALTER TYPE enum_notifications_type DROP VALUE IF EXISTS 'LOGIN_ALERT'"
    );
  }
};