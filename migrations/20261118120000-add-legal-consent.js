'use strict';

/**
 * Legal consent audit trail.
 *
 * Records when (server time) a customer accepted the Terms and confirmed they
 * are of legal drinking age, which Terms version they accepted, and the IP /
 * user-agent of the request — on the user (registration, re-acceptance) and on
 * guest orders (checkout without an account).
 */
const consentColumns = DataTypes => ({
  termsAcceptedAt: { type: DataTypes.DATE, allowNull: true },
  termsVersion: { type: DataTypes.STRING(32), allowNull: true },
  ageConfirmedAt: { type: DataTypes.DATE, allowNull: true },
  consentIpAddress: { type: DataTypes.STRING(64), allowNull: true },
  consentUserAgent: { type: DataTypes.STRING(255), allowNull: true }
});

const TABLES = ['users', 'orders'];

module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      for (const table of TABLES) {
        const columns = consentColumns(Sequelize.DataTypes);
        for (const [name, definition] of Object.entries(columns)) {
          await queryInterface.addColumn(table, name, definition, { transaction: t });
        }
      }
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  async down(queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      for (const table of TABLES) {
        for (const name of Object.keys(consentColumns(Sequelize.DataTypes))) {
          await queryInterface.removeColumn(table, name, { transaction: t });
        }
      }
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }
};
