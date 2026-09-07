'use strict';

/** User profile & address controllers. */
const userService = require('../services/user.service');
const authService = require('../services/auth.service');
const { ok, created } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const getProfile = asyncHandler(async (req, res) => {
  const user = await userService.getProfile(req.user.id);
  return ok(res, 'Profile retrieved.', { user });
});

const updateProfile = asyncHandler(async (req, res) => {
  const user = await userService.updateProfile({ userId: req.user.id, ...req.body });
  return ok(res, 'Profile updated.', { user });
});

const changePassword = asyncHandler(async (req, res) => {
  const result = await authService.changePassword({
    userId: req.user.id,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword
  });
  return ok(res, result.message);
});

// --------------------------------------------------------------------------
// Addresses
// --------------------------------------------------------------------------

const listAddresses = asyncHandler(async (req, res) => {
  const addresses = await userService.listAddresses(req.user.id);
  return ok(res, 'Addresses retrieved.', { addresses });
});

const createAddress = asyncHandler(async (req, res) => {
  const address = await userService.createAddress({ userId: req.user.id, payload: req.body });
  return created(res, 'Address added successfully.', { address });
});

const updateAddress = asyncHandler(async (req, res) => {
  const address = await userService.updateAddress({
    addressId: req.params.id,
    userId: req.user.id,
    payload: req.body
  });
  return ok(res, 'Address updated.', { address });
});

const deleteAddress = asyncHandler(async (req, res) => {
  await userService.deleteAddress({ addressId: req.params.id, userId: req.user.id });
  return ok(res, 'Address deleted.');
});

const setDefaultAddress = asyncHandler(async (req, res) => {
  const address = await userService.setDefaultAddress({ addressId: req.params.id, userId: req.user.id });
  return ok(res, 'Default address updated.', { address });
});

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress
};