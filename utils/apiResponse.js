/**
 * Consistent API response envelope.
 *
 * Success: { success: true, message, data?, meta? }
 * Failure: { success: false, message, errors? }  (see middleware/errorHandler.js)
 */

/**
 * @param {import('express').Response} res
 * @param {object} options
 * @param {number} [options.statusCode=200]
 * @param {string} [options.message='Success']
 * @param {*} [options.data]
 * @param {object} [options.meta]  Pagination or other envelope metadata.
 */
const send = (res, { statusCode = 200, message = 'Success', data, meta } = {}) => {
  const body = { success: true, message };
  if (data !== undefined) body.data = data;
  if (meta !== undefined) body.meta = meta;
  return res.status(statusCode).json(body);
};

const ok = (res, message = 'Success', data, meta) =>
  send(res, { statusCode: 200, message, data, meta });

const created = (res, message = 'Created successfully', data) =>
  send(res, { statusCode: 201, message, data });

const accepted = (res, message = 'Request accepted', data) =>
  send(res, { statusCode: 202, message, data });

const noContent = res => res.status(204).send();

module.exports = { send, ok, created, accepted, noContent };
