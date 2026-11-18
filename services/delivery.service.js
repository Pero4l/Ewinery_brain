'use strict';

/**
 * Delivery pricing — the single source of truth.
 *
 * Every place that shows or charges a delivery fee (GET /cart, POST /orders,
 * POST /orders/guest, POST /delivery/quote) goes through `quote`, so the app,
 * the cart and the amount Paystack charges can never disagree.
 *
 * Matching (state/city compared trimmed + case-insensitive, active zones only):
 *   1. a zone in the same state whose `cities` contains the city
 *   2. a whole-state zone (empty `cities`) for that state
 *   3. otherwise the global `defaultFee`
 * Free delivery: subtotal >= threshold, where the threshold is the zone's own
 * value or, when that is null, the global one. A null global threshold means
 * delivery is never free.
 */
const { Op } = require('sequelize');
const { DeliverySettings, DeliveryZone } = require('../models');
const config = require('../config');
const AppError = require('../utils/AppError');

const norm = value => String(value || '').trim().toLowerCase();

const SETTINGS_FIELDS = ['isDeliveryEnabled', 'defaultFee', 'freeDeliveryThreshold', 'estimatedDeliveryText'];

/** Loads the settings row, creating it from config if it is missing. */
const getSettings = async ({ transaction } = {}) => {
  const [settings] = await DeliverySettings.findOrCreate({
    where: { id: DeliverySettings.SINGLETON_ID },
    defaults: {
      id: DeliverySettings.SINGLETON_ID,
      isDeliveryEnabled: true,
      defaultFee: Math.round(config.store.deliveryFee || 0),
      freeDeliveryThreshold: config.store.freeDeliveryThreshold === null || config.store.freeDeliveryThreshold === undefined
        ? null
        : Math.round(config.store.freeDeliveryThreshold)
    },
    transaction
  });
  return settings;
};

const listActiveZones = ({ transaction } = {}) => DeliveryZone.findAll({
  where: { isActive: true },
  order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']],
  transaction
});

/** Picks the zone for a state/city from a list of active zones (or null). */
const matchZone = (zones, state, city) => {
  const s = norm(state);
  if (!s) return null;
  const c = norm(city);
  const inState = zones.filter(z => norm(z.state) === s);
  if (c) {
    const byCity = inState.find(z => Array.isArray(z.cities) && z.cities.some(name => norm(name) === c));
    if (byCity) return byCity;
  }
  return inState.find(z => !Array.isArray(z.cities) || z.cities.length === 0) || null;
};

/**
 * Prices delivery for a subtotal and destination.
 * @returns {{ isDeliveryEnabled, deliveryFee, isFree, freeDeliveryThreshold, amountToFreeDelivery, zoneId, zoneName, estimatedDeliveryText }}
 */
const quote = async ({ subtotal = 0, state, city, transaction } = {}) => {
  const [settings, zones] = await Promise.all([
    getSettings({ transaction }),
    listActiveZones({ transaction })
  ]);
  const zone = matchZone(zones, state, city);

  const baseFee = zone ? zone.fee : settings.defaultFee;
  const threshold = zone && zone.freeDeliveryThreshold !== null && zone.freeDeliveryThreshold !== undefined
    ? zone.freeDeliveryThreshold
    : settings.freeDeliveryThreshold;

  const amount = Number(subtotal) || 0;
  const isFree = threshold !== null && threshold !== undefined && amount >= threshold;

  return {
    isDeliveryEnabled: settings.isDeliveryEnabled,
    deliveryFee: isFree ? 0 : baseFee,
    isFree,
    freeDeliveryThreshold: threshold === undefined ? null : threshold,
    amountToFreeDelivery: threshold === null || threshold === undefined
      ? null
      : Math.max(0, Number((threshold - amount).toFixed(2))),
    zoneId: zone ? zone.id : null,
    zoneName: zone ? zone.name : null,
    estimatedDeliveryText: (zone && zone.estimatedDeliveryText) || settings.estimatedDeliveryText || null
  };
};

/** Throws 422 DELIVERY_UNAVAILABLE when the admin has paused delivery. */
const assertDeliveryAvailable = deliveryQuote => {
  if (!deliveryQuote.isDeliveryEnabled) {
    throw AppError.unprocessable('Delivery is paused right now. Please try again later.', { code: 'DELIVERY_UNAVAILABLE' });
  }
};

// --------------------------------------------------------------------------
// Serialization
// --------------------------------------------------------------------------

const zoneToJSON = zone => ({
  id: zone.id,
  name: zone.name,
  state: zone.state,
  cities: Array.isArray(zone.cities) ? zone.cities : [],
  fee: zone.fee,
  freeDeliveryThreshold: zone.freeDeliveryThreshold,
  estimatedDeliveryText: zone.estimatedDeliveryText || null,
  isActive: zone.isActive,
  sortOrder: zone.sortOrder,
  createdAt: zone.createdAt,
  updatedAt: zone.updatedAt
});

const settingsToJSON = settings => ({
  isDeliveryEnabled: settings.isDeliveryEnabled,
  defaultFee: settings.defaultFee,
  freeDeliveryThreshold: settings.freeDeliveryThreshold,
  estimatedDeliveryText: settings.estimatedDeliveryText || null,
  updatedAt: settings.updatedAt,
  updatedBy: settings.updatedBy || null
});

