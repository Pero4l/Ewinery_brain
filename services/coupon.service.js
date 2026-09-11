'use strict';

/**
 * Coupon service.
 *
 * A coupon is a fixed discount granted to specific users by an admin. A user
 * can only redeem a coupon that has an assignment row for them, and each
 * assignment is single-use (redeemAt + orderId are set on redemption).
 *
 * Checkout integration lives on the coupon side so order.service stays thin:
 *  1) `applyCouponAtCheckout` validates a code inside the order transaction
 *     (row-locking the assignment to serialize concurrent redemptions).
 *  2) `redeemCoupon` records the redemption once the order row exists.
 */
const { Op } = require('sequelize');
const {
  sequelize,
  Coupon,
  CouponAssignment,
  User
} = require('../models');
const AppError = require('../utils/AppError');
const { escapeLike } = require('../utils/sanitize');
const { ROLES } = require('../config/constants');
const { notify, fanOutToAllUsers, NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, RESOURCE_TYPE } = require('./notification.service');

// --------------------------------------------------------------------------
// Admin CRUD
// --------------------------------------------------------------------------

const createCoupon = async ({ code, name, description, amount, startsAt, expiresAt, createdBy }) => {
  const start = new Date(startsAt);
  const end = new Date(expiresAt);
  if (end <= start) {
    throw AppError.badRequest('Expiry time must be after the start time.');
  }

  try {
    const coupon = await Coupon.create({
      code,
      name,
      description: description || null,
      amount,
      startsAt: start,
      expiresAt: end,
      isActive: true,
      createdBy
    });

    // Broadcast the new coupon to all active customers (in-app + email + push
    // if they opted into promotional pushes). Never breaks the request.
    await fanOutToAllUsers({
      type: NOTIFICATION_TYPE.COUPON_CREATED,
      title: 'New coupon for you',
      message: `A new coupon ${coupon.code} is available — save ${coupon.amount} on your next order. Valid until ${end.toISOString()}.`,
      channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
      resourceType: RESOURCE_TYPE.USER,
      data: { couponCode: coupon.code, amount: coupon.amount, expiresAt: end.toISOString() }
    });

    return coupon;
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      throw AppError.conflict('A coupon with this code already exists.');
    }
    throw err;
  }
};

const updateCoupon = async ({ couponId, payload }) => {
  const coupon = await Coupon.findByPk(couponId);
  if (!coupon) throw AppError.notFound('Coupon not found.');

  const patch = {};
  if (payload.code !== undefined) patch.code = payload.code;
  if (payload.name !== undefined) patch.name = payload.name;
  if (payload.description !== undefined) patch.description = payload.description;
  if (payload.amount !== undefined) patch.amount = payload.amount;
  if (payload.isActive !== undefined) patch.isActive = payload.isActive;
  if (payload.startsAt !== undefined) patch.startsAt = new Date(payload.startsAt);
  if (payload.expiresAt !== undefined) patch.expiresAt = new Date(payload.expiresAt);

  const effectiveStart = patch.startsAt || coupon.startsAt;
  const effectiveEnd = patch.expiresAt || coupon.expiresAt;
  if (new Date(effectiveEnd) <= new Date(effectiveStart)) {
    throw AppError.badRequest('Expiry time must be after the start time.');
  }

  try {
    await coupon.update(patch);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      throw AppError.conflict('A coupon with this code already exists.');
    }
    throw err;
  }
  return coupon;
};

const deleteCoupon = async couponId => {
  const coupon = await Coupon.findByPk(couponId);
  if (!coupon) throw AppError.notFound('Coupon not found.');

  // Orders keep their couponCode snapshot, so history survives the delete.
  await CouponAssignment.destroy({ where: { couponId } });
  await coupon.destroy();
  return { id: couponId, code: coupon.code };
};

const listCouponsAdmin = async ({ page, limit, search, isActive }) => {
  const where = {};
  if (isActive !== undefined) where.isActive = isActive;
  if (search) {
    where[Op.or] = [
      { code: { [Op.iLike]: `%${escapeLike(search)}%` } },
      { name: { [Op.iLike]: `%${escapeLike(search)}%` } }
    ];
  }

  const result = await Coupon.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
    distinct: true,
    include: [
      {
        model: CouponAssignment,
        as: 'assignments',
        attributes: ['id'],
        required: false
      }
    ]
  });

  // Flatten the assignments join to a plain counter for the response.
  result.rows = result.rows.map(row => {
    const data = row.toJSON();
    data.assignedCount = Array.isArray(data.assignments) ? data.assignments.length : 0;
    delete data.assignments;
    return data;
  });
  return result;
};

const getCouponAdmin = async couponId => {
  const coupon = await Coupon.findByPk(couponId, {
    include: [
      {
        model: CouponAssignment,
        as: 'assignments',
        required: false,
        order: [['createdAt', 'DESC']],
        include: [{ model: User, as: 'user', attributes: ['id', 'fullName', 'email', 'phone'] }]
      }
    ]
  });
  if (!coupon) throw AppError.notFound('Coupon not found.');
  return coupon;
};

// --------------------------------------------------------------------------
// Assign / revoke
// --------------------------------------------------------------------------

