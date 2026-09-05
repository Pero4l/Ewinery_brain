'use strict';

/**
 * Authentication service.
 *
 * Handles registration, login/logout, refresh tokens, email verification and
 * the forgot/reset password flow. Tokens are always stored hashed
 * (SHA-256) so a database leak cannot be replayed. Refresh tokens live in
 * the auth_tokens table; access tokens are short-lived JWTs.
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { ROLES } = require('../config/constants');
const AppError = require('../utils/AppError');
const { randomToken, numericOtp } = require('../utils/tokens');
const { User, AuthToken } = require('../models');
const { notify, fanOutToAdmins, NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, RESOURCE_TYPE } = require('./notification.service');

const { PASSWORD_RESET, EMAIL_VERIFICATION, REFRESH } = AuthToken.TOKEN_TYPE;

/** Basic client info for audit fields on auth_tokens. */
const clientMeta = (ipAddress, userAgent) => ({
  ipAddress: ipAddress ? String(ipAddress).slice(0, 64) : null,
  userAgent: userAgent ? String(userAgent).slice(0, 255) : null
});

const issueAccessToken = user => jwt.sign({}, config.jwt.secret, {
  subject: user.id,
  issuer: config.jwt.issuer,
  audience: config.jwt.audience,
  expiresIn: config.jwt.accessExpiresIn
});

/** Creates an auth_tokens row, returning the raw secret (hashed in DB). */
const createAuthToken = async ({ userId, type, ttlMs, ipAddress, userAgent }) => {
  const raw = type === PASSWORD_RESET || type === EMAIL_VERIFICATION
    ? numericOtp(6)
    : randomToken(48);
  const record = await AuthToken.create({
    userId,
    type,
    tokenHash: AuthToken.hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMs),
    ...clientMeta(ipAddress, userAgent)
  });
  return { rawToken: raw, record };
};

/** Keeps only the newest `maxSessionsPerUser` refresh tokens. */
const pruneSessions = async userId => {
  const keep = config.security.maxSessionsPerUser || 10;
  const tokens = await AuthToken.findAll({
    where: { userId, type: REFRESH },
    order: [['createdAt', 'DESC']],
    attributes: ['id']
  });
  if (tokens.length <= keep) return;
  const extra = tokens.slice(keep).map(t => t.id);
  await AuthToken.destroy({ where: { id: extra } });
};

const issueTokens = async (user, { ipAddress, userAgent } = {}) => {
  const accessToken = issueAccessToken(user);
  const { rawToken: refreshToken } = await createAuthToken({
    userId: user.id,
    type: REFRESH,
    ttlMs: config.jwt.refreshExpiresInDays * 24 * 60 * 60 * 1000,
    ipAddress,
    userAgent
  });
  await pruneSessions(user.id);
  return { accessToken, refreshToken };
};

/**
 * Registers a new account.
 *  - Role defaults to USER; only the key-gated admin route may request ADMIN.
 *  - Sends welcome + email-verification emails and notifies all admins.
 */
const register = async ({ fullName, email, phone, password, ipAddress, userAgent, role } = {}) => {
  const existing = await User.findOne({ where: { email } });
  if (existing) throw AppError.conflict('An account with this email already exists.');

  const finalRole = role && ROLES[role] === role ? role : ROLES.USER;
  const hadAdmins = (await User.count({ where: { role: ROLES.ADMIN } })) > 0;

  const user = User.build({ fullName, email, phone, role: finalRole });
  await user.setPassword(password);

  try {
    await user.save();
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError' || err.name === 'SequelizeValidationError') {
      throw AppError.conflict('An account with this email already exists.');
    }
    throw err;
  }

  // Email verification OTP (24h).
  const { rawToken: verifyCode } = await createAuthToken({
    userId: user.id,
    type: EMAIL_VERIFICATION,
    ttlMs: config.security.emailVerificationTtlHours * 60 * 60 * 1000,
    ipAddress,
    userAgent
  });

  const publicUser = user.toPublicJSON();

  // Welcome + verification emails (fire-and-forget, never block response).
  await notify(user.id, {
    type: NOTIFICATION_TYPE.WELCOME,
    title: 'Welcome to eWinery',
    message: `Welcome ${user.fullName}, your account has been created successfully.`,
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    resourceType: RESOURCE_TYPE.USER,
    resourceId: user.id
  });

  await notify(user.id, {
    type: NOTIFICATION_TYPE.EMAIL_VERIFICATION,
    title: 'Verify your email',
    message: `Use code ${verifyCode} to verify your email address.`,
    channels: [NOTIFICATION_CHANNEL.EMAIL],
    resourceType: RESOURCE_TYPE.USER,
    resourceId: user.id,
    data: { code: verifyCode }
  });

  // Notify all existing admins (the very first admin has no peers yet).
  if (hadAdmins) {
    await fanOutToAdmins({
      type: NOTIFICATION_TYPE.NEW_USER_REGISTERED,
      title: 'New user registered',
      message: `A new user ${user.fullName} (${user.email}) just created an account.`,
      resourceType: RESOURCE_TYPE.USER,
      resourceId: user.id,
      data: { userEmail: user.email }
    });
  }

  return publicUser;
};

