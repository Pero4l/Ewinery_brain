'use strict';

/**
 * Initial eWinery schema.
 *
 * Creates every table, foreign key and index in dependency order inside a
 * single transaction, so a failure leaves the database untouched.
 */
const {
  ROLE_VALUES,
  PRODUCT_STATUS_VALUES,
  ORDER_STATUS_VALUES,
  PAYMENT_STATUS_VALUES,
  TRANSACTION_STATUS_VALUES,
  PAYMENT_PROVIDER_VALUES,
  REVIEW_STATUS_VALUES,
  TICKET_STATUS_VALUES,
  TICKET_PRIORITY_VALUES,
  NOTIFICATION_CHANNEL_VALUES,
  NOTIFICATION_TYPE_VALUES,
  RESOURCE_TYPE_VALUES
} = require('../config/constants');

const AUTH_TOKEN_TYPES = ['REFRESH', 'PASSWORD_RESET', 'EMAIL_VERIFICATION'];

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const t = await queryInterface.sequelize.transaction();

    /** Shared timestamp columns. */
    const timestamps = (options = {}) => ({
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      ...(options.updatedAt === false
        ? {}
        : { updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') } }),
      ...(options.paranoid ? { deletedAt: { type: DataTypes.DATE, allowNull: true } } : {})
    });

    const fk = (table, onDelete = 'CASCADE', allowNull = false) => ({
      type: DataTypes.UUID,
      allowNull,
      references: { model: table, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete
    });

    const uuidPk = {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: Sequelize.literal('gen_random_uuid()')
    };

    try {
      // ---------------------------------------------------------------- users
      await queryInterface.createTable('users', {
        id: uuidPk,
        fullName: { type: DataTypes.STRING(120), allowNull: false },
        email: { type: DataTypes.STRING(160), allowNull: false },
        phone: { type: DataTypes.STRING(30), allowNull: false },
        passwordHash: { type: DataTypes.STRING, allowNull: false },
        role: { type: DataTypes.ENUM(...ROLE_VALUES), allowNull: false, defaultValue: 'USER' },
        isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        emailVerifiedAt: { type: DataTypes.DATE, allowNull: true },
        lastLoginAt: { type: DataTypes.DATE, allowNull: true },
        tokensValidFrom: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        ...timestamps({ paranoid: true })
      }, { transaction: t });

      // Case-insensitive uniqueness on live rows only, so a soft-deleted
      // account never blocks re-registration with the same address.
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX users_email_unique_active ON users (LOWER(email)) WHERE "deletedAt" IS NULL',
        { transaction: t }
      );
      await queryInterface.addIndex('users', ['role'], { transaction: t });
      await queryInterface.addIndex('users', ['isActive'], { transaction: t });
      await queryInterface.addIndex('users', ['createdAt'], { transaction: t });

      // ---------------------------------------------------------- auth_tokens
      await queryInterface.createTable('auth_tokens', {
        id: uuidPk,
        userId: fk('users'),
        type: { type: DataTypes.ENUM(...AUTH_TOKEN_TYPES), allowNull: false },
        tokenHash: { type: DataTypes.STRING(64), allowNull: false },
        expiresAt: { type: DataTypes.DATE, allowNull: false },
        consumedAt: { type: DataTypes.DATE, allowNull: true },
        attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        ipAddress: { type: DataTypes.STRING(64), allowNull: true },
        userAgent: { type: DataTypes.STRING(255), allowNull: true },
        ...timestamps()
      }, { transaction: t });

      await queryInterface.addIndex('auth_tokens', ['tokenHash'], { transaction: t });
      await queryInterface.addIndex('auth_tokens', ['userId', 'type'], { transaction: t });
      await queryInterface.addIndex('auth_tokens', ['expiresAt'], { transaction: t });

      // ------------------------------------------------------------ addresses
      await queryInterface.createTable('addresses', {
        id: uuidPk,
        userId: fk('users'),
        recipientName: { type: DataTypes.STRING(120), allowNull: false },
        phone: { type: DataTypes.STRING(30), allowNull: false },
        street: { type: DataTypes.STRING(255), allowNull: false },
        city: { type: DataTypes.STRING(100), allowNull: false },
        state: { type: DataTypes.STRING(100), allowNull: false },
        postalCode: { type: DataTypes.STRING(20), allowNull: true },
        country: { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'Nigeria' },
        label: { type: DataTypes.STRING(50), allowNull: true },
        deliveryInstructions: { type: DataTypes.TEXT, allowNull: true },
        isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        ...timestamps({ paranoid: true })
      }, { transaction: t });

      await queryInterface.addIndex('addresses', ['userId'], { transaction: t });
      // At most one default address per user (live rows only).
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX addresses_one_default_per_user ON addresses ("userId") ' +
        'WHERE "isDefault" = true AND "deletedAt" IS NULL',
        { transaction: t }
      );

      // ----------------------------------------------------------- categories
      await queryInterface.createTable('categories', {
        id: uuidPk,
        name: { type: DataTypes.STRING(100), allowNull: false },
        slug: { type: DataTypes.STRING(120), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        imageUrl: { type: DataTypes.STRING(500), allowNull: true },
        imagePublicId: { type: DataTypes.STRING(255), allowNull: true },
        isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        ...timestamps({ paranoid: true })
      }, { transaction: t });

      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX categories_slug_unique_active ON categories (slug) WHERE "deletedAt" IS NULL',
        { transaction: t }
      );
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX categories_name_unique_active ON categories (LOWER(name)) WHERE "deletedAt" IS NULL',
        { transaction: t }
      );
      await queryInterface.addIndex('categories', ['isActive'], { transaction: t });

      // ------------------------------------------------------------- products
      await queryInterface.createTable('products', {
        id: uuidPk,
        name: { type: DataTypes.STRING(180), allowNull: false },
        slug: { type: DataTypes.STRING(220), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        compareAtPrice: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
        categoryId: fk('categories', 'RESTRICT'),
        sku: { type: DataTypes.STRING(60), allowNull: true },
        imageUrl: { type: DataTypes.STRING(500), allowNull: true },
        imagePublicId: { type: DataTypes.STRING(255), allowNull: true },
        gallery: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
        stockQuantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        isAvailable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        status: { type: DataTypes.ENUM(...PRODUCT_STATUS_VALUES), allowNull: false, defaultValue: 'ACTIVE' },
        volumeMl: { type: DataTypes.INTEGER, allowNull: true },
        alcoholPercentage: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
        brand: { type: DataTypes.STRING(120), allowNull: true },
        country: { type: DataTypes.STRING(100), allowNull: true },
        averageRating: { type: DataTypes.DECIMAL(3, 2), allowNull: false, defaultValue: 0 },
        reviewCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        salesCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        createdBy: fk('users', 'SET NULL', true),
        ...timestamps({ paranoid: true })
      }, { transaction: t });

      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX products_slug_unique_active ON products (slug) WHERE "deletedAt" IS NULL',
        { transaction: t }
      );
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX products_sku_unique_active ON products (sku) WHERE sku IS NOT NULL AND "deletedAt" IS NULL',
        { transaction: t }
      );
      await queryInterface.addIndex('products', ['categoryId'], { transaction: t });
      await queryInterface.addIndex('products', ['status', 'isAvailable'], { transaction: t });
      await queryInterface.addIndex('products', ['price'], { transaction: t });
      await queryInterface.addIndex('products', ['createdAt'], { transaction: t });
      await queryInterface.addIndex('products', ['averageRating'], { transaction: t });
      await queryInterface.addIndex('products', ['salesCount'], { transaction: t });
      // Stock can never go negative, even under a raw/concurrent update.
      await queryInterface.sequelize.query(
        'ALTER TABLE products ADD CONSTRAINT products_stock_non_negative CHECK ("stockQuantity" >= 0)',
        { transaction: t }
      );
      await queryInterface.sequelize.query(
        'ALTER TABLE products ADD CONSTRAINT products_price_non_negative CHECK (price >= 0)',
        { transaction: t }
      );
      // Trigram + full text search support for the storefront search endpoint.
      await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS pg_trgm', { transaction: t });
      await queryInterface.sequelize.query(
        'CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops)',
        { transaction: t }
      );

      // ---------------------------------------------------------------- carts
      await queryInterface.createTable('carts', {
        id: uuidPk,
        userId: fk('users'),
        ...timestamps()
      }, { transaction: t });

      await queryInterface.addConstraint('carts', {
        fields: ['userId'],
        type: 'unique',
        name: 'carts_user_unique',
        transaction: t
      });

      // ----------------------------------------------------------- cart_items
      await queryInterface.createTable('cart_items', {
        id: uuidPk,
        cartId: fk('carts'),
        productId: fk('products'),
        quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        ...timestamps()
      }, { transaction: t });

      await queryInterface.addIndex('cart_items', ['cartId'], { transaction: t });
      await queryInterface.addConstraint('cart_items', {
        fields: ['cartId', 'productId'],
        type: 'unique',
        name: 'cart_items_cart_product_unique',
        transaction: t
      });
      await queryInterface.sequelize.query(
        'ALTER TABLE cart_items ADD CONSTRAINT cart_items_quantity_positive CHECK (quantity > 0)',
        { transaction: t }
      );

      // --------------------------------------------------------------- orders
      await queryInterface.createTable('orders', {
        id: uuidPk,
        orderNumber: { type: DataTypes.STRING(30), allowNull: false, unique: true },
        userId: fk('users', 'RESTRICT'),
        addressId: fk('addresses', 'SET NULL', true),
        shippingAddress: { type: DataTypes.JSONB, allowNull: false },
        status: { type: DataTypes.ENUM(...ORDER_STATUS_VALUES), allowNull: false, defaultValue: 'PENDING' },
        paymentStatus: { type: DataTypes.ENUM(...PAYMENT_STATUS_VALUES), allowNull: false, defaultValue: 'PENDING' },
        subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        deliveryFee: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        discount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        totalAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'NGN' },
        itemCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        customerNote: { type: DataTypes.TEXT, allowNull: true },
        adminNote: { type: DataTypes.TEXT, allowNull: true },
        cancelReason: { type: DataTypes.STRING(255), allowNull: true },
        paidAt: { type: DataTypes.DATE, allowNull: true },
        processingAt: { type: DataTypes.DATE, allowNull: true },
        readyAt: { type: DataTypes.DATE, allowNull: true },
        dispatchedAt: { type: DataTypes.DATE, allowNull: true },
        deliveredAt: { type: DataTypes.DATE, allowNull: true },
        completedAt: { type: DataTypes.DATE, allowNull: true },
        cancelledAt: { type: DataTypes.DATE, allowNull: true },
        stockCommitted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        ...timestamps()
      }, { transaction: t });

      await queryInterface.addIndex('orders', ['userId'], { transaction: t });
      await queryInterface.addIndex('orders', ['status'], { transaction: t });
      await queryInterface.addIndex('orders', ['paymentStatus'], { transaction: t });
      await queryInterface.addIndex('orders', ['createdAt'], { transaction: t });
      await queryInterface.addIndex('orders', ['userId', 'status'], { transaction: t });
      await queryInterface.sequelize.query(
        'ALTER TABLE orders ADD CONSTRAINT orders_amounts_non_negative CHECK ' +
        '(subtotal >= 0 AND "deliveryFee" >= 0 AND discount >= 0 AND "totalAmount" >= 0)',
        { transaction: t }
      );

      // ---------------------------------------------------------- order_items
      await queryInterface.createTable('order_items', {
        id: uuidPk,
        orderId: fk('orders'),
        productId: fk('products', 'SET NULL', true),
        productName: { type: DataTypes.STRING(180), allowNull: false },
        productImageUrl: { type: DataTypes.STRING(500), allowNull: true },
        unitPrice: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        quantity: { type: DataTypes.INTEGER, allowNull: false },
        lineTotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        ...timestamps()
      }, { transaction: t });

      await queryInterface.addIndex('order_items', ['orderId'], { transaction: t });
      await queryInterface.addIndex('order_items', ['productId'], { transaction: t });
      await queryInterface.sequelize.query(
        'ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0)',
        { transaction: t }
      );

      // -------------------------------------------------- order_status_history
      await queryInterface.createTable('order_status_history', {
        id: uuidPk,
        orderId: fk('orders'),
        fromStatus: { type: DataTypes.ENUM(...ORDER_STATUS_VALUES), allowNull: true },
        toStatus: { type: DataTypes.ENUM(...ORDER_STATUS_VALUES), allowNull: false },
        changedBy: fk('users', 'SET NULL', true),
        note: { type: DataTypes.STRING(255), allowNull: true },
        ...timestamps({ updatedAt: false })
      }, { transaction: t });

      await queryInterface.addIndex('order_status_history', ['orderId', 'createdAt'], { transaction: t });

      // --------------------------------------------------------- transactions
      await queryInterface.createTable('transactions', {
        id: uuidPk,
        reference: { type: DataTypes.STRING(80), allowNull: false, unique: true },
        orderId: fk('orders', 'RESTRICT'),
        userId: fk('users', 'RESTRICT'),
        provider: { type: DataTypes.ENUM(...PAYMENT_PROVIDER_VALUES), allowNull: false, defaultValue: 'PAYSTACK' },
        providerTransactionId: { type: DataTypes.STRING(80), allowNull: true },
        status: { type: DataTypes.ENUM(...TRANSACTION_STATUS_VALUES), allowNull: false, defaultValue: 'PENDING' },
        amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'NGN' },
        channel: { type: DataTypes.STRING(40), allowNull: true },
        paidAt: { type: DataTypes.DATE, allowNull: true },
        processedAt: { type: DataTypes.DATE, allowNull: true },
        authorizationUrl: { type: DataTypes.STRING(500), allowNull: true },
        accessCode: { type: DataTypes.STRING(120), allowNull: true },
        failureReason: { type: DataTypes.STRING(255), allowNull: true },
        providerResponse: { type: DataTypes.JSONB, allowNull: true },
        verifiedVia: { type: DataTypes.STRING(20), allowNull: true },
        ...timestamps()
      }, { transaction: t });

      await queryInterface.addIndex('transactions', ['orderId'], { transaction: t });
      await queryInterface.addIndex('transactions', ['userId'], { transaction: t });
      await queryInterface.addIndex('transactions', ['status'], { transaction: t });
      await queryInterface.addIndex('transactions', ['createdAt'], { transaction: t });

      // -------------------------------------------------------------- reviews
      await queryInterface.createTable('reviews', {
        id: uuidPk,
        productId: fk('products'),
        userId: fk('users'),
        orderId: fk('orders', 'SET NULL', true),
        orderItemId: fk('order_items', 'SET NULL', true),
        rating: { type: DataTypes.INTEGER, allowNull: false },
        title: { type: DataTypes.STRING(140), allowNull: true },
        comment: { type: DataTypes.TEXT, allowNull: true },
        status: { type: DataTypes.ENUM(...REVIEW_STATUS_VALUES), allowNull: false, defaultValue: 'APPROVED' },
        isVerifiedPurchase: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        moderationNote: { type: DataTypes.STRING(255), allowNull: true },
        editedAt: { type: DataTypes.DATE, allowNull: true },
        ...timestamps({ paranoid: true })
      }, { transaction: t });

      await queryInterface.addIndex('reviews', ['productId', 'status', 'createdAt'], { transaction: t });
      await queryInterface.addIndex('reviews', ['userId'], { transaction: t });
      // One live review per user per product.
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX reviews_user_product_unique_active ON reviews ("userId", "productId") ' +
        'WHERE "deletedAt" IS NULL',
        { transaction: t }
      );
      await queryInterface.sequelize.query(
        'ALTER TABLE reviews ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5)',
        { transaction: t }
      );

      // ------------------------------------------------------ support_tickets
      await queryInterface.createTable('support_tickets', {
        id: uuidPk,
        ticketNumber: { type: DataTypes.STRING(30), allowNull: false, unique: true },
        userId: fk('users'),
        subject: { type: DataTypes.STRING(180), allowNull: false },
        status: { type: DataTypes.ENUM(...TICKET_STATUS_VALUES), allowNull: false, defaultValue: 'OPEN' },
        priority: { type: DataTypes.ENUM(...TICKET_PRIORITY_VALUES), allowNull: false, defaultValue: 'MEDIUM' },
        assignedTo: fk('users', 'SET NULL', true),
        assignedAt: { type: DataTypes.DATE, allowNull: true },
        orderId: fk('orders', 'SET NULL', true),
        lastMessageAt: { type: DataTypes.DATE, allowNull: true },
        unreadForUser: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        unreadForAdmin: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        resolvedAt: { type: DataTypes.DATE, allowNull: true },
        closedAt: { type: DataTypes.DATE, allowNull: true },
        ...timestamps()
      }, { transaction: t });

      await queryInterface.addIndex('support_tickets', ['userId'], { transaction: t });
      await queryInterface.addIndex('support_tickets', ['status'], { transaction: t });
      await queryInterface.addIndex('support_tickets', ['assignedTo'], { transaction: t });
      await queryInterface.addIndex('support_tickets', ['lastMessageAt'], { transaction: t });

      // -------------------------------------------------- support_messages
      await queryInterface.createTable('support_messages', {
        id: uuidPk,
        ticketId: fk('support_tickets'),
        senderId: fk('users', 'RESTRICT'),
        senderRole: { type: DataTypes.STRING(10), allowNull: false },
        message: { type: DataTypes.TEXT, allowNull: false },
        isInternalNote: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        readAt: { type: DataTypes.DATE, allowNull: true },
        ...timestamps()
      }, { transaction: t });

      await queryInterface.addIndex('support_messages', ['ticketId', 'createdAt'], { transaction: t });
      await queryInterface.addIndex('support_messages', ['senderId'], { transaction: t });

      // -------------------------------------------------------- notifications
      await queryInterface.createTable('notifications', {
        id: uuidPk,
        userId: fk('users'),
        type: { type: DataTypes.ENUM(...NOTIFICATION_TYPE_VALUES), allowNull: false },
        channel: { type: DataTypes.ENUM(...NOTIFICATION_CHANNEL_VALUES), allowNull: false, defaultValue: 'IN_APP' },
        title: { type: DataTypes.STRING(180), allowNull: false },
        message: { type: DataTypes.TEXT, allowNull: false },
        resourceType: { type: DataTypes.ENUM(...RESOURCE_TYPE_VALUES), allowNull: true },
        resourceId: { type: DataTypes.UUID, allowNull: true },
        data: { type: DataTypes.JSONB, allowNull: true },
        readAt: { type: DataTypes.DATE, allowNull: true },
        ...timestamps()
      }, { transaction: t });

      await queryInterface.addIndex('notifications', ['userId', 'readAt'], { transaction: t });
      await queryInterface.addIndex('notifications', ['userId', 'createdAt'], { transaction: t });
      await queryInterface.addIndex('notifications', ['type'], { transaction: t });
      await queryInterface.addIndex('notifications', ['resourceType', 'resourceId'], { transaction: t });

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const t = await queryInterface.sequelize.transaction();

    // Reverse dependency order.
    const tables = [
      'notifications',
      'support_messages',
      'support_tickets',
      'reviews',
      'transactions',
      'order_status_history',
      'order_items',
      'orders',
      'cart_items',
      'carts',
      'products',
      'categories',
      'addresses',
      'auth_tokens',
      'users'
    ];

    try {
      for (const table of tables) {
        await queryInterface.dropTable(table, { transaction: t, cascade: true });
      }

      // Drop the ENUM types Postgres created for each table.
      const enums = [
        'enum_users_role',
        'enum_auth_tokens_type',
        'enum_products_status',
        'enum_orders_status',
        'enum_orders_paymentStatus',
        'enum_order_status_history_fromStatus',
        'enum_order_status_history_toStatus',
        'enum_transactions_provider',
        'enum_transactions_status',
        'enum_reviews_status',
        'enum_support_tickets_status',
        'enum_support_tickets_priority',
        'enum_notifications_type',
        'enum_notifications_channel',
        'enum_notifications_resourceType'
      ];

      for (const name of enums) {
        await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${name}"`, { transaction: t });
      }

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }
};
