'use strict';

/** Delivery pricing controllers (public quote/settings + admin management). */
const deliveryService = require('../services/delivery.service');
const { ok, created } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getPublicSettings = asyncHandler(async (req, res) => {
  const settings = await deliveryService.getPublicSettings();
  res.set('Cache-Control', 'public, max-age=300');
  return ok(res, 'Delivery settings retrieved.', settings);
});

const getQuote = asyncHandler(async (req, res) => {
  const result = await deliveryService.quote({
    subtotal: req.body.subtotal,
    state: req.body.state,
    city: req.body.city
  });
  return ok(res, 'Delivery quote calculated.', {
    deliveryFee: result.deliveryFee,
    isFree: result.isFree,
    freeDeliveryThreshold: result.freeDeliveryThreshold,
    amountToFreeDelivery: result.amountToFreeDelivery,
    zoneName: result.zoneName,
    estimatedDeliveryText: result.estimatedDeliveryText,
    isDeliveryEnabled: result.isDeliveryEnabled
  });
});

const adminGetSettings = asyncHandler(async (req, res) => {
  const result = await deliveryService.getAdminSettings();
  return ok(res, 'Delivery settings retrieved.', result);
});

const adminUpdateSettings = asyncHandler(async (req, res) => {
  const settings = await deliveryService.updateSettings({ payload: req.body, adminId: req.user.id });
  return ok(res, 'Delivery settings updated.', { settings });
});

const adminCreateZone = asyncHandler(async (req, res) => {
  const zone = await deliveryService.createZone(req.body);
  return created(res, 'Delivery zone created.', { zone });
});

const adminUpdateZone = asyncHandler(async (req, res) => {
  const zone = await deliveryService.updateZone({ zoneId: req.params.id, payload: req.body });
  return ok(res, 'Delivery zone updated.', { zone });
});

const adminDeleteZone = asyncHandler(async (req, res) => {
  const result = await deliveryService.deleteZone(req.params.id);
  return ok(res, 'Delivery zone deleted.', result);
});

module.exports = {
  getPublicSettings,
  getQuote,
  adminGetSettings,
  adminUpdateSettings,
  adminCreateZone,
  adminUpdateZone,
  adminDeleteZone
};
