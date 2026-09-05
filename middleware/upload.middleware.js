'use strict';

/**
 * Multer upload configuration for product/category images.
 *
 * Files are kept in memory (never written to disk) and pushed straight to
 * Cloudinary. Unsupported file types and oversized files are rejected with a
 * clean AppError so the global handler can format them consistently.
 */
const multer = require('multer');
const config = require('../config');
const AppError = require('../utils/AppError');
const { ALLOWED_IMAGE_MIME_TYPES } = require('../config/constants');

const MAX_BYTES = (config.cloudinary.maxFileSizeMb || 5) * 1024 * 1024;

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
    return cb(null, true);
  }
  return cb(AppError.badRequest(
    `Unsupported file type "${file.mimetype}". Allowed: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}.`
  ));
};

const limits = {
  fileSize: MAX_BYTES,
  files: config.cloudinary.maxFilesPerRequest || 5
};

const upload = multer({ storage, fileFilter, limits });

/** Max 1 file (used for image upload endpoints). */
const uploadSingleImage = upload.single('image');

/** Max N files (used for product gallery upload). */
const uploadGallery = upload.array('images', limits.files);

/**
 * Product create/update form: one primary 'image' plus many 'images' in the
 * gallery. Result is available as req.files.image[] and req.files.images[].
 */
const uploadProductImages = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'images', maxCount: limits.files }
]);

module.exports = { upload, uploadSingleImage, uploadGallery, uploadProductImages, MAX_BYTES };