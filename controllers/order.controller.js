'use strict';

/** Order controllers. */
const orderService = require('../services/order.service');
const { ok, created } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const pagination = require('../utils/pagination');

const createOrder = asyncHandler(async (req, res) => {
  const result = await orderService.createOrder({
    userId: req.user.id,
    addressId: req.body.addressId,
    customerNote: req.body.customerNote,
    couponCode: req.body.couponCode
  });
  return created(res, 'Order created successfully.', result);
});

const createGuestOrder = asyncHandler(async (req, res) => {
  const result = await orderService.createGuestOrder({
    items: req.body.items,
    email: req.body.email,
    phone: req.body.phone,
    address: req.body.address,
    customerNote: req.body.customerNote
  });
  return created(res, 'Order created successfully. Complete payment to confirm your order.', result);
});

const listMyOrders = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await orderService.listOrdersForUser({
    userId: req.user.id,
    page: paging.page,
    limit: paging.limit,
    status: req.query.status
  });
  return ok(res, 'Orders retrieved.', pagination.format(result, paging, 'orders'));
});

const getOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderForUser({ userId: req.user.id, orderId: req.params.id });
  return ok(res, 'Order retrieved.', { order });
});

const confirmReceipt = asyncHandler(async (req, res) => {
  const result = await orderService.confirmReceipt({ userId: req.user.id, orderId: req.params.id });
  return ok(res, 'Order completed. Thank you for shopping with eWinery!', result);
});

const cancelOrder = asyncHandler(async (req, res) => {
  const result = await orderService.cancelOrderByUser({
    userId: req.user.id,
    orderId: req.params.id,
    reason: req.body.reason
  });
  return ok(res, 'Order cancelled.', result);
});

module.exports = { createOrder, createGuestOrder, listMyOrders, getOrder, confirmReceipt, cancelOrder };