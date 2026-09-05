/**
 * Wraps an async route handler so rejected promises reach the Express error
 * handler instead of becoming unhandled rejections.
 *
 * Usage: router.get('/', asyncHandler(controller.list));
 */
const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
