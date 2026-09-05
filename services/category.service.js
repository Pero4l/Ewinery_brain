'use strict';

/**
 * Category service.
 *
 * Categories are lightweight. Public read routes only ever return active
 * categories; admin routes can list/edit everything.
 */
const { sequelize, Category, Product } = require('../models');
const AppError = require('../utils/AppError');
const { slugify, uniqueSlug } = require('../utils/slugify');

const slugExists = slug => Category.findOne({ where: { slug } });

const listCategories = async ({ includeInactive = false } = {}) => {
  const where = includeInactive ? {} : { isActive: true };
  return Category.findAll({
    where,
    order: [['sortOrder', 'ASC'], ['name', 'ASC']]
  });
};

const getCategory = async (categoryIdOrSlug, { includeInactive = false } = {}) => {
  const where = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(String(categoryIdOrSlug).length === 36
      ? { id: categoryIdOrSlug }
      : { slug: categoryIdOrSlug })
  };
  const category = await Category.findOne({ where });
  if (!category) throw AppError.notFound('Category not found.');
  return category;
};

const createCategory = async ({ name, description, isActive, sortOrder }) => {
  return sequelize.transaction(async transaction => {
    const slug = await uniqueSlug(name, async s => Boolean(await slugExists(s)));
    return Category.create(
      { name, slug, description: description ?? null, isActive: isActive ?? true, sortOrder: sortOrder ?? 0 },
      { transaction }
    );
  });
};

const updateCategoryMeta = async ({ categoryId, payload }) => {
  const category = await Category.findByPk(categoryId);
  if (!category) throw AppError.notFound('Category not found.');

  const patch = { ...payload };
  if (payload.name && payload.name !== category.name) {
    patch.slug = await uniqueSlug(payload.name, async s =>
      Boolean(await Category.findOne({ where: { slug: s, id: { [require('sequelize').Op.ne]: category.id } } })));
  }

  return category.update(patch);
};

const deleteCategory = async categoryId => {
  return sequelize.transaction(async transaction => {
    const category = await Category.findByPk(categoryId, { transaction });
    if (!category) throw AppError.notFound('Category not found.');

    const productCount = await Product.count({ where: { categoryId }, transaction });
    if (productCount > 0) {
      throw AppError.conflict(`Cannot delete category with ${productCount} product(s). Move the products first.`);
    }

    await category.destroy({ transaction });
    return null;
  });
};

module.exports = {
  listCategories,
  getCategory,
  createCategory,
  updateCategoryMeta,
  deleteCategory
};