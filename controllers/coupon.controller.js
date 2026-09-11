'use strict';

/** Coupon controllers (user-facing + admin management). */
const couponService = require('../services/coupon.service');
const { ok, created } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const pagination = require('../utils/pagination');

// --- User ----------------------------------------------------------------

const listMyCoupons = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await couponService.listCouponsForUser({
    userId: req.user.id,
    page: paging.page,
    limit: paging.limit,
    status: req.query.status
  });
  return ok(res, 'Coupons retrieved.', pagination.format(result, paging, 'coupons'));
});

// --- Admin ---------------------------------------------------------------

const adminCreateCoupon = asyncHandler(async (req, res) => {
  const coupon = await couponService.createCoupon({ ...req.body, createdBy: req.user.id });
  return created(res, 'Coupon created.', { coupon });
});

const adminListCoupons = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await couponService.listCouponsAdmin({
    page: paging.page,
    limit: paging.limit,
    search: req.query.search,
    isActive: req.query.isActive
  });
  return ok(res, 'Coupons retrieved.', pagination.format(result, paging, 'coupons'));
});

const adminGetCoupon = asyncHandler(async (req, res) => {
  const coupon = await couponService.getCouponAdmin(req.params.id);
  return ok(res, 'Coupon retrieved.', { coupon });
});

const adminUpdateCoupon = asyncHandler(async (req, res) => {
  const coupon = await couponService.updateCoupon({ couponId: req.params.id, payload: req.body });
  return ok(res, 'Coupon updated.', { coupon });
});

const adminDeleteCoupon = asyncHandler(async (req, res) => {
  const result = await couponService.deleteCoupon(req.params.id);
  return ok(res, 'Coupon deleted.', result);
});

const adminAssignCoupon = asyncHandler(async (req, res) => {
  const result = await couponService.assignCouponToUsers({
    couponId: req.params.id,
    userIds: req.body.userIds,
    assignedBy: req.user.id
  });
  return ok(res, 'Coupon assigned to users.', result);
});

const adminRevokeCoupon = asyncHandler(async (req, res) => {
  const result = await couponService.revokeCouponFromUsers({
    couponId: req.params.id,
    userIds: req.body.userIds
  });
  return ok(res, 'Coupon assignments removed.', result);
});

const adminListAssignments = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await couponService.listAssignmentsAdmin({
    couponId: req.params.id,
    page: paging.page,
    limit: paging.limit,
    status: req.query.status
  });
  return ok(res, 'Assignments retrieved.', pagination.format(result, paging, 'assignments'));
});

module.exports = {
  listMyCoupons,
  adminCreateCoupon,
  adminListCoupons,
  adminGetCoupon,
  adminUpdateCoupon,
  adminDeleteCoupon,
  adminAssignCoupon,
  adminRevokeCoupon,
  adminListAssignments
};