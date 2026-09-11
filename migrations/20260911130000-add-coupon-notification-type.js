'use strict';

/**
 * Adds the COUPON_ASSIGNED value to the notifications.type ENUM so coupon
 * assignment notifications (promo channel/push) can be persisted.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      "ALTER TYPE enum_notifications_type ADD VALUE IF NOT EXISTS 'COUPON_ASSIGNED'"
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      "ALTER TYPE enum_notifications_type DROP VALUE IF EXISTS 'COUPON_ASSIGNED'"
    );
  }
};