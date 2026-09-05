/**
 * Pagination helpers.
 *
 * Every list endpoint must go through `resolve()` so no request can ask the
 * database for an unbounded number of rows.
 */
const config = require('../config');

/**
 * Normalizes page/limit from a (already validated) query object.
 *
 * @param {object} query
 * @param {object} [options]
 * @param {number} [options.defaultLimit]
 * @param {number} [options.maxLimit]
 * @returns {{page: number, limit: number, offset: number}}
 */
const resolve = (query = {}, options = {}) => {
  const defaultLimit = options.defaultLimit || config.pagination.defaultLimit;
  const maxLimit = options.maxLimit || config.pagination.maxLimit;

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const requested = parseInt(query.limit, 10) || defaultLimit;
  const limit = Math.min(Math.max(1, requested), maxLimit);

  return { page, limit, offset: (page - 1) * limit };
};

/**
 * Builds the pagination metadata block returned alongside list data.
 *
 * @param {{page: number, limit: number, total: number}} params
 */
const meta = ({ page, limit, total }) => {
  const totalCount = Number(total) || 0;
  const totalPages = limit > 0 ? Math.ceil(totalCount / limit) : 0;

  return {
    page,
    limit,
    total: totalCount,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1
  };
};

/**
 * Shapes a Sequelize `findAndCountAll` result into `{ [key]: rows, pagination }`.
 *
 * @param {{rows: Array, count: number}} result
 * @param {{page: number, limit: number}} paging
 * @param {string} [key='items']
 */
const format = (result, paging, key = 'items') => ({
  [key]: result.rows,
  pagination: meta({ ...paging, total: result.count })
});

module.exports = { resolve, meta, format };
