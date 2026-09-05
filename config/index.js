/**
 * Centralized application configuration.
 *
 * Every secret and tunable is read from the environment here — nothing
 * elsewhere in the codebase should touch `process.env` directly.
 */
require('dotenv').config();

const env = process.env.NODE_ENV || 'development';

const toInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const toFloat = (value, fallback) => {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const toList = (value, fallback = []) => {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

const config = {
  env,
  isProduction: env === 'production',
  isDevelopment: env === 'development',
  isTest: env === 'test',

  app: {
    name: process.env.APP_NAME || 'eWinery',
    port: toInt(process.env.PORT, 9200),
    apiPrefix: process.env.API_PREFIX || '/',
    // Public URL of this API (used to build webhook/callback URLs)
    url: process.env.APP_URL || `http://localhost:${toInt(process.env.PORT, 9200)}`,
    // Frontend URL (used to build links inside emails)
    clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
    supportEmail: process.env.SUPPORT_EMAIL || 'support@ewinery.com',
    trustProxy: toBool(process.env.TRUST_PROXY, false)
  },

  cors: {
    // Empty list => reflect any origin (development convenience only)
    origins: toList(process.env.CORS_ORIGINS),
    credentials: true
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    issuer: process.env.JWT_ISSUER || 'ewinery-api',
    audience: process.env.JWT_AUDIENCE || 'ewinery-client',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '30m',
    refreshExpiresInDays: toInt(process.env.JWT_REFRESH_EXPIRES_DAYS, 30)
  },

  security: {
    bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, 12),
    passwordMinLength: toInt(process.env.PASSWORD_MIN_LENGTH, 6),
    passwordResetTtlMinutes: toInt(process.env.PASSWORD_RESET_TTL_MINUTES, 15),
    passwordResetMaxAttempts: toInt(process.env.PASSWORD_RESET_MAX_ATTEMPTS, 5),
    emailVerificationTtlHours: toInt(process.env.EMAIL_VERIFICATION_TTL_HOURS, 24),
    maxSessionsPerUser: toInt(process.env.MAX_SESSIONS_PER_USER, 10),
    // Require a verified email address before checkout is allowed
    requireVerifiedEmailForCheckout: toBool(process.env.REQUIRE_VERIFIED_EMAIL_FOR_CHECKOUT, false)
  },

  rateLimit: {
    enabled: toBool(process.env.RATE_LIMIT_ENABLED, true),
    globalWindowMinutes: toInt(process.env.RATE_LIMIT_WINDOW_MINUTES, 15),
    globalMax: toInt(process.env.RATE_LIMIT_MAX, 600),
    authMax: toInt(process.env.RATE_LIMIT_AUTH_MAX, 10),
    passwordResetMax: toInt(process.env.RATE_LIMIT_PASSWORD_RESET_MAX, 5),
    writeMax: toInt(process.env.RATE_LIMIT_WRITE_MAX, 120)
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    folder: process.env.CLOUDINARY_FOLDER || 'ewinery',
    maxFileSizeMb: toInt(process.env.UPLOAD_MAX_FILE_SIZE_MB, 5),
    maxFilesPerRequest: toInt(process.env.UPLOAD_MAX_FILES, 5)
  },

  brevo: {
    apiKey: process.env.BREVO_API_KEY,
    apiUrl: process.env.BREVO_API_URL || 'https://api.brevo.com/v3',
    senderName: process.env.BREVO_SENDER_NAME || process.env.APP_NAME || 'eWinery',
    senderEmail: process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_USER,
    replyToEmail: process.env.BREVO_REPLY_TO || process.env.SUPPORT_EMAIL,
    enabled: toBool(process.env.EMAIL_ENABLED, true)
  },

  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    publicKey: process.env.PAYSTACK_PUBLIC_KEY,
    baseUrl: process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co',
    // Where Paystack redirects the customer after payment
    callbackUrl: process.env.PAYSTACK_CALLBACK_URL || `${process.env.CLIENT_URL || 'http://localhost:3000'}/payment/callback`,
    timeoutMs: toInt(process.env.PAYSTACK_TIMEOUT_MS, 20000)
  },

  store: {
    currency: process.env.STORE_CURRENCY || 'NGN',
    deliveryFee: toFloat(process.env.DELIVERY_FEE, 1500),
    freeDeliveryThreshold: toFloat(process.env.FREE_DELIVERY_THRESHOLD, 50000),
    lowStockThreshold: toInt(process.env.LOW_STOCK_THRESHOLD, 5),
    maxCartItemQuantity: toInt(process.env.MAX_CART_ITEM_QUANTITY, 50)
  },

  pagination: {
    defaultLimit: toInt(process.env.PAGINATION_DEFAULT_LIMIT, 20),
    maxLimit: toInt(process.env.PAGINATION_MAX_LIMIT, 100),
    reviewsLimit: toInt(process.env.REVIEWS_PAGE_LIMIT, 3)
  }
};

/**
 * Fail fast on missing critical secrets. Called during server bootstrap so a
 * misconfigured deployment never starts serving traffic with broken auth.
 */
const REQUIRED_ALWAYS = [['JWT_SECRET', config.jwt.secret]];

const REQUIRED_IN_PRODUCTION = [
  ['CLOUDINARY_CLOUD_NAME', config.cloudinary.cloudName],
  ['CLOUDINARY_API_KEY', config.cloudinary.apiKey],
  ['CLOUDINARY_API_SECRET', config.cloudinary.apiSecret],
  ['PAYSTACK_SECRET_KEY', config.paystack.secretKey],
  ['BREVO_API_KEY', config.brevo.apiKey],
  ['BREVO_SENDER_EMAIL', config.brevo.senderEmail]
];

config.validate = () => {
  const missing = [];
  const warnings = [];

  REQUIRED_ALWAYS.forEach(([key, value]) => {
    if (!value) missing.push(key);
  });

  REQUIRED_IN_PRODUCTION.forEach(([key, value]) => {
    if (value) return;
    if (config.isProduction) missing.push(key);
    else warnings.push(key);
  });

  if (config.jwt.secret && config.jwt.secret.length < 32) {
    const message = 'JWT_SECRET should be at least 32 characters long';
    if (config.isProduction) missing.push(message);
    else warnings.push(message);
  }

  if (missing.length) {
    throw new Error(`Invalid configuration — missing/insecure: ${missing.join(', ')}`);
  }

  return { warnings };
};

module.exports = config;
