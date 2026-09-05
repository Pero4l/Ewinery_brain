'use strict';

const { PRODUCT_STATUS_VALUES, PRODUCT_STATUS } = require('../config/constants');

/**
 * Drink / product.
 *
 * Money is stored as DECIMAL(12,2) — never a float — and returned as a Number
 * by the getter so JSON responses stay numeric rather than string-typed.
 */
module.exports = (sequelize, DataTypes) => {
  const Product = sequelize.define('Product', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(180),
      allowNull: false,
      validate: { notEmpty: { msg: 'Product name is required' } }
    },
    slug: {
      type: DataTypes.STRING(220),
      allowNull: false,
      unique: { msg: 'A product with this slug already exists' }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      validate: { min: { args: [0], msg: 'Price cannot be negative' } },
      get() {
        const raw = this.getDataValue('price');
        return raw === null || raw === undefined ? raw : Number(raw);
      }
    },
    /** Optional "was" price used to display a discount. */
    compareAtPrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      get() {
        const raw = this.getDataValue('compareAtPrice');
        return raw === null || raw === undefined ? raw : Number(raw);
      }
    },
    categoryId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    sku: {
      type: DataTypes.STRING(60),
      allowNull: true,
      unique: { msg: 'A product with this SKU already exists' }
    },
    imageUrl: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    imagePublicId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Cloudinary public_id of the primary image'
    },
    /** Extra gallery images: [{ url, publicId }] */
    gallery: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    stockQuantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: { min: { args: [0], msg: 'Stock quantity cannot be negative' } }
    },
    /** Admin switch: hide from the storefront without deleting. */
    isAvailable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    status: {
      type: DataTypes.ENUM(...PRODUCT_STATUS_VALUES),
      allowNull: false,
      defaultValue: PRODUCT_STATUS.ACTIVE
    },
    volumeMl: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    alcoholPercentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      get() {
        const raw = this.getDataValue('alcoholPercentage');
        return raw === null || raw === undefined ? raw : Number(raw);
      }
    },
    brand: {
      type: DataTypes.STRING(120),
      allowNull: true
    },
    country: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    /** Denormalized review aggregates, recalculated by the review service. */
    averageRating: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: false,
      defaultValue: 0,
      get() {
        return Number(this.getDataValue('averageRating') || 0);
      }
    },
    reviewCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    /** Denormalized counter of units sold, used for "popular" sorting. */
    salesCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: true
    }
  }, {
    tableName: 'products',
    paranoid: true,
    indexes: [
      { unique: true, fields: ['slug'] },
      { fields: ['categoryId'] },
      { fields: ['status', 'isAvailable'] },
      { fields: ['price'] },
      { fields: ['createdAt'] },
      { fields: ['averageRating'] },
      { fields: ['salesCount'] }
    ]
  });

  /** True when the product can actually be purchased right now. */
  Product.prototype.isPurchasable = function isPurchasable(quantity = 1) {
    return (
      this.isAvailable &&
      this.status === PRODUCT_STATUS.ACTIVE &&
      this.stockQuantity >= quantity
    );
  };

  Product.prototype.isInStock = function isInStock() {
    return this.stockQuantity > 0;
  };

  Product.associate = models => {
    Product.belongsTo(models.Category, { foreignKey: 'categoryId', as: 'category' });
    Product.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
    Product.hasMany(models.CartItem, { foreignKey: 'productId', as: 'cartItems', onDelete: 'CASCADE' });
    Product.hasMany(models.OrderItem, { foreignKey: 'productId', as: 'orderItems' });
    Product.hasMany(models.Review, { foreignKey: 'productId', as: 'reviews', onDelete: 'CASCADE' });
  };

  return Product;
};
