'use strict';

/** Review controllers. */
const reviewService = require('../services/review.service');
const { ok, created } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const pagination = require('../utils/pagination');

const createReview = asyncHandler(async (req, res) => {
  const review = await reviewService.createReview({ userId: req.user.id, ...req.body });
  return created(res, 'Review submitted successfully.', { review });
});

const updateReview = asyncHandler(async (req, res) => {
  const review = await reviewService.updateOwnReview({
    userId: req.user.id,
    reviewId: req.params.id,
    payload: req.body
  });
  return ok(res, 'Review updated.', { review });
});

const deleteReview = asyncHandler(async (req, res) => {
  await reviewService.deleteOwnReview({ userId: req.user.id, reviewId: req.params.id });
  return ok(res, 'Review deleted.');
});

const listProductReviews = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query, { defaultLimit: 3, maxLimit: 20 });
  const result = await reviewService.listProductReviews({
    productId: req.params.id,
    page: paging.page,
    limit: paging.limit
  });
  return ok(res, 'Reviews retrieved.', pagination.format(result, paging, 'reviews'));
});

const listMyReviews = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await reviewService.listUserReviews({
    userId: req.user.id,
    page: paging.page,
    limit: paging.limit
  });
  return ok(res, 'Reviews retrieved.', pagination.format(result, paging, 'reviews'));
});

module.exports = { createReview, updateReview, deleteReview, listProductReviews, listMyReviews };