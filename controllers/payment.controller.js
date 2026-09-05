'use strict';

/** Payment controllers (Paystack). */
const paymentService = require('../services/payment.service');
const orderService = require('../services/order.service');
const { User } = require('../models');
const { ok, noContent } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const pagination = require('../utils/pagination');

const initializePayment = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderForUser({ userId: req.user.id, orderId: req.body.orderId });
  const user = await User.findByPk(req.user.id);
  const result = await paymentService.initializePayment({
    order,
    user,
    callbackUrl: req.body.callbackUrl
  });
  return ok(res, 'Payment initialized.', result);
});

const verifyPayment = asyncHandler(async (req, res) => {
  const result = await paymentService.verifyPayment({
    reference: req.params.reference,
    userId: req.user.id
  });
  return ok(res, 'Payment verification completed.', result);
});

const handleWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const rawBody = req.body; // Buffer (express.raw mounted on this route)
  const result = await paymentService.handleWebhook({ signature, rawBody });
  return noContent(res);
});

const listMyTransactions = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await paymentService.listTransactionsForUser({
    userId: req.user.id,
    page: paging.page,
    limit: paging.limit,
    status: req.query.status
  });
  return ok(res, 'Transactions retrieved.', pagination.format(result, paging, 'transactions'));
});

module.exports = { initializePayment, verifyPayment, handleWebhook, listMyTransactions };