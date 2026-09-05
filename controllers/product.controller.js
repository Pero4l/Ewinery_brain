'use strict';

/** Storefront & admin product/category controllers. */
const productService = require('../services/product.service');
const categoryService = require('../services/category.service');
const cloudinaryService = require('../services/cloudinary.service');
const { ok, created, noContent } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const pagination = require('../utils/pagination');

// --------------------------------------------------------------------------
// Storefront categories
// --------------------------------------------------------------------------

const listCategories = asyncHandler(async (req, res) => {
  const categories = await categoryService.listCategories({ includeInactive: false });
  return ok(res, 'Categories retrieved.', { categories });
});

const getCategory = asyncHandler(async (req, res) => {
  const category = await categoryService.getCategory(req.params.id, { includeInactive: false });
  return ok(res, 'Category retrieved.', { category });
});

// --------------------------------------------------------------------------
// Storefront products
// --------------------------------------------------------------------------

const listProducts = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await productService.listProducts(req.query, paging);
  return ok(res, 'Products retrieved.', pagination.format(result, paging, 'products'));
});

const getProduct = asyncHandler(async (req, res) => {
  const product = await productService.getPublicProduct(req.params.id);
  return ok(res, 'Product retrieved.', { product });
});

// --------------------------------------------------------------------------
// Admin categories
// --------------------------------------------------------------------------

const adminListCategories = asyncHandler(async (req, res) => {
  const categories = await categoryService.listCategories({ includeInactive: true });
  return ok(res, 'Categories retrieved.', { categories });
});

const adminCreateCategory = asyncHandler(async (req, res) => {
  let image;
  if (req.file) image = await cloudinaryService.uploadImage(req.file.buffer, { resource: 'categories' });
  const category = await categoryService.createCategory({ ...req.body });
  if (image) {
    await category.update({ imageUrl: image.url, imagePublicId: image.publicId });
  }
  return created(res, 'Category created successfully.', { category });
});

const adminUpdateCategory = asyncHandler(async (req, res) => {
  let image;
  if (req.file) {
    image = await cloudinaryService.uploadImage(req.file.buffer, { resource: 'categories' });
  }
  const current = await categoryService.getCategory(req.params.id, { includeInactive: true });
  const payload = { ...req.body };
  if (image) {
    payload.imageUrl = image.url;
    payload.imagePublicId = image.publicId;
    if (current.imagePublicId) await cloudinaryService.deleteImage(current.imagePublicId);
  }
  const category = await categoryService.updateCategoryMeta({ categoryId: req.params.id, payload });
  return ok(res, 'Category updated.', { category });
});

const adminDeleteCategory = asyncHandler(async (req, res) => {
  await categoryService.deleteCategory(req.params.id);
  return ok(res, 'Category deleted.');
});

// --------------------------------------------------------------------------
// Admin products
// --------------------------------------------------------------------------

const adminListProducts = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await productService.listProductsAdmin(req.query, paging);
  return ok(res, 'Products retrieved.', pagination.format(result, paging, 'products'));
});

const adminGetProduct = asyncHandler(async (req, res) => {
  const product = await productService.getProductAdmin(req.params.id);
  return ok(res, 'Product retrieved.', { product });
});

const adminCreateProduct = asyncHandler(async (req, res) => {
  const product = await productService.createProduct({
    payload: req.body,
    createdBy: req.user.id,
    image: req.files?.image?.[0] || null,
    gallery: req.files?.images || []
  });
  return created(res, 'Product created successfully.', { product });
});

const adminUpdateProduct = asyncHandler(async (req, res) => {
  const product = await productService.updateProduct({
    productId: req.params.id,
    payload: req.body,
    image: req.files?.image?.[0] || null,
    gallery: req.files?.images || []
  });
  return ok(res, 'Product updated.', { product });
});

const adminDeleteProduct = asyncHandler(async (req, res) => {
  await productService.deleteProduct(req.params.id);
  return ok(res, 'Product deleted.');
});

const adminUpdateStock = asyncHandler(async (req, res) => {
  const product = await productService.updateStock({ productId: req.params.id, ...req.body });
  return ok(res, 'Product stock updated.', { product });
});

const adminUploadProductImage = asyncHandler(async (req, res) => {
  if (!req.file) return ok(res, 'No image provided.');
  const product = await productService.updateProduct({
    productId: req.params.id,
    payload: {},
    image: req.file
  });
  return ok(res, 'Product image updated.', { product });
});

module.exports = {
  listCategories,
  getCategory,
  listProducts,
  getProduct,
  adminListCategories,
  adminCreateCategory,
  adminUpdateCategory,
  adminDeleteCategory,
  adminListProducts,
  adminGetProduct,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminUpdateStock,
  adminUploadProductImage
};