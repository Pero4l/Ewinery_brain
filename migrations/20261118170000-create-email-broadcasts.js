'use strict';

/**
 * Durable admin email broadcasts.
 *
 *  - email_broadcasts: one row per broadcast (subject, content, status).
 *  - email_broadcast_recipients: one row per customer per broadcast. The
 *    unique (broadcastId, userId) key guarantees nobody is queued twice, and
 *    the row's status records who has already received it, so sending can
 *    resume after a restart without re-sending.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.createTable('email_broadcasts', {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
        subject: { type: DataTypes.STRING(150), allowNull: false },
        content: { type: DataTypes.TEXT, allowNull: false },
        status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'RUNNING' },
        totalRecipients: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        createdBy: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL'
        },
        completedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
      }, { transaction: t });
      await queryInterface.addIndex('email_broadcasts', ['status'], { transaction: t });
      await queryInterface.addIndex('email_broadcasts', ['createdAt'], { transaction: t });

      await queryInterface.createTable('email_broadcast_recipients', {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
        broadcastId: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'email_broadcasts', key: 'id' },
          onDelete: 'CASCADE'
        },
        userId: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL'
        },
        email: { type: DataTypes.STRING(160), allowNull: false },
        name: { type: DataTypes.STRING(120), allowNull: true },
        // PENDING → SENDING → SENT | RETRY (temporary failure) | FAILED (gave up)
        status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'PENDING' },
        attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        lastError: { type: DataTypes.STRING(255), allowNull: true },
        claimedAt: { type: DataTypes.DATE, allowNull: true },
        nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
        sentAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
      }, { transaction: t });
      await queryInterface.addIndex('email_broadcast_recipients', ['broadcastId', 'userId'], {
        unique: true, name: 'email_broadcast_recipients_unique_user', transaction: t
      });
      await queryInterface.addIndex('email_broadcast_recipients', ['broadcastId', 'status'], { transaction: t });

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.dropTable('email_broadcast_recipients', { transaction: t });
      await queryInterface.dropTable('email_broadcasts', { transaction: t });
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }
};
