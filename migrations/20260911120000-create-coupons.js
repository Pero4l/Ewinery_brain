'use strict';

/**
 * Creates the coupons and coupon_assignments tables and adds a coupon
 * snapshot to orders.
 *
 * A coupon is a fixed-amount discount valid within [startsAt, expiresAt].
 * It only works for users it has explicitly been assigned to (one row per
 * coupon+user in coupon_assignments). Redeeming an assignment marks
 * redeemedAt + links the order, so each assignment is single-use.
 *
 * `orders.couponCode` is snapshotted at checkout so order history survives
 * later coupon edits or deletes (mirrors the shippingAddress pattern).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.createTable('coupons', {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        code: {
          type: DataTypes.STRING(30),
          allowNull: false
        },
        name: {
          type: DataTypes.STRING(120),
          allowNull: false
        },
        description: {
          type: DataTypes.TEXT,
          allowNull: true
        },
        amount: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: false
        },
        startsAt: {
          type: DataTypes.DATE,
          allowNull: false
        },
        expiresAt: {
          type: DataTypes.DATE,
          allowNull: false
        },
        isActive: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true
        },
        usedCount: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0
        },
        createdBy: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT'
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
      }, { transaction: t });

      await queryInterface.addIndex('coupons', ['code'], { unique: true, transaction: t });
      await queryInterface.addIndex('coupons', ['isActive'], { transaction: t });
      await queryInterface.addIndex('coupons', ['startsAt'], { transaction: t });
      await queryInterface.addIndex('coupons', ['expiresAt'], { transaction: t });
      await queryInterface.addIndex('coupons', ['createdAt'], { transaction: t });
      await queryInterface.sequelize.query(
        'ALTER TABLE coupons ADD CONSTRAINT coupons_amount_non_negative CHECK (amount >= 0)',
        { transaction: t }
      );
      await queryInterface.sequelize.query(
        'ALTER TABLE coupons ADD CONSTRAINT coupons_dates_valid CHECK ("expiresAt" > "startsAt")',
        { transaction: t }
      );

      await queryInterface.createTable('coupon_assignments', {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        couponId: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'coupons', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        userId: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        assignedBy: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        redeemedAt: {
          type: DataTypes.DATE,
          allowNull: true
        },
        orderId: {
          type: DataTypes.UUID,
          allowNull: true,
          references: { model: 'orders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
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
      }, { transaction: t });

      await queryInterface.addIndex('coupon_assignments', ['couponId', 'userId'], {
        unique: true,
        transaction: t
      });
      await queryInterface.addIndex('coupon_assignments', ['userId'], { transaction: t });
      await queryInterface.addIndex('coupon_assignments', ['couponId'], { transaction: t });
      await queryInterface.addIndex('coupon_assignments', ['redeemedAt'], { transaction: t });

      await queryInterface.addColumn('orders', 'couponId', {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'coupons', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      }, { transaction: t });
      await queryInterface.addColumn('orders', 'couponCode', {
        type: DataTypes.STRING(30),
        allowNull: true
      }, { transaction: t });
      await queryInterface.addIndex('orders', ['couponId'], { transaction: t });
      await queryInterface.addIndex('orders', ['couponCode'], { transaction: t });

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.removeIndex('orders', ['couponId'], { transaction: t });
      await queryInterface.removeIndex('orders', ['couponCode'], { transaction: t });
      await queryInterface.removeColumn('orders', 'couponId', { transaction: t });
      await queryInterface.removeColumn('orders', 'couponCode', { transaction: t });
      await queryInterface.dropTable('coupon_assignments', { transaction: t });
      await queryInterface.dropTable('coupons', { transaction: t });
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }
};