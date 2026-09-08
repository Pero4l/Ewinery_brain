'use strict';

/**
 * Creates the device_tokens table (Expo push notification registration).
 * One row per (userId, token); preferences control which categories of push
 * the user consents to.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.createTable('device_tokens', {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        userId: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        token: {
          type: DataTypes.STRING(400),
          allowNull: false
        },
        platform: {
          type: DataTypes.STRING(20),
          allowNull: false,
          defaultValue: 'ios'
        },
        preferences: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: { orderUpdates: true, promotions: true }
        },
        createdAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('NOW')
        },
        updatedAt: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('NOW')
        }
      }, { transaction });

      await queryInterface.addIndex('device_tokens', ['userId', 'token'], {
        unique: true,
        transaction
      });
      await queryInterface.addIndex('device_tokens', ['token'], { transaction });
      await queryInterface.addIndex('device_tokens', ['userId'], { transaction });

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('device_tokens');
  }
};