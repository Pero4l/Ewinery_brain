'use strict';

/**
 * User account service: profile management and delivery addresses.
 *
 * Address ownership is enforced by including `userId` in every query (IDOR
 * safe). The "single default address" rule is enforced inside a transaction.
 */
const { sequelize, User, Address } = require('../models');
const AppError = require('../utils/AppError');

/** Client-safe profile for the authenticated user. */
const getProfile = async userId => {
  const user = await User.findByPk(userId);
  if (!user) throw AppError.notFound('Account not found.');
  return user.toPublicJSON();
};

/** Updates non-sensitive profile fields. */
const updateProfile = async ({ userId, fullName, phone }) => {
  const user = await User.findByPk(userId);
  if (!user) throw AppError.notFound('Account not found.');

  const patch = {};
  if (fullName !== undefined) patch.fullName = fullName;
  if (phone !== undefined) patch.phone = phone;

  await user.update(patch);
  return user.toPublicJSON();
};

/** Lists the user's addresses, default first. */
const listAddresses = async userId =>
  Address.findAll({
    where: { userId },
    order: [['isDefault', 'DESC'], ['createdAt', 'DESC']]
  });

const findOwnedAddress = async ({ addressId, userId }) => {
  const address = await Address.findOne({ where: { id: addressId, userId } });
  if (!address) throw AppError.notFound('Address not found.');
  return address;
};

const createAddress = async ({ userId, payload }) => {
  return sequelize.transaction(async transaction => {
    const existing = await Address.count({ where: { userId }, transaction });
    const isFirst = existing === 0;
    const shouldBeDefault = isFirst || payload.isDefault === true;

    if (shouldBeDefault) {
      await Address.update(
        { isDefault: false },
        { where: { userId }, transaction }
      );
    }

    const address = await Address.create(
      {
        userId,
        ...payload,
        isDefault: shouldBeDefault
      },
      { transaction }
    );
    return address;
  });
};

const updateAddress = async ({ addressId, userId, payload }) => {
  return sequelize.transaction(async transaction => {
    const address = await findOwnedAddress({ addressId, userId });
    const oldDefault = address.isDefault;

    if (payload.isDefault === true && !oldDefault) {
      await Address.update({ isDefault: false }, { where: { userId }, transaction });
    }

    const patch = { ...payload };
    if (payload.isDefault === false && oldDefault) {
      // Cannot un-set the only default; keep it default to preserve invariant.
      delete patch.isDefault;
    }

    await address.update(patch, { transaction });
    return address;
  });
};

const deleteAddress = async ({ addressId, userId }) => {
  return sequelize.transaction(async transaction => {
    const address = await findOwnedAddress({ addressId, userId });

    if (address.isDefault) {
      await Address.destroy({ where: { id: address.id }, transaction });
      // Promote the most recent remaining address to default.
      const next = await Address.findOne({
        where: { userId },
        order: [['createdAt', 'DESC']],
        transaction
      });
      if (next) {
        await next.update({ isDefault: true }, { transaction });
      }
      return;
    }

    await Address.destroy({ where: { id: address.id }, transaction });
  });
};

const setDefaultAddress = async ({ addressId, userId }) => {
  return sequelize.transaction(async transaction => {
    await findOwnedAddress({ addressId, userId });

    await Address.update(
      { isDefault: false },
      { where: { userId }, transaction }
    );
    await Address.update(
      { isDefault: true },
      { where: { id: addressId, userId }, transaction }
    );

    return Address.findOne({ where: { id: addressId, userId } });
  });
};

/** The user's default address, falling back to the most recent. */
const getDeliveryAddress = async (userId, addressId) => {
  const where = { userId };
  if (addressId) {
    const owned = await Address.findOne({ where: { id: addressId, userId } });
    if (!owned) throw AppError.notFound('Delivery address not found.');
    return owned;
  }
  let address = await Address.findOne({ where: { ...where, isDefault: true } });
  if (!address) {
    address = await Address.findOne({ where, order: [['createdAt', 'DESC']] });
  }
  return address;
};

module.exports = {
  getProfile,
  updateProfile,
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  getDeliveryAddress
};