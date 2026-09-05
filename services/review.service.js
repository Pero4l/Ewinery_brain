'use strict';

/**
 * Review service.
 *
 * A review must be tied to a product the user actually purchased and
 * received (DELIVERED/COMPLETED order). Only APPROVED reviews are shown to
 * the storefront. The product's rating aggregates are kept denormalized and
 * recalculated after every create/update/delete/moderate.
 */
const { Op } = require('sequelize');
const { sequelize, Review, Product, Order, OrderItem, User } = require('../models');
const AppError = require('../utils/AppError');
const { notify, fanOutToAdmins, NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, RESOURCE_TYPE } = require('./notification.service');
const { REVIEW_STATUS, ORDER_STATUS } = require('../config/constants');

const recalcProductRatings = async productId => {
  const row = await Review.findOne({
    where: { productId, status: REVIEW_STATUS.APPROVED },
    attributes: [
      [sequelize.fn('ROUND', sequelize.fn('AVG', sequelize.col('rating')), 2), 'avg'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']
    ],
    raw: true
  });
  const avg = row && row.avg !== null ? Number(row.avg) : 0;
  const cnt = row ? Number(row.cnt) : 0;
  await Product.update({ averageRating: avg, reviewCount: cnt }, { where: { id: productId } });
};

const PUBLISHED_INCLUDES = [
  { model: User, as: 'user', attributes: ['id', 'fullName', 'email'] }
];

/** Finds the delivered purchase that entitles a user to review a product. */
const findEligibleOrderItem = async ({ userId, productId }) => {
  const orderItem = await OrderItem.findOne({
    include: [{
      model: Order,
      as: 'order',
      where: {
        userId,
        status: { [Op.in]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.COMPLETED] }
      },
      attributes: ['id', 'orderNumber', 'status']
    }],
    where: { productId },
    order: [['createdAt', 'DESC']]
  });
  return orderItem;
};

const createReview = async ({ userId, productId, rating, title, comment }) => {
  const product = await Product.findByPk(productId);
  if (!product) throw AppError.notFound('Product not found.');

  const existing = await Review.findOne({ where: { userId, productId } });
  if (existing) {
    throw AppError.conflict('You have already reviewed this product.');
  }

  const orderItem = await findEligibleOrderItem({ userId, productId });
  if (!orderItem) {
    throw AppError.forbidden('You can only review products you have purchased and received.');
  }

  const review = await Review.create({
    productId,
    userId,
    orderId: orderItem.orderId,
    orderItemId: orderItem.id,
    rating,
    title: title || null,
    comment: comment || null,
    status: REVIEW_STATUS.APPROVED,
    isVerifiedPurchase: true
  });

  await recalcProductRatings(productId);

  await fanOutToAdmins({
    type: NOTIFICATION_TYPE.NEW_REVIEW,
    title: 'New product review',
    message: `A new review (${rating}★) was posted on "${product.name}".`,
    resourceType: RESOURCE_TYPE.REVIEW,
    resourceId: review.id,
    data: { productName: product.name, rating }
  });

  return review;
};

const updateOwnReview = async ({ userId, reviewId, payload }) => {
  const review = await Review.findOne({ where: { id: reviewId, userId } });
  if (!review) throw AppError.notFound('Review not found.');

  await review.update({
    ...(payload.rating !== undefined ? { rating: payload.rating } : {}),
    ...(payload.title !== undefined ? { title: payload.title } : {}),
    ...(payload.comment !== undefined ? { comment: payload.comment } : {}),
    editedAt: new Date()
  });

  await recalcProductRatings(review.productId);
  return review;
};

const deleteOwnReview = async ({ userId, reviewId }) => {
  const review = await Review.findOne({ where: { id: reviewId, userId } });
  if (!review) throw AppError.notFound('Review not found.');

  const productId = review.productId;
  await review.destroy();
  await recalcProductRatings(productId);
  return null;
};

/** Paginated storefront reviews (latest first), APPROVED only. */
const listProductReviews = async ({ productId, page, limit }) => {
  const product = await Product.findByPk(productId, { attributes: ['id'] });
  if (!product) throw AppError.notFound('Product not found.');

  const result = await Review.findAndCountAll({
    where: { productId, status: REVIEW_STATUS.APPROVED },
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
    include: PUBLISHED_INCLUDES
  });
  return result;
};

/** Paginated list of a user's own reviews. */
const listUserReviews = async ({ userId, page, limit }) => {
  const result = await Review.findAndCountAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
    include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'slug', 'imageUrl'] }]
  });
  return result;
};

// --------------------------------------------------------------------------
// Admin moderation
// --------------------------------------------------------------------------

const listReviewsAdmin = async ({ page, limit, status }) => {
  const where = status ? { status } : {};
  const result = await Review.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
    include: [
      { model: User, as: 'user', attributes: ['id', 'fullName', 'email'] },
      { model: Product, as: 'product', attributes: ['id', 'name', 'slug'] }
    ]
  });
  return result;
};

const moderateReview = async ({ reviewId, status, moderationNote, moderatorId }) => {
  const review = await Review.findByPk(reviewId);
  if (!review) throw AppError.notFound('Review not found.');

  const previousStatus = review.status;
  await review.update({
    status,
    moderationNote: moderationNote ?? review.moderationNote,
    editedAt: new Date()
  });

  // Recalculate whenever the approved visibility changes.
  if (previousStatus !== status) {
    await recalcProductRatings(review.productId);
  }

  if (status === REVIEW_STATUS.HIDDEN) {
    await notify(review.userId, {
      type: NOTIFICATION_TYPE.NEW_REVIEW,
      title: 'Review moderated',
      message: 'Your review was reviewed by our team. Contact support if you have questions.',
      channels: [NOTIFICATION_CHANNEL.IN_APP],
      resourceType: RESOURCE_TYPE.REVIEW,
      resourceId: review.id
    });
  }

  return review;
};

module.exports = {
  createReview,
  updateOwnReview,
  deleteOwnReview,
  listProductReviews,
  listReviewsAdmin,
  moderateReview,
  recalcProductRatings
};