/**
 * Registers an ADMIN account. Gated by a signup key set in the environment;
 * the admin role can never be requested through the public /auth/register route.
 */
const registerAdmin = async ({ fullName, email, phone, password, signupKey, ipAddress, userAgent }) => {
  if (!config.security.adminSignupKey) {
    throw AppError.forbidden('Admin registration is not enabled on this deployment.');
  }
  if (!signupKey || signupKey !== config.security.adminSignupKey) {
    throw AppError.forbidden('Invalid admin registration key.');
  }
  return register({ fullName, email, phone, password, ipAddress, userAgent, role: ROLES.ADMIN });
};

/** Authenticates credentials and issues access + refresh tokens. */
const login = async ({ email, password, ipAddress, userAgent }) => {
  const user = await User.scope('withPassword').findOne({ where: { email } });
  const passwordOk = user && (await user.verifyPassword(password));
  if (!user || !passwordOk) {
    throw AppError.unauthorized('Invalid email or password.');
  }
  if (!user.isActive) {
    throw AppError.unauthorized('This account has been deactivated. Contact support.');
  }

  const tokens = await issueTokens(user, { ipAddress, userAgent });
  if (!user.lastLoginAt || Date.now() - new Date(user.lastLoginAt).getTime() > 60 * 60 * 1000) {
    user.lastLoginAt = new Date();
    await user.save({ fields: ['lastLoginAt'] });
  } else {
    await user.update({ lastLoginAt: new Date() });
  }

  return { ...tokens, user: user.toPublicJSON() };
};

/** Consumes a refresh token, ending that session. */
const logout = async refreshToken => {
  if (!refreshToken) return;
  await AuthToken.destroy({
    where: { tokenHash: AuthToken.hashToken(refreshToken), type: REFRESH }
  });
};

/** Invalidates every refresh token for the user. */
const logoutAllSessions = async userId => {
  await AuthToken.destroy({ where: { userId, type: REFRESH } });
  const user = await User.findByPk(userId);
  if (user) {
    user.tokensValidFrom = new Date();
    await user.save({ fields: ['tokensValidFrom'] });
  }
};

/** Rotates a refresh token into a fresh access + refresh pair. */
const refreshTokens = async ({ refreshToken, ipAddress, userAgent }) => {
  const record = await AuthToken.findOne({
    where: { tokenHash: AuthToken.hashToken(refreshToken), type: REFRESH }
  });
  if (!record || !record.isUsable()) {
    throw AppError.unauthorized('Invalid or expired refresh token. Please log in again.', { code: 'TOKEN_INVALIDATED' });
  }

  const user = await User.findByPk(record.userId);
  if (!user || !user.isActive) {
    throw AppError.unauthorized('Account not found or has been deactivated.');
  }

  await record.update({ consumedAt: new Date() });

  const tokens = await issueTokens(user, { ipAddress, userAgent });
  return { ...tokens, user: user.toPublicJSON() };
};

/**
 * Sends a password reset OTP. Response is identical whether or not the email
 * exists (anti-enumeration); the email is only sent for real accounts.
 */
const forgotPassword = async ({ email, ipAddress, userAgent }) => {
  const genericMessage = 'If an account exists for this email, a password reset code has been sent.';

  const user = await User.findOne({ where: { email } });
  if (!user) return { message: genericMessage };

  // Invalidate any previous outstanding OTPs before issuing a new one.
  await AuthToken.update(
    { consumedAt: new Date() },
    { where: { userId: user.id, type: PASSWORD_RESET, consumedAt: null } }
  );

  const { rawToken: code } = await createAuthToken({
    userId: user.id,
    type: PASSWORD_RESET,
    ttlMs: config.security.passwordResetTtlMinutes * 60 * 1000,
    ipAddress,
    userAgent
  });

  await notify(user.id, {
    type: NOTIFICATION_TYPE.PASSWORD_RESET_REQUESTED,
    title: 'Password reset code',
    message: `Your password reset code is ${code}. It expires in ${config.security.passwordResetTtlMinutes} minutes.`,
    channels: [NOTIFICATION_CHANNEL.EMAIL],
    resourceType: RESOURCE_TYPE.USER,
    resourceId: user.id,
    data: { code }
  });

  return { message: genericMessage };
};

