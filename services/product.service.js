'use strict';

/**
 * Product service.
 *
 * Storefront routes only ever return ACTIVE, available products. Admin CRUD
 * routes manage every product. Images live on Cloudinary — only the URL and
 * public ID are stored in the database. Old Cloudinary assets are deleted
 * when an image is replaced or a product is removed.
 */
const { Op } = require('sequelize');
const { sequelize, Product, Category, Review } = require('../models');
const AppError = require('../utils/AppError');
const { uniqueSlug } = require('../utils/slugify');
const { escapeLike } = require('../utils/sanitize');
const { PRODUCT_STATUS } = require('../config/constants');
const cloudinaryService = require('./cloudinary.service');
const config = require('../config');

const slugExists = slug => Product.findOne({ where: { slug } });

const SORT_MAP = {
  newest: [['createdAt', 'DESC']],
  oldest: [['createdAt', 'ASC']],
  price_asc: [['price', 'ASC']],
  price_desc: [['price', 'DESC']],
  rating: [['averageRating', 'DESC'], ['reviewCount', 'DESC']],
  popular: [['salesCount', 'DESC']],
  name: [['name', 'ASC']]
};

const buildStorefrontWhere = (filters = {}) => {
  const where = { status: PRODUCT_STATUS.ACTIVE, isAvailable: true };

  if (filters.category) {
    where.categoryId = filters.category;
  }

  if (filters.search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${escapeLike(filters.search)}%` } },
      { description: { [Op.iLike]: `%${escapeLike(filters.search)}%` } },
      { brand: { [Op.iLike]: `%${escapeLike(filters.search)}%` } }
    ];
  }

  if (filters.brand) {
    where.brand = { [Op.iLike]: `%${escapeLike(filters.brand)}%` };
  }

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    where.price = {};
    if (filters.minPrice !== undefined) where.price[Op.gte] = filters.minPrice;
    if (filters.maxPrice !== undefined) where.price[Op.lte] = filters.maxPrice;
  }

  if (filters.inStock === true) {
    where.stockQuantity = { [Op.gt]: 0 };
  }

  return where;
};

/** Storefront listing with pagination, search, filters and sorting. */
const listProducts = async (filters = {}, paging = {}) => {
  const where = buildStorefrontWhere(filters);
  const order = SORT_MAP[filters.sort] || SORT_MAP.newest;

  if (filters.category) {
    // Category supplied as id or slug; resolve to id to keep index usage.
    const category = await Category.findOne({
      where: {
        ...(String(filters.category).length === 36 ? { id: filters.category } : { slug: filters.category }),
        isActive: true
      },
      attributes: ['id']
    });
    if (!category) {
      return { rows: [], count: 0 };
    }
    where.categoryId = category.id;
  }

  const result = await Product.findAndCountAll({
    where,
    order,
    limit: paging.limit,
    offset: paging.offset,
    attributes: { exclude: ['createdBy', 'imagePublicId'] }
  });
  return result;
};

/** Single public product by id or slug. */
const getPublicProduct = async (productIdOrSlug) => {
  const where = {
    status: PRODUCT_STATUS.ACTIVE,
    isAvailable: true,
    ...(String(productIdOrSlug).length === 36 ? { id: productIdOrSlug } : { slug: productIdOrSlug })
  };

  const product = await Product.findOne({
    where,
    include: [
      { model: Category, as: 'category', attributes: ['id', 'name', 'slug'] }
    ]
  });
  if (!product) throw AppError.notFound('Product not found.');
  return product;
};

/** Validates that a product exists and is currently purchasable. */
const assertPurchasable = async (productId, quantity = 1, options = {}) => {
  const product = await Product.findByPk(productId, { ...options });
  if (!product) {
    throw AppError.notFound('Product not found.');
  }
  if (!product.isPurchasable(quantity)) {
    throw AppError.badRequest(`"${product.name}" is not available in the requested quantity.`);
  }
  return product;
};

// --------------------------------------------------------------------------
// Admin CRUD
// --------------------------------------------------------------------------

/** Admin listing — can include drafts/archived/hidden products. */
const listProductsAdmin = async (filters = {}, paging = {}) => {
  const where = {};

  if (filters.status) where.status = filters.status;
  if (filters.category) where.categoryId = filters.category;
  if (filters.search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${escapeLike(filters.search)}%` } },
      { sku: { [Op.iLike]: `%${escapeLike(filters.search)}%` } }
    ];
  }

  const result = await Product.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: paging.limit,
    offset: paging.offset,
    include: [{ model: Category, as: 'category', attributes: ['id', 'name', 'slug'] }]
  });
  return result;
};

