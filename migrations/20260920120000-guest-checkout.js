'use strict';

/**
 * Enables guest (non-registered) checkout.
 *
 * Guest orders have a NULL orders.userId and carry the customer's contact
 * email in orders.guestEmail (name/phone/address live in the shippingAddress
 * JSONB snapshot just like registered orders). Payments for guest orders also
 * have a NULL transactions.userId so no foreign user row is ever required.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.changeColumn('orders', 'userId', {
        type: DataTypes.UUID,
        allowNull: true
      }, { transaction: t });

      await queryInterface.addColumn('orders', 'guestEmail', {
        type: DataTypes.STRING(160),
        allowNull: true,
        comment: 'Contact email for guest (non-registered) orders'
      }, { transaction: t });
      await queryInterface.addIndex('orders', ['guestEmail'], { transaction: t });

      await queryInterface.changeColumn('transactions', 'userId', {
        type: DataTypes.UUID,
        allowNull: true
      }, { transaction: t });

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  async down(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.removeIndex('orders', ['guestEmail'], { transaction: t });
      await queryInterface.removeColumn('orders', 'guestEmail', { transaction: t });

      // Only safe to re-apply NOT NULL when no guest rows exist. If guest
      // orders exist this rolls back and surfaces the constraint violation.
      await queryInterface.changeColumn('orders', 'userId', {
        type: DataTypes.UUID,
        allowNull: false
      }, { transaction: t });
      await queryInterface.changeColumn('transactions', 'userId', {
        type: DataTypes.UUID,
        allowNull: false
      }, { transaction: t });

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }
};