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
const { Op } = require('sequelize');
const config = require('../config');
const { ROLES } = require('../config/constants');
const AppError = require('../utils/AppError');
const { randomToken, numericOtp, safeEqual } = require('../utils/tokens');
const { buildConsentRecord } = require('../utils/consent');
const { sequelize, User, AuthToken } = require('../models');
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

/** Thrown when an unverified account tries to obtain a session. */
const emailNotVerified = () => new AppError('Please verify your email to continue.', 403, { code: 'EMAIL_NOT_VERIFIED' });

/**
 * Issues a session for an authenticated user and stamps lastLoginAt.
 * Shared by login and email verification so both return the same payload
 * with the same token lifetimes.
 */
const startSession = async (user, { ipAddress, userAgent } = {}) => {
  const tokens = await issueTokens(user, { ipAddress, userAgent });
  await user.update({ lastLoginAt: new Date() });
  return { user: user.toPublicJSON(), ...tokens };
};

/** Email-verification code lifetime in ms (config is clamped to 10–15 min). */
const verificationTtlMs = () => config.security.emailVerificationTtlMinutes * 60 * 1000;

/** Sends a verification code email. */
const sendVerificationCode = (user, code) => notify(user.id, {
  type: NOTIFICATION_TYPE.EMAIL_VERIFICATION,
  title: 'Verify your email',
  message: `Use code ${code} to verify your email address. It expires in ${config.security.emailVerificationTtlMinutes} minutes.`,
  channels: [NOTIFICATION_CHANNEL.EMAIL],
  resourceType: RESOURCE_TYPE.USER,
  resourceId: user.id,
  data: { code }
});

/**
 * Registers a new account.
 *  - Role defaults to USER; only the key-gated admin route may request ADMIN.
 *  - Sends welcome + email-verification emails and notifies all admins.
 */
