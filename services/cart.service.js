'use strict';

/**
 * Cart service.
 *
 * One persistent cart per user. Line items store only productId + quantity —
 * prices are resolved from the products table on every read, so a stale or
 * tampered cart can never influence the amount a customer is charged.
 */
const { Op } = require('sequelize');
const { sequelize, Cart, CartItem, Product } = require('../models');
const config = require('../config');
const AppError = require('../utils/AppError');
const { sum } = require('../utils/money');
const { PRODUCT_STATUS } = require('../config/constants');

const PRODUCT_ATTRS = [
  'id', 'name', 'slug', 'price', 'imageUrl', 'gallery', 'stockQuantity', 'isAvailable', 'status'
];

/** Primary image URL: gallery[0].url falls back to imageUrl, and vice versa. */
const primaryImage = product => {
  const galleryUrl = Array.isArray(product?.gallery) && product.gallery.length
    ? product.gallery[0].url
    : null;
  return product?.imageUrl || galleryUrl;
};

const getOrCreateCart = async (userId, options = {}) => {
  const existing = await Cart.findOne({ where: { userId }, ...options });
  if (existing) return existing;
  try {
    return await Cart.create({ userId }, options);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return Cart.findOne({ where: { userId }, ...options });
    }
    throw err;
  }
};

const fetchItems = async (cartId) =>
  CartItem.findAll({
    where: { cartId },
    include: [{ model: Product, as: 'product', attributes: PRODUCT_ATTRS }],
    order: [['createdAt', 'ASC']]
  });

/** Full cart with live product prices and computed totals. */
const getCart = async userId => {
  const cart = await getOrCreateCart(userId);
  let items = await fetchItems(cart.id);

  // Drop stale line items whose product no longer exists.
  const valid = items.filter(i => i.product);
  if (valid.length !== items.length) {
    const staleIds = items.filter(i => !i.product).map(i => i.id);
    await CartItem.destroy({ where: { id: { [Op.in]: staleIds } } });
    items = valid;
  }

  const enrich = items.map(item => {
    const unitPrice = item.product.price;
    const lineTotal = Number((unitPrice * item.quantity).toFixed(2));
    const product = item.product.toJSON();
    product.imageUrl = primaryImage(product);
    return {
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      product,
      unitPrice,
      lineTotal
    };
  });

  const subtotal = sum(enrich.map(e => e.lineTotal));
  const itemCount = enrich.reduce((acc, e) => acc + e.quantity, 0);
  const deliveryFee = subtotal >= (config.store.freeDeliveryThreshold || 0)
    ? 0
    : (config.store.deliveryFee || 0);
  const grandTotal = sum(subtotal, deliveryFee);

  return {
    id: cart.id,
    items: enrich,
    subtotal,
    deliveryFee,
    grandTotal,
    itemCount,
    currency: config.store.currency
  };
};

const addItem = async ({ userId, productId, quantity = 1 }) => {
  const product = await Product.findByPk(productId);
  if (!product) throw AppError.notFound('Product not found.');
  if (!product.isAvailable || product.status !== PRODUCT_STATUS.ACTIVE) {
    throw AppError.badRequest('This product is not currently available for purchase.');
  }

  await sequelize.transaction(async transaction => {
    const cart = await getOrCreateCart(userId, { transaction });
    const existing = await CartItem.findOne({
      where: { cartId: cart.id, productId },
      transaction
    });

    const current = existing ? existing.quantity : 0;
    const newQuantity = Math.min(config.store.maxCartItemQuantity, current + quantity);

    if (!product.isPurchasable(newQuantity)) {
      throw AppError.badRequest(`Only ${product.stockQuantity} unit(s) of "${product.name}" are in stock.`);
    }

    if (existing) {
      await existing.update({ quantity: newQuantity }, { transaction });
    } else {
      await CartItem.create({ cartId: cart.id, productId, quantity: newQuantity }, { transaction });
    }
  });

  return getCart(userId);
};

const updateItem = async ({ userId, itemId, quantity }) => {
  const item = await CartItem.findByPk(itemId, {
    include: [{ model: Cart, as: 'cart' }, { model: Product, as: 'product' }]
  });
  if (!item || item.cart.userId !== userId) {
    throw AppError.notFound('Cart item not found.');
  }

  const product = item.product;
  if (!product || !product.isPurchasable(quantity)) {
    throw AppError.badRequest(`Only ${product?.stockQuantity || 0} unit(s) of this product are in stock.`);
  }

  await item.update({ quantity });
  return getCart(userId);
};

const removeItem = async ({ userId, itemId }) => {
  const item = await CartItem.findByPk(itemId, {
    include: [{ model: Cart, as: 'cart' }]
  });
  if (!item || item.cart.userId !== userId) {
    throw AppError.notFound('Cart item not found.');
  }
  await item.destroy();
  return getCart(userId);
};

const clearCart = async userId => {
  const cart = await getOrCreateCart(userId);
  await CartItem.destroy({ where: { cartId: cart.id } });
  return getCart(userId);
};

module.exports = { getCart, addItem, updateItem, removeItem, clearCart, getOrCreateCart };