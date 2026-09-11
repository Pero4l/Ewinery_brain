'use strict';

/**
 * Adds the COUPON_CREATED value to the notifications.type ENUM so new-coupon
 * broadcasts (promo channel/push/email) can be persisted.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      "ALTER TYPE enum_notifications_type ADD VALUE IF NOT EXISTS 'COUPON_CREATED'"
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      "ALTER TYPE enum_notifications_type DROP VALUE IF EXISTS 'COUPON_CREATED'"
    );
  }
};