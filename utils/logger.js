/**
 * Minimal levelled logger.
 *
 * Emits single-line JSON in production (easy to ship to a log aggregator) and
 * readable text in development. Kept dependency free on purpose; swapping in
 * pino/winston later only requires changing this file.
 */
const config = require('../config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const activeLevel = LEVELS[process.env.LOG_LEVEL] !== undefined
  ? LEVELS[process.env.LOG_LEVEL]
  : (config.isProduction ? LEVELS.info : LEVELS.debug);

/** Keys whose values must never reach the logs. */
const REDACTED_KEYS = [
  'password', 'newpassword', 'currentpassword', 'confirmpassword',
  'token', 'accesstoken', 'refreshtoken', 'authorization', 'otp',
  'secret', 'apikey', 'api_key', 'secretkey', 'signature', 'cookie'
];

const redact = value => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);

  return Object.entries(value).reduce((acc, [key, val]) => {
    acc[key] = REDACTED_KEYS.includes(key.toLowerCase()) ? '[REDACTED]' : redact(val);
    return acc;
  }, {});
};

const write = (level, message, meta) => {
  if (LEVELS[level] > activeLevel) return;

  const payload = meta === undefined ? undefined : redact(meta);
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (config.isProduction) {
    target(JSON.stringify({
      level,
      time: new Date().toISOString(),
      message,
      ...(payload !== undefined && { meta: payload })
    }));
    return;
  }

  const icons = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ', debug: '🐛' };
  target(
    `${icons[level]} [${new Date().toISOString()}] ${message}`,
    ...(payload !== undefined ? [payload] : [])
  );
};

module.exports = {
  error: (message, meta) => write('error', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  info: (message, meta) => write('info', message, meta),
  debug: (message, meta) => write('debug', message, meta)
};