const assignCouponToUsers = async ({ couponId, userIds, assignedBy }) => {
  const coupon = await Coupon.findByPk(couponId, { attributes: ['id', 'code', 'name', 'amount', 'expiresAt'] });
  if (!coupon) throw AppError.notFound('Coupon not found.');

  const uniqueIds = [...new Set(userIds)];
  const users = await User.findAll({
    where: { id: { [Op.in]: uniqueIds }, role: ROLES.USER, isActive: true },
    attributes: ['id', 'email', 'fullName']
  });
  const found = new Set(users.map(u => u.id));

  let assignedCount = 0;
  const notifications = [];
  await sequelize.transaction(async transaction => {
    for (const userId of uniqueIds) {
      if (!found.has(userId)) continue;
      const [, created] = await CouponAssignment.findOrCreate({
        where: { couponId, userId },
        defaults: { assignedBy: assignedBy || null },
        transaction
      });
      if (created) assignedCount += 1;
    }
  });

  // Fire-and-forget promo notifications (in-app + email + push) to the assigned users.
  if (assignedCount > 0) {
    const targets = users.filter(u => found.has(u.id));
    for (const user of targets) {
      notifications.push(notify(user.id, {
        type: NOTIFICATION_TYPE.COUPON_ASSIGNED,
        title: 'You have been offered a coupon!',
        message: `Use code ${coupon.code} to save ${coupon.amount} on your next order. Valid until ${new Date(coupon.expiresAt).toISOString()}.`,
        channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
        resourceType: RESOURCE_TYPE.USER,
        resourceId: user.id,
        data: { couponCode: coupon.code, amount: coupon.amount, expiresAt: new Date(coupon.expiresAt).toISOString() }
      }));
    }
    await Promise.allSettled(notifications);
  }

  return {
    assignedCount,
    alreadyAssigned: uniqueIds.length - assignedCount,
    missingUsers: uniqueIds.length - found.size
  };
};

const revokeCouponFromUsers = async ({ couponId, userIds }) => {
  const coupon = await Coupon.findByPk(couponId, { attributes: ['id', 'code'] });
  if (!coupon) throw AppError.notFound('Coupon not found.');

  const uniqueIds = [...new Set(userIds)];
  const existing = await CouponAssignment.findAll({
    where: { couponId, userId: { [Op.in]: uniqueIds } },
    attributes: ['id', 'userId', 'redeemedAt']
  });

  const removableIds = [];
  let skippedRedeemed = 0;
  for (const assignment of existing) {
    if (assignment.redeemedAt) {
      // Redeemed assignments are kept so order history stays intact.
      skippedRedeemed += 1;
    } else {
      removableIds.push(assignment.id);
    }
  }

  if (removableIds.length > 0) {
    await CouponAssignment.destroy({ where: { id: { [Op.in]: removableIds } } });
  }

  return { revokedCount: removableIds.length, skippedRedeemed };
};

const listAssignmentsAdmin = async ({ couponId, page, limit, status }) => {
  const coupon = await Coupon.findByPk(couponId, { attributes: ['id'] });
  if (!coupon) throw AppError.notFound('Coupon not found.');

  const where = { couponId };
  if (status === 'REDEEMED') where.redeemedAt = { [Op.ne]: null };
  if (status === 'UNREDEEMED') where.redeemedAt = null;

  const result = await CouponAssignment.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
    include: [{ model: User, as: 'user', attributes: ['id', 'fullName', 'email', 'phone'] }]
  });
  return result;
};

// --------------------------------------------------------------------------
// User-facing reads
// --------------------------------------------------------------------------

const listCouponsForUser = async ({ userId, page, limit, status }) => {
  const where = { userId };
  if (status === 'REDEEMED') where.redeemedAt = { [Op.ne]: null };
  if (status === 'ACTIVE') where.redeemedAt = null;

  const now = new Date();
  const result = await CouponAssignment.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
    include: [{ model: Coupon, as: 'coupon', required: false }]
  });

  result.rows = result.rows.map(row => {
    const data = row.toJSON();
    data.status = data.redeemedAt ? 'REDEEMED' : (data.coupon ? data.coupon.statusAt(now) : 'EXPIRED');
    return data;
  });
  return result;
};

// --------------------------------------------------------------------------
// Checkout integration
// --------------------------------------------------------------------------

/**
 * Validates a coupon code for a user inside the order transaction and returns
 * the computed discount. The assignment row is locked so two concurrent
 * checkouts cannot both redeem the same coupon.
 */
const applyCouponAtCheckout = async ({ code, userId, subtotal, transaction }) => {
  const coupon = await Coupon.findOne({
    where: { code: String(code || '').trim().toUpperCase() },
    lock: transaction.LOCK.UPDATE,
    transaction
  });
  if (!coupon) throw AppError.badRequest('Invalid coupon code.');

  if (!coupon.isValidAt()) {
    const status = coupon.statusAt();
    throw AppError.badRequest(`This coupon is not available (${status.toLowerCase()}).`);
  }

  const assignment = await CouponAssignment.findOne({
    where: { couponId: coupon.id, userId },
    lock: transaction.LOCK.UPDATE,
    transaction
  });
  if (!assignment) throw AppError.badRequest('This coupon is not assigned to you.');
  if (assignment.redeemedAt) throw AppError.badRequest('This coupon has already been used.');

  const discount = Math.min(coupon.amount, subtotal);
  return { coupon, discount };
};

/** Records redemption once the order exists (idempotent, inside the txn). */
const redeemCoupon = async ({ couponId, userId, orderId, transaction }) => {
  const assignment = await CouponAssignment.findOne({
    where: { couponId, userId },
    lock: transaction.LOCK.UPDATE,
    transaction
  });
  if (!assignment || assignment.redeemedAt) return null;

  await assignment.update({ redeemedAt: new Date(), orderId }, { transaction });
  await Coupon.increment('usedCount', { by: 1, where: { id: couponId }, transaction });
  return assignment;
};

module.exports = {
  createCoupon,
  updateCoupon,
  deleteCoupon,
  listCouponsAdmin,
  getCouponAdmin,
  assignCouponToUsers,
  revokeCouponFromUsers,
  listAssignmentsAdmin,
  listCouponsForUser,
  applyCouponAtCheckout,
  redeemCoupon
};