'use strict';

/**
 * Enforces phone-number uniqueness so a user can log in by phone.
 *
 * Mirrors the existing email index: unique on live rows only, so a soft-deleted
 * account never blocks re-registration with the same phone number.
 */
module.exports = {
  async up(queryInterface) {
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX users_phone_unique_active ON users (phone) WHERE "deletedAt" IS NULL',
        { transaction: t }
      );
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_phone_unique_active');
  }
};
