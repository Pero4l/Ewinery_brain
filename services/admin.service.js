'use strict';

/**
 * Admin dashboard service.
 *
 * All queries are aggregate/count based so the dashboard never loads huge
 * datasets into memory. Statistics are derived from database aggregates.
 */
const { Op } = require('sequelize');
const { sequelize, User, Product, Order, Transaction, SupportTicket } = require('../models');
const config = require('../config');
const AppError = require('../utils/AppError');
const { escapeLike } = require('../utils/sanitize');
const { ORDER_STATUS, PAYMENT_STATUS, TRANSACTION_STATUS, TICKET_STATUS, PRODUCT_STATUS } = require('../config/constants');

// --------------------------------------------------------------------------
// Users
// --------------------------------------------------------------------------

const listUsers = async ({ page, limit, search, role, isActive }) => {
  const where = {};
  if (role) where.role = role;
  if (isActive !== undefined) where.isActive = isActive;
  if (search) {
    where[Op.or] = [
      { fullName: { [Op.iLike]: `%${escapeLike(search)}%` } },
      { email: { [Op.iLike]: `%${escapeLike(search)}%` } },
      { phone: { [Op.iLike]: `%${escapeLike(search)}%` } }
    ];
  }

  const result = await User.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
    subQuery: false
  });
  return result;
};

const getUserAdmin = async userId => {
  const user = await User.findByPk(userId, {
    include: [
      { model: Order, as: 'orders', attributes: ['id', 'orderNumber', 'status', 'totalAmount', 'createdAt'], limit: 10, order: [['createdAt', 'DESC']] },
      { model: Transaction, as: 'transactions', attributes: ['id', 'reference', 'amount', 'status', 'createdAt'], limit: 10, order: [['createdAt', 'DESC']] }
    ]
  });
  if (!user) throw AppError.notFound('User not found.');
  return user;
};

const updateUserAdmin = async ({ userId, payload }) => {
  const user = await User.findByPk(userId);
  if (!user) throw AppError.notFound('User not found.');

  const patch = {};
  if (payload.isActive !== undefined) patch.isActive = payload.isActive;
  if (payload.role !== undefined) patch.role = payload.role;
  await user.update(patch);
  return user.toPublicJSON();
};

// --------------------------------------------------------------------------
// Dashboard statistics
// --------------------------------------------------------------------------

const dashboardStats = async ({ from, to } = {}) => {
  const createdRange = {};
  if (from || to) {
    createdRange.createdAt = {};
    if (from) createdRange.createdAt[Op.gte] = new Date(from);
    if (to) createdRange.createdAt[Op.lte] = new Date(to);
  }

  const [
    totalUsers,
    totalProducts,
    activeProducts,
    totalOrders,
    pendingOrders,
    processingOrders,
    completedOrders,
    cancelledOrders,
    paidOrders,
    totalTransactions,
    successfulTransactions,
    failedTransactions,
    openTickets,
    inProgressTickets,
    lowStockCount
  ] = await Promise.all([
    User.count({ where: createdRange }),
    Product.count({ where: createdRange }),
    Product.count({ where: { status: PRODUCT_STATUS.ACTIVE, isAvailable: true } }),
    Order.count({ where: createdRange }),
    Order.count({ where: { ...createdRange, status: ORDER_STATUS.PENDING } }),
    Order.count({ where: { ...createdRange, status: ORDER_STATUS.PROCESSING } }),
    Order.count({ where: { ...createdRange, status: ORDER_STATUS.COMPLETED } }),
    Order.count({ where: { ...createdRange, status: ORDER_STATUS.CANCELLED } }),
    Order.count({ where: { ...createdRange, paymentStatus: PAYMENT_STATUS.PAID } }),
    Transaction.count({ where: createdRange }),
    Transaction.count({ where: { ...createdRange, status: TRANSACTION_STATUS.SUCCESS } }),
    Transaction.count({ where: { ...createdRange, status: TRANSACTION_STATUS.FAILED } }),
    SupportTicket.count({ where: { status: { [Op.in]: [TICKET_STATUS.OPEN, TICKET_STATUS.IN_PROGRESS] } } }),
    SupportTicket.count({ where: { status: TICKET_STATUS.IN_PROGRESS } }),
    Product.count({ where: { status: PRODUCT_STATUS.ACTIVE, stockQuantity: { [Op.lte]: config.store.lowStockThreshold } } })
  ]);

  const revenueRow = await Order.findOne({
    where: { paymentStatus: PAYMENT_STATUS.PAID, ...createdRange },
    attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('totalAmount')), 0), 'revenue']],
    raw: true
  });
  const totalRevenue = Number(revenueRow?.revenue || 0);

  return {
    totalUsers,
    totalProducts,
    activeProducts,
    totalOrders,
    pendingOrders,
    processingOrders,
    completedOrders,
    cancelledOrders,
    paidOrders,
    totalTransactions,
    successfulTransactions,
    failedTransactions,
    totalRevenue,
    openTickets,
    inProgressTickets,
    lowStockCount
  };
};

const salesTrend = async (days = 7) => {
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const rows = await Order.findAll({
    where: { paymentStatus: PAYMENT_STATUS.PAID, paidAt: { [Op.gte]: since } },
    attributes: [
      [sequelize.fn('DATE', sequelize.col('paidAt')), 'date'],
      [sequelize.fn('SUM', sequelize.col('totalAmount')), 'revenue'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'orders']
    ],
    group: [sequelize.fn('DATE', sequelize.col('paidAt'))],
    order: [[sequelize.fn('DATE', sequelize.col('paidAt')), 'ASC']],
    raw: true
  });
  return rows.map(r => ({ date: r.date, revenue: Number(r.revenue || 0), orders: Number(r.orders || 0) }));
};

module.exports = {
  listUsers,
  getUserAdmin,
  updateUserAdmin,
  dashboardStats,
  salesTrend
};