/** Verifies the OTP and sets a new password, invalidating all sessions. */
const resetPassword = async ({ email, otp, newPassword }) => {
  const user = await User.findOne({ where: { email } });

  const records = user
    ? await AuthToken.findAll({
        where: { userId: user.id, type: PASSWORD_RESET, consumedAt: null },
        order: [['createdAt', 'DESC']]
      })
    : [];

  const record = records.find(r => r.tokenHash === AuthToken.hashToken(otp));

  if (!user || !record) {
    const latest = records[0];
    if (latest && latest.expiresAt > new Date()) await latest.increment('attempts');
    throw AppError.badRequest('Invalid or expired reset code.');
  }

  if (!record.isUsable()) {
    throw AppError.badRequest('Invalid or expired reset code.');
  }
  if (record.attempts >= config.security.passwordResetMaxAttempts) {
    throw AppError.badRequest('Too many failed attempts. Please request a new code.');
  }

  const userWithPassword = await User.scope('withPassword').findByPk(user.id);
  await userWithPassword.setPassword(newPassword);
  await userWithPassword.save();

  await record.update({ consumedAt: new Date() });
  await logoutAllSessions(user.id);

  await notify(user.id, {
    type: NOTIFICATION_TYPE.PASSWORD_CHANGED,
    title: 'Password changed',
    message: 'Your password has been reset successfully.',
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    resourceType: RESOURCE_TYPE.USER,
    resourceId: user.id
  });

  return { success: true };
};

/** Confirms an email address using the verification OTP. */
const verifyEmail = async ({ token }) => {
  const record = await AuthToken.findOne({
    where: { tokenHash: AuthToken.hashToken(token), type: EMAIL_VERIFICATION }
  });
  if (!record || !record.isUsable()) {
    throw AppError.badRequest('Invalid or expired verification code.');
  }

  const user = await User.findByPk(record.userId);
  if (!user) throw AppError.notFound('Account not found.');

  await record.update({ consumedAt: new Date() });
  if (!user.emailVerifiedAt) {
    await user.update({ emailVerifiedAt: new Date() });
  }

  await notify(user.id, {
    type: NOTIFICATION_TYPE.EMAIL_VERIFIED,
    title: 'Email verified',
    message: 'Your email address has been verified successfully.',
    channels: [NOTIFICATION_CHANNEL.EMAIL],
    resourceType: RESOURCE_TYPE.USER,
    resourceId: user.id
  });

  return user.toPublicJSON();
};

/** Resends the email verification OTP (anti-enumeration behaviour). */
const resendVerification = async ({ email }) => {
  const genericMessage = 'If an account exists for this email, a verification code has been sent.';
  const user = await User.findOne({ where: { email } });
  if (!user) return { message: genericMessage };

  await AuthToken.update(
    { consumedAt: new Date() },
    { where: { userId: user.id, type: EMAIL_VERIFICATION, consumedAt: null } }
  );

  const { rawToken: code } = await createAuthToken({
    userId: user.id,
    type: EMAIL_VERIFICATION,
    ttlMs: config.security.emailVerificationTtlHours * 60 * 60 * 1000
  });

  await notify(user.id, {
    type: NOTIFICATION_TYPE.EMAIL_VERIFICATION,
    title: 'Verify your email',
    message: `Use code ${code} to verify your email address.`,
    channels: [NOTIFICATION_CHANNEL.EMAIL],
    resourceType: RESOURCE_TYPE.USER,
    resourceId: user.id,
    data: { code }
  });

  return { message: genericMessage };
};

/** Changes the password for an authenticated user. */
const changePassword = async ({ userId, currentPassword, newPassword }) => {
  const user = await User.scope('withPassword').findByPk(userId);
  if (!user) throw AppError.notFound('Account not found.');

  const ok = await user.verifyPassword(currentPassword);
  if (!ok) throw AppError.badRequest('Current password is incorrect.');

  await user.setPassword(newPassword);
  await user.save();

  await logoutAllSessions(user.id);

  await notify(user.id, {
    type: NOTIFICATION_TYPE.PASSWORD_CHANGED,
    title: 'Password changed',
    message: 'Your password was changed successfully. All other sessions have been logged out.',
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    resourceType: RESOURCE_TYPE.USER,
    resourceId: user.id
  });

  return user.toPublicJSON();
};

module.exports = {
  register,
  registerAdmin,
  login,
  logout,
  logoutAllSessions,
  refreshTokens,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  changePassword,
  clientMeta
};