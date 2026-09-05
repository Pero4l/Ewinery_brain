/**
 * Not Found (404) Middleware
 * Catches requests to routes that do not exist.
 */
const notFound = (req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Route Not Found - [${req.method}] ${req.originalUrl}`
  });
};

module.exports = notFound;
