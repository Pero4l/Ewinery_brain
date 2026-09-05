'use strict';

/** Admin dashboard & management controllers. */
const adminService = require('../services/admin.service');
const authService = require('../services/auth.service');
const orderService = require('../services/order.service');
const paymentService = require('../services/payment.service');
const productService = require('../services/product.service');
const reviewService = require('../services/review.service');
const supportService = require('../services/support.service');
const { ok, created } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const pagination = require('../utils/pagination');

// --- Accounts ------------------------------------------------------------

/** Key-gated admin self-registration (public on purpose, protected by ADMIN_SIGNUP_KEY). */
const registerAdmin = asyncHandler(async (req, res) => {
  const user = await authService.registerAdmin({
    ...req.body,
    ipAddress: req.ip,
    userAgent: req.get('user-agent')
  });
  return created(res, 'Admin account registered successfully.', { user });
});

// --- Users ---------------------------------------------------------------

const listUsers = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await adminService.listUsers({
    page: paging.page,
    limit: paging.limit,
    search: req.query.search,
    role: req.query.role,
    isActive: req.query.isActive
  });
  return ok(res, 'Users retrieved.', pagination.format(result, paging, 'users'));
});

const getUser = asyncHandler(async (req, res) => {
  const user = await adminService.getUserAdmin(req.params.id);
  return ok(res, 'User retrieved.', { user });
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await adminService.updateUserAdmin({ userId: req.params.id, payload: req.body });
  return ok(res, 'User updated.', { user });
});

// --- Products ------------------------------------------------------------

const listLowStockProducts = asyncHandler(async (req, res) => {
  const products = await productService.lowStockProducts();
  return ok(res, 'Low stock products retrieved.', { products });
});

// --- Orders --------------------------------------------------------------

const listOrders = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await orderService.listOrdersForAdmin({
    page: paging.page,
    limit: paging.limit,
    status: req.query.status,
    search: req.query.search
  });
  return ok(res, 'Orders retrieved.', pagination.format(result, paging, 'orders'));
});

const getOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderForAdmin(req.params.id);
  return ok(res, 'Order retrieved.', { order });
});

const updateOrderStatus = asyncHandler(async (req, res) => {
  await orderService.updateOrderStatus({
    orderId: req.params.id,
    status: req.body.status,
    changedBy: req.user.id,
    note: req.body.note
  });
  return ok(res, 'Order status updated.');
});

const cancelOrder = asyncHandler(async (req, res) => {
  await orderService.cancelOrderByAdmin({
    orderId: req.params.id,
    changedBy: req.user.id,
    reason: req.body.note
  });
  return ok(res, 'Order cancelled.');
});

// --- Payments / Transactions --------------------------------------------

const listTransactions = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await paymentService.listTransactionsForAdmin({
    page: paging.page,
    limit: paging.limit,
    status: req.query.status
  });
  return ok(res, 'Transactions retrieved.', pagination.format(result, paging, 'transactions'));
});

// --- Reviews -------------------------------------------------------------

const listReviews = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await reviewService.listReviewsAdmin({
    page: paging.page,
    limit: paging.limit,
    status: req.query.status
  });
  return ok(res, 'Reviews retrieved.', pagination.format(result, paging, 'reviews'));
});

const moderateReview = asyncHandler(async (req, res) => {
  const review = await reviewService.moderateReview({
    reviewId: req.params.id,
    status: req.body.status,
    moderationNote: req.body.moderationNote,
    moderatorId: req.user.id
  });
  return ok(res, 'Review updated.', { review });
});

// --- Support tickets -----------------------------------------------------

const listTickets = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await supportService.listTicketsAdmin({
    page: paging.page,
    limit: paging.limit,
    status: req.query.status,
    priority: req.query.priority
  });
  return ok(res, 'Tickets retrieved.', pagination.format(result, paging, 'tickets'));
});

const getTicket = asyncHandler(async (req, res) => {
  const ticket = await supportService.getTicketForAdmin(req.params.id);
  return ok(res, 'Ticket retrieved.', { ticket });
});

const replyTicket = asyncHandler(async (req, res) => {
  const message = await supportService.adminReply({
    ticketId: req.params.id,
    admin: req.user,
    message: req.body.message,
    isInternalNote: req.body.isInternalNote === true
  });
  return ok(res, 'Reply sent.', { message });
});

const updateTicketStatus = asyncHandler(async (req, res) => {
  const ticket = await supportService.updateTicketStatus({
    ticketId: req.params.id,
    status: req.body.status,
    note: req.body.note,
    adminId: req.user.id
  });
  return ok(res, 'Ticket status updated.', { ticket });
});

const assignTicket = asyncHandler(async (req, res) => {
  const ticket = await supportService.assignTicket({
    ticketId: req.params.id,
    agentId: req.body.agentId
  });
  return ok(res, 'Ticket assigned.', { ticket });
});

// --- Dashboard -----------------------------------------------------------

const getStats = asyncHandler(async (req, res) => {
  const stats = await adminService.dashboardStats({
    from: req.query.from,
    to: req.query.to
  });
  return ok(res, 'Dashboard statistics retrieved.', stats);
});

const getSalesTrend = asyncHandler(async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
  const trend = await adminService.salesTrend(days);
  return ok(res, 'Sales trend retrieved.', { days, trend });
});

module.exports = {
  registerAdmin,
  listUsers,
  getUser,
  updateUser,
  listLowStockProducts,
  listOrders,
  getOrder,
  updateOrderStatus,
  cancelOrder,
  listTransactions,
  listReviews,
  moderateReview,
  listTickets,
  getTicket,
  replyTicket,
  updateTicketStatus,
  assignTicket,
  getStats,
  getSalesTrend
};