const getProductAdmin = async productId => {
  const product = await Product.findByPk(productId, {
    include: [{ model: Category, as: 'category' }]
  });
  if (!product) throw AppError.notFound('Product not found.');
  return product;
};

const createProduct = async ({ payload, createdBy, image, gallery }) => {
  return sequelize.transaction(async transaction => {
    const slug = await uniqueSlug(payload.name, async s => Boolean(await slugExists(s)));

    let imageUrl = null;
    let imagePublicId = null;
    if (image?.buffer) {
      const upload = await cloudinaryService.uploadImage(image.buffer, { resource: 'products' });
      imageUrl = upload.url;
      imagePublicId = upload.publicId;
    }

    let galleryItems = [];
    if (Array.isArray(gallery) && gallery.length) {
      const uploads = await cloudinaryService.uploadImages(gallery.map(g => g.buffer), { resource: 'products' });
      galleryItems = uploads.map(u => ({ url: u.url, publicId: u.publicId }));
    }

    const product = await Product.create(
      {
        ...payload,
        slug,
        imageUrl,
        imagePublicId,
        gallery: galleryItems,
        createdBy: createdBy || null
      },
      { transaction }
    );

    return product;
  });
};

const updateProduct = async ({ productId, payload, image, gallery }) => {
  return sequelize.transaction(async transaction => {
    const product = await Product.findByPk(productId, {
      transaction,
      include: [{ model: Category, as: 'category' }]
    });
    if (!product) throw AppError.notFound('Product not found.');

    if (payload.name && payload.name !== product.name) {
      payload.slug = await uniqueSlug(payload.name, async s => Boolean(
        await Product.findOne({ where: { slug: s, id: { [Op.ne]: product.id } }, transaction })));
    }

    // Replace primary image and delete the old Cloudinary asset.
    if (image?.buffer) {
      const upload = await cloudinaryService.uploadImage(image.buffer, { resource: 'products' });
      if (product.imagePublicId) {
        await cloudinaryService.deleteImage(product.imagePublicId);
      }
      payload.imageUrl = upload.url;
      payload.imagePublicId = upload.publicId;
    }

    // Replace gallery images (delete old assets when new ones are provided).
    if (Array.isArray(gallery) && gallery.length) {
      const buffers = gallery.map(g => g.buffer).filter(Boolean);
      if (buffers.length) {
        const uploads = await cloudinaryService.uploadImages(buffers, { resource: 'products' });
        await cloudinaryService.deleteImages(product.gallery);
        payload.gallery = uploads.map(u => ({ url: u.url, publicId: u.publicId }));
      }
    }

    await product.update(payload, { transaction });
    return product;
  });
};

const deleteProduct = async productId => {
  return sequelize.transaction(async transaction => {
    const product = await Product.findByPk(productId, { transaction });
    if (!product) throw AppError.notFound('Product not found.');

    await product.destroy({ transaction });

    // Best-effort cleanup of Cloudinary assets after the DB row is gone.
    if (product.imagePublicId) await cloudinaryService.deleteImage(product.imagePublicId);
    await cloudinaryService.deleteImages(product.gallery);
    return null;
  });
};

/** Adjusts stock; returns the product with the new quantity. */
const updateStock = async ({ productId, quantity, isAvailable, status }) => {
  const product = await Product.findByPk(productId);
  if (!product) throw AppError.notFound('Product not found.');

  const patch = {};
  if (quantity !== undefined) patch.stockQuantity = Math.max(0, quantity);
  if (isAvailable !== undefined) patch.isAvailable = isAvailable;
  if (status !== undefined) patch.status = status;

  await product.update(patch);
  return Product.findByPk(productId);
};

/** Denormalized availability alerts for the admin dashboard. */
const lowStockProducts = async (threshold = config.store.lowStockThreshold) => {
  return Product.findAll({
    where: {
      status: PRODUCT_STATUS.ACTIVE,
      isAvailable: true,
      stockQuantity: { [Op.lte]: threshold }
    },
    attributes: ['id', 'name', 'slug', 'sku', 'stockQuantity', 'imageUrl'],
    order: [['stockQuantity', 'ASC']],
    limit: 50
  });
};

module.exports = {
  listProducts,
  getPublicProduct,
  assertPurchasable,
  listProductsAdmin,
  getProductAdmin,
  createProduct,
  updateProduct,
  deleteProduct,
  updateStock,
  lowStockProducts
};