/** Public, app-facing view (active zones only, no admin metadata). */
const getPublicSettings = async () => {
  const [settings, zones] = await Promise.all([getSettings(), listActiveZones()]);
  return {
    isDeliveryEnabled: settings.isDeliveryEnabled,
    defaultFee: settings.defaultFee,
    freeDeliveryThreshold: settings.freeDeliveryThreshold,
    estimatedDeliveryText: settings.estimatedDeliveryText || null,
    zones: zones.map(z => ({
      id: z.id,
      name: z.name,
      state: z.state,
      cities: Array.isArray(z.cities) ? z.cities : [],
      fee: z.fee,
      freeDeliveryThreshold: z.freeDeliveryThreshold,
      estimatedDeliveryText: z.estimatedDeliveryText || null
    }))
  };
};

// --------------------------------------------------------------------------
// Admin
// --------------------------------------------------------------------------

const getAdminSettings = async () => {
  const settings = await getSettings();
  const zones = await DeliveryZone.findAll({ order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']] });
  return { settings: settingsToJSON(settings), zones: zones.map(zoneToJSON) };
};

const updateSettings = async ({ payload, adminId }) => {
  const settings = await getSettings();
  const patch = {};
  for (const field of SETTINGS_FIELDS) {
    if (payload[field] !== undefined) patch[field] = payload[field];
  }
  if (patch.estimatedDeliveryText === '') patch.estimatedDeliveryText = null;
  patch.updatedBy = adminId || null;
  await settings.update(patch);
  return settingsToJSON(settings);
};

/** Trims, drops empties and de-duplicates (case-insensitive) a city list. */
const cleanCities = cities => {
  const seen = new Set();
  const out = [];
  for (const raw of cities || []) {
    const name = String(raw || '').trim();
    const key = norm(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
};

/**
 * Rejects overlapping active zones within a state: a city may belong to only
 * one active zone, and a state may have only one active whole-state zone.
 */
const assertNoOverlap = async ({ state, cities, isActive, excludeId }) => {
  if (!isActive) return;
  const others = await DeliveryZone.findAll({
    where: {
      isActive: true,
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {})
    }
  });
  const sameState = others.filter(z => norm(z.state) === norm(state));

  if (!cities.length) {
    const clash = sameState.find(z => !Array.isArray(z.cities) || z.cities.length === 0);
    if (clash) {
      throw AppError.conflict(`"${clash.name}" already covers the whole of ${state}.`, { code: 'DELIVERY_ZONE_CONFLICT' });
    }
    return;
  }

  const wanted = new Set(cities.map(norm));
  for (const zone of sameState) {
    const dup = (zone.cities || []).find(name => wanted.has(norm(name)));
    if (dup) {
      throw AppError.conflict(`${dup} (${state}) is already in the "${zone.name}" zone.`, { code: 'DELIVERY_ZONE_CONFLICT' });
    }
  }
};

const createZone = async payload => {
  const cities = cleanCities(payload.cities);
  const isActive = payload.isActive !== undefined ? payload.isActive : true;
  await assertNoOverlap({ state: payload.state, cities, isActive });

  const zone = await DeliveryZone.create({
    name: payload.name,
    state: payload.state,
    cities,
    fee: payload.fee,
    freeDeliveryThreshold: payload.freeDeliveryThreshold === undefined ? null : payload.freeDeliveryThreshold,
    estimatedDeliveryText: payload.estimatedDeliveryText || null,
    isActive,
    sortOrder: payload.sortOrder || 0
  });
  return zoneToJSON(zone);
};

const updateZone = async ({ zoneId, payload }) => {
  const zone = await DeliveryZone.findByPk(zoneId);
  if (!zone) throw AppError.notFound('Delivery zone not found.');

  const patch = {};
  ['name', 'state', 'fee', 'freeDeliveryThreshold', 'isActive', 'sortOrder'].forEach(field => {
    if (payload[field] !== undefined) patch[field] = payload[field];
  });
  if (payload.cities !== undefined) patch.cities = cleanCities(payload.cities);
  if (payload.estimatedDeliveryText !== undefined) patch.estimatedDeliveryText = payload.estimatedDeliveryText || null;

  await assertNoOverlap({
    state: patch.state !== undefined ? patch.state : zone.state,
    cities: patch.cities !== undefined ? patch.cities : (zone.cities || []),
    isActive: patch.isActive !== undefined ? patch.isActive : zone.isActive,
    excludeId: zone.id
  });

  await zone.update(patch);
  return zoneToJSON(zone);
};

const deleteZone = async zoneId => {
  const zone = await DeliveryZone.findByPk(zoneId);
  if (!zone) throw AppError.notFound('Delivery zone not found.');
  await zone.destroy();
  return { id: zoneId };
};

module.exports = {
  quote,
  matchZone,
  assertDeliveryAvailable,
  getPublicSettings,
  getAdminSettings,
  updateSettings,
  createZone,
  updateZone,
  deleteZone
};
