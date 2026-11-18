'use strict';

/**
 * Admin-controlled delivery pricing + per-user notification preferences.
 *
 *  - delivery_settings: single row (id = 1) seeded from the current env/config
 *    values (DELIVERY_FEE / FREE_DELIVERY_THRESHOLD, default 1500 / 50000), so
 *    pricing does not change on deploy.
 *  - delivery_zones: optional per-state / per-city overrides.
 *  - orders.deliveryZoneName: snapshot of the zone used to price the order.
 *  - users.notificationPreferences: account-level switches. Existing users keep
 *    the push switches of their most recently updated device token (so nobody
 *    silently loses or gains pushes); emailPromotions starts off for everyone.
 */
const DEFAULT_PREFS = { orderUpdates: true, promotions: false, emailPromotions: false };

const toInt = (value, fallback) => {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.createTable('delivery_settings', {
        id: { type: DataTypes.INTEGER, primaryKey: true },
        isDeliveryEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        defaultFee: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1500 },
        freeDeliveryThreshold: { type: DataTypes.INTEGER, allowNull: true },
        estimatedDeliveryText: { type: DataTypes.STRING(120), allowNull: true },
        updatedBy: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL'
        },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
      }, { transaction: t });

      const now = new Date();
      await queryInterface.bulkInsert('delivery_settings', [{
        id: 1,
        isDeliveryEnabled: true,
        defaultFee: toInt(process.env.DELIVERY_FEE, 1500),
        freeDeliveryThreshold: toInt(process.env.FREE_DELIVERY_THRESHOLD, 50000),
        estimatedDeliveryText: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now
      }], { transaction: t });

      await queryInterface.createTable('delivery_zones', {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
        name: { type: DataTypes.STRING(100), allowNull: false },
        state: { type: DataTypes.STRING(100), allowNull: false },
        cities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
        fee: { type: DataTypes.INTEGER, allowNull: false },
        freeDeliveryThreshold: { type: DataTypes.INTEGER, allowNull: true },
        estimatedDeliveryText: { type: DataTypes.STRING(120), allowNull: true },
        isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
      }, { transaction: t });
      await queryInterface.addIndex('delivery_zones', ['state'], { transaction: t });
      await queryInterface.addIndex('delivery_zones', ['isActive', 'sortOrder'], { transaction: t });

      await queryInterface.addColumn('orders', 'deliveryZoneName', {
        type: DataTypes.STRING(100),
        allowNull: true
      }, { transaction: t });

      await queryInterface.addColumn('users', 'notificationPreferences', {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: DEFAULT_PREFS
      }, { transaction: t });

      // Carry over each user's latest device-token push switches.
      await queryInterface.sequelize.query(`
        UPDATE users u
           SET "notificationPreferences" = jsonb_build_object(
                 'orderUpdates', COALESCE((dt.preferences->>'orderUpdates')::boolean, true),
                 'promotions',   COALESCE((dt.preferences->>'promotions')::boolean, false),
                 'emailPromotions', false)
          FROM (
            SELECT DISTINCT ON ("userId") "userId", preferences
              FROM device_tokens
             ORDER BY "userId", "updatedAt" DESC
          ) dt
         WHERE dt."userId" = u.id
      `, { transaction: t });

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.removeColumn('users', 'notificationPreferences', { transaction: t });
      await queryInterface.removeColumn('orders', 'deliveryZoneName', { transaction: t });
      await queryInterface.dropTable('delivery_zones', { transaction: t });
      await queryInterface.dropTable('delivery_settings', { transaction: t });
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }
};
