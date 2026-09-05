'use strict';

/**
 * Authentication & account controllers.
 * Kept thin — all business logic lives in services/auth.service.js.
 */
const authService = require('../services/auth.service');
const { ok, created, accepted, send } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const clientMeta = req => ({ ipAddress: req.ip, userAgent: req.get('user-agent') });

const register = asyncHandler(async (req, res) => {
  const user = await authService.register({
    ...req.body,
    ...clientMeta(req)
  });
  return created(res, 'Account created successfully. Please verify your email.', { user });
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login({
    ...req.body,
    ...clientMeta(req)
  });
  return ok(res, 'Login successful.', result);
});

const refreshToken = asyncHandler(async (req, res) => {
  const result = await authService.refreshTokens({
    refreshToken: req.body.refreshToken,
    ...clientMeta(req)
  });
  return ok(res, 'Tokens refreshed.', result);
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  return ok(res, 'Logged out successfully.');
});

const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAllSessions(req.user.id);
  return ok(res, 'All sessions logged out.');
});

const verifyEmail = asyncHandler(async (req, res) => {
  const user = await authService.verifyEmail({ token: req.body.token });
  return ok(res, 'Email verified successfully.', { user });
});

const resendVerification = asyncHandler(async (req, res) => {
  const result = await authService.resendVerification({ email: req.body.email });
  return ok(res, result.message);
});

const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPassword({
    email: req.body.email,
    ...clientMeta(req)
  });
  return ok(res, result.message);
});

const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword({
    email: req.body.email,
    otp: req.body.otp,
    newPassword: req.body.password
  });
  return ok(res, 'Password reset successfully. You can now log in.');
});

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  logoutAll,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword
};