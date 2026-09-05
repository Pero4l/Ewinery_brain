'use strict';

/** Cart controllers. */
const cartService = require('../services/cart.service');
const { ok, created } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getCart = asyncHandler(async (req, res) => {
  const cart = await cartService.getCart(req.user.id);
  return ok(res, 'Cart retrieved.', { cart });
});

const addItem = asyncHandler(async (req, res) => {
  const cart = await cartService.addItem({ userId: req.user.id, ...req.body });
  return created(res, 'Item added to cart.', { cart });
});

const updateItem = asyncHandler(async (req, res) => {
  const cart = await cartService.updateItem({
    userId: req.user.id,
    itemId: req.params.id,
    quantity: req.body.quantity
  });
  return ok(res, 'Cart updated.', { cart });
});

const removeItem = asyncHandler(async (req, res) => {
  const cart = await cartService.removeItem({ userId: req.user.id, itemId: req.params.id });
  return ok(res, 'Item removed from cart.', { cart });
});

const clearCart = asyncHandler(async (req, res) => {
  const cart = await cartService.clearCart(req.user.id);
  return ok(res, 'Cart cleared.', { cart });
});

module.exports = { getCart, addItem, updateItem, removeItem, clearCart };