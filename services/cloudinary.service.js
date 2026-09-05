'use strict';

/**
 * Cloudinary image service.
 *
 * All credentials come from config (environment variables). Uploads accept an
 * in-memory buffer from Multer and return the public ID + secure URL. Old
 * assets are destroyed when an image is replaced.
 */
const cloudinary = require('cloudinary').v2;
const config = require('../config');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
  secure: true
});

const isConfigured = () => Boolean(
  config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret
);

const FOLDER = config.cloudinary.folder;

/** Uploads a buffer, returning { url, publicId }. */
const uploadImage = async (buffer, options = {}) => {
  if (!isConfigured()) {
    throw AppError.serviceUnavailable('Image uploads are not configured.');
  }
  if (!buffer) {
    throw AppError.badRequest('No image file provided.');
  }

  const resource = options.resource || 'product';
  const folderedPath = `${FOLDER}/${resource}`;

  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        folder: folderedPath,
        resource_type: 'image',
        transformation: [{ width: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }]
      }, (err, upload) => (err ? reject(err) : resolve(upload)));
      stream.end(buffer);
    });

    return { url: result.secure_url, publicId: result.public_id };
  } catch (err) {
    logger.error('Cloudinary upload failed', { message: err.message });
    throw AppError.serviceUnavailable('Image upload failed. Please try again.');
  }
};

/** Uploads multiple buffers, returning an array of { url, publicId }. */
const uploadImages = async (buffers, options = {}) => {
  const results = [];
  for (const buffer of buffers) {
    if (buffer) results.push(await uploadImage(buffer, options));
  }
  return results;
};

/** Deletes an asset by public ID. Safe to call when publicId is missing. */
const deleteImage = async publicId => {
  if (!publicId) return null;
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (err) {
    logger.warn('Cloudinary delete failed', { publicId, message: err.message });
    return null;
  }
};

/** Deletes a list of gallery assets. */
const deleteImages = async items => {
  const results = [];
  for (const item of items || []) {
    results.push(await deleteImage(item?.publicId));
  }
  return results;
};

module.exports = { uploadImage, uploadImages, deleteImage, deleteImages, isConfigured };