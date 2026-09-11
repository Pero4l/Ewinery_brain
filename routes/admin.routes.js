'use strict';

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const productController = require('../controllers/product.controller');
const { protect, requireAdmin } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { uploadSingleImage, uploadProductImages } = require('../middleware/upload.middleware');
const { writeLimiter, authLimiter } = require('../middleware/rateLimiters');
const productValidators = require('../validators/product.validator');
const adminValidators = require('../validators/admin.validator');
const couponValidators = require('../validators/coupon.validator');
const couponController = require('../controllers/coupon.controller');

// Key-gated admin registration. Public on purpose — ADMIN_SIGNUP_KEY is the gate.
router.post('/register', authLimiter(), validate(adminValidators.adminRegister), adminController.registerAdmin);

// Every admin route requires authentication + admin role.
router.use(protect, requireAdmin);

// Dashboard
router.get('/stats', validate(adminValidators.adminOrderStatusQuery, 'query'), adminController.getStats);
router.get('/sales-trend', adminController.getSalesTrend);
router.get('/products/low-stock', adminController.listLowStockProducts);

// Users
router.get('/users', validate(adminValidators.adminUserQuery, 'query'), adminController.listUsers);
router.get('/users/:id', validate(adminValidators.adminIdParams, 'params'), adminController.getUser);
router.patch('/users/:id', validate(adminValidators.adminIdParams, 'params'), adminController.updateUser);

// Products (multipart for image + gallery uploads)
router.get('/products', validate(productValidators.adminProductQuery, 'query'), productController.adminListProducts);
router.get('/products/:id', validate(productValidators.productIdParams, 'params'), productController.adminGetProduct);
router.post('/products', writeLimiter(), uploadProductImages, validate(productValidators.createProduct), productController.adminCreateProduct);
router.patch('/products/:id', writeLimiter(), validate(productValidators.productIdParams, 'params'), uploadProductImages, validate(productValidators.updateProduct), productController.adminUpdateProduct);
router.delete('/products/:id', validate(productValidators.productIdParams, 'params'), productController.adminDeleteProduct);
router.patch('/products/:id/stock', validate(productValidators.productIdParams, 'params'), validate(adminValidators.adminStockUpdate), productController.adminUpdateStock);
router.post('/products/:id/image', writeLimiter(), uploadSingleImage, validate(productValidators.productIdParams, 'params'), productController.adminUploadProductImage);

// Categories (multipart optional image)
router.get('/categories', productController.adminListCategories);
router.post('/categories', writeLimiter(), uploadSingleImage, validate(productValidators.createCategory), productController.adminCreateCategory);
router.patch('/categories/:id', writeLimiter(), uploadSingleImage, validate(productValidators.categoryIdParams, 'params'), validate(productValidators.updateCategory), productController.adminUpdateCategory);
router.delete('/categories/:id', validate(productValidators.categoryIdParams, 'params'), productController.adminDeleteCategory);

// Orders
router.get('/orders', validate(adminValidators.adminOrderQuery, 'query'), adminController.listOrders);
router.get('/orders/:id', validate(adminValidators.adminIdParams, 'params'), adminController.getOrder);
router.patch('/orders/:id/status', writeLimiter(), validate(adminValidators.adminIdParams, 'params'), validate(adminValidators.adminOrderStatusUpdate), adminController.updateOrderStatus);
router.post('/orders/:id/cancel', writeLimiter(), validate(adminValidators.adminIdParams, 'params'), adminController.cancelOrder);

// Transactions
router.get('/transactions', validate(adminValidators.adminTransactionQuery, 'query'), adminController.listTransactions);

// Reviews
router.get('/reviews', validate(adminValidators.adminReviewQuery, 'query'), adminController.listReviews);
router.patch('/reviews/:id/moderate', writeLimiter(), validate(adminValidators.adminIdParams, 'params'), validate(adminValidators.adminReviewModeration), adminController.moderateReview);

// Support tickets
router.get('/tickets', validate(adminValidators.adminTicketQuery, 'query'), adminController.listTickets);
router.get('/tickets/:id', validate(adminValidators.adminIdParams, 'params'), adminController.getTicket);
router.post('/tickets/:id/replies', writeLimiter(), validate(adminValidators.adminIdParams, 'params'), validate(adminValidators.adminNote), adminController.replyTicket);
router.patch('/tickets/:id/status', writeLimiter(), validate(adminValidators.adminIdParams, 'params'), validate(adminValidators.adminTicketStatus), adminController.updateTicketStatus);
router.patch('/tickets/:id/assign', writeLimiter(), validate(adminValidators.adminIdParams, 'params'), validate(adminValidators.adminAssign), adminController.assignTicket);

// Coupons
router.get('/coupons', validate(couponValidators.couponSearchQuery, 'query'), couponController.adminListCoupons);
router.post('/coupons', writeLimiter(), validate(couponValidators.createCoupon), couponController.adminCreateCoupon);
router.get('/coupons/:id', validate(couponValidators.couponIdParams, 'params'), couponController.adminGetCoupon);
router.patch('/coupons/:id', writeLimiter(), validate(couponValidators.couponIdParams, 'params'), validate(couponValidators.updateCoupon), couponController.adminUpdateCoupon);
router.delete('/coupons/:id', writeLimiter(), validate(couponValidators.couponIdParams, 'params'), couponController.adminDeleteCoupon);
router.post('/coupons/:id/assign', writeLimiter(), validate(couponValidators.couponIdParams, 'params'), validate(couponValidators.assignCouponUsers), couponController.adminAssignCoupon);
router.post('/coupons/:id/revoke', writeLimiter(), validate(couponValidators.couponIdParams, 'params'), validate(couponValidators.revokeCouponUsers), couponController.adminRevokeCoupon);
router.get('/coupons/:id/assignments', validate(couponValidators.couponIdParams, 'params'), validate(couponValidators.couponAssignmentQuery, 'query'), couponController.adminListAssignments);

module.exports = router;