const register = async ({ fullName, email, phone, password, termsVersion, ipAddress, userAgent, role } = {}) => {
  const existing = await User.findOne({ where: { email } });
  if (existing) throw AppError.conflict('An account with this email already exists.');

  const finalRole = role && ROLES[role] === role ? role : ROLES.USER;
  const hadAdmins = (await User.count({ where: { role: ROLES.ADMIN } })) > 0;

  // Consent (acceptedTerms/ageConfirmed === true) is enforced at the route by
  // requireLegalConsent; timestamps here are always server-side.
  const consent = termsVersion ? buildConsentRecord({ termsVersion, ipAddress, userAgent }) : {};
  const user = User.build({ fullName, email, phone, role: finalRole, ...consent });
  await user.setPassword(password);

  try {
    await user.save();
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError' || err.name === 'SequelizeValidationError') {
      throw AppError.conflict('An account with this email already exists.');
    }
    throw err;
  }

  // Email verification OTP (10–15 min, single use).
  const { rawToken: verifyCode } = await createAuthToken({
    userId: user.id,
    type: EMAIL_VERIFICATION,
    ttlMs: verificationTtlMs(),
    ipAddress,
    userAgent
  });

  const publicUser = user.toPublicJSON();

  // Welcome + verification emails (fire-and-forget, never block response).
  await notify(user.id, {
    type: NOTIFICATION_TYPE.WELCOME,
    title: 'Welcome to eWinery',
    message: 'Explore our collection of fine wines.',
    channels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    resourceType: RESOURCE_TYPE.USER,
    resourceId: user.id
  });

  await sendVerificationCode(user, verifyCode);

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
const login = async ({ email, phone, password, ipAddress, userAgent }) => {
  const identifier = email ? { email } : { phone };
  const user = await User.scope('withPassword').findOne({ where: identifier });
  const passwordOk = user && (await user.verifyPassword(password));
  if (!user || !passwordOk) {
    throw AppError.unauthorized('Invalid email, phone number, or password.');
  }
  if (!user.isActive) {
    throw AppError.unauthorized('This account has been deactivated. Contact support.');
  }
  // Checked only after the password matched, so it never reveals whether an
  // email is registered. No tokens are issued.
  if (!user.isEmailVerified()) throw emailNotVerified();

  const session = await startSession(user, { ipAddress, userAgent });

  await notify(user.id, {
    type: NOTIFICATION_TYPE.LOGIN_ALERT,
    title: 'New sign-in to your account',
    message: 'We noticed a new sign-in to your eWinery account.',
    channels: [NOTIFICATION_CHANNEL.EMAIL],
    resourceType: RESOURCE_TYPE.USER,
    resourceId: user.id,
    data: { ipAddress: ipAddress || null, userAgent: userAgent || null }
  });

  return session;
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
  if (!user.isEmailVerified()) throw emailNotVerified();

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

const invalidCode = () => AppError.badRequest('Invalid or expired verification code.', { code: 'INVALID_VERIFICATION_CODE' });
const codeExpired = () => AppError.badRequest('This verification code has expired. Please request a new code.', { code: 'VERIFICATION_CODE_EXPIRED' });
const tooManyAttempts = () => AppError.badRequest('Too many incorrect attempts. Please request a new code.', { code: 'TOO_MANY_ATTEMPTS' });

/**
 * Confirms an email address with the 6-digit code and starts a session
 * (same payload and token lifetimes as login).
 *
 *  - Only the newest outstanding code for that email is valid (resend voids older ones).
 *  - Each check first reserves an attempt atomically, so at most
 *    `emailVerificationMaxAttempts` guesses are ever compared per code — even
 *    under parallel requests. After that a new code is required.
 *  - Codes are stored as SHA-256 hashes and compared in constant time.
 *  - Single use: consumption is a conditional update, so two concurrent
 *    correct submissions cannot both succeed.
 */
const verifyEmail = async ({ email, token, ipAddress, userAgent }) => {
  const maxAttempts = config.security.emailVerificationMaxAttempts;

  const user = await User.findOne({ where: { email } });
  if (!user) throw invalidCode();

  const record = await AuthToken.findOne({
    where: { userId: user.id, type: EMAIL_VERIFICATION, consumedAt: null },
    order: [['createdAt', 'DESC']]
  });
  if (!record) throw invalidCode();
  if (record.expiresAt <= new Date()) throw codeExpired();

  const [reserved] = await AuthToken.update(
    { attempts: sequelize.literal('"attempts" + 1') },
    { where: { id: record.id, consumedAt: null, attempts: { [Op.lt]: maxAttempts } } }
  );
  if (!reserved) throw tooManyAttempts();

  if (!safeEqual(record.tokenHash, AuthToken.hashToken(token))) {
    if (record.attempts + 1 >= maxAttempts) throw tooManyAttempts();
    throw invalidCode();
  }

  if (!user.isActive) {
    throw AppError.unauthorized('This account has been deactivated. Contact support.');
  }

  const now = new Date();
  const [consumed] = await AuthToken.update(
    { consumedAt: now },
    { where: { id: record.id, consumedAt: null } }
  );
  if (!consumed) throw invalidCode();

  // Void any other outstanding verification codes for this account.
  await AuthToken.update(
    { consumedAt: now },
    { where: { userId: user.id, type: EMAIL_VERIFICATION, consumedAt: null } }
  );

  const firstVerification = !user.emailVerifiedAt;
  if (firstVerification) await user.update({ emailVerifiedAt: now });

  const session = await startSession(user, { ipAddress, userAgent });

  if (firstVerification) {
    await notify(user.id, {
      type: NOTIFICATION_TYPE.EMAIL_VERIFIED,
      title: 'Email verified',
      message: 'Your email address has been verified successfully.',
      channels: [NOTIFICATION_CHANNEL.EMAIL],
      resourceType: RESOURCE_TYPE.USER,
      resourceId: user.id
    });
  }

  return session;
};

/**
 * Resends the email verification code.
 *
 * Anti-enumeration: unknown and already-verified emails get the same generic
 * success message (and no email). Per-email limits for real accounts:
 * one code per `verificationResendCooldownSeconds`, and at most
 * `verificationResendMaxPerHour` codes per rolling hour (the code sent at
 * registration counts). Exceeding either returns 429 with retryAfterSeconds.
 */
const resendVerification = async ({ email, ipAddress, userAgent }) => {
  const genericMessage = 'If an account exists for this email, a verification code has been sent.';
  const user = await User.findOne({ where: { email } });
  if (!user || user.isEmailVerified()) return { message: genericMessage };

  const nowMs = Date.now();
  const hourMs = 60 * 60 * 1000;
  const cooldownMs = config.security.verificationResendCooldownSeconds * 1000;
  const maxPerHour = config.security.verificationResendMaxPerHour;

  const recent = await AuthToken.findAll({
    where: { userId: user.id, type: EMAIL_VERIFICATION, createdAt: { [Op.gte]: new Date(nowMs - hourMs) } },
    attributes: ['createdAt'],
    order: [['createdAt', 'DESC']]
  });

  const latest = recent[0];
  if (latest && nowMs - latest.createdAt.getTime() < cooldownMs) {
    const retryAfterSeconds = Math.ceil((latest.createdAt.getTime() + cooldownMs - nowMs) / 1000);
    throw AppError.tooManyRequests(`Please wait ${retryAfterSeconds} seconds before requesting a new code.`, {
      code: 'RESEND_COOLDOWN',
      details: { retryAfterSeconds }
    });
  }
  if (recent.length >= maxPerHour) {
    const oldest = recent[recent.length - 1];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest.createdAt.getTime() + hourMs - nowMs) / 1000));
    throw AppError.tooManyRequests('Too many verification codes requested. Please try again later.', {
      code: 'RESEND_LIMIT_REACHED',
      details: { retryAfterSeconds }
    });
  }

  // A new code voids every previous one.
  await AuthToken.update(
    { consumedAt: new Date() },
    { where: { userId: user.id, type: EMAIL_VERIFICATION, consumedAt: null } }
  );

  const { rawToken: code } = await createAuthToken({
    userId: user.id,
    type: EMAIL_VERIFICATION,
    ttlMs: verificationTtlMs(),
    ipAddress,
    userAgent
  });

  await sendVerificationCode(user, code);

  return { message: genericMessage };
};

/** Changes the password for an authenticated user. */
const changePassword = async ({ userId, currentPassword, newPassword }) => {
  if (!currentPassword || !newPassword) {
    throw AppError.badRequest('Current and new password are required.');
  }
  if (newPassword.length < 6) {
    throw AppError.unprocessable('New password must be at least 6 characters.');
  }
  if (currentPassword === newPassword) {
    throw AppError.unprocessable('New password must be different from the current one.');
  }

  const user = await User.scope('withPassword').findByPk(userId);
  if (!user) throw AppError.notFound('Account not found.');

  const ok = await user.verifyPassword(currentPassword);
  if (!ok) throw AppError.unauthorized('Current password is incorrect.');

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

  return { success: true, message: 'Password updated.' };
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