/**
 * Keep-alive job.
 *
 * Render's free tier spins a web service down after 15 minutes with no
 * inbound HTTP traffic. This job pings the service's own public URL on an
 * interval (default every 10 minutes) so it never goes idle long enough to
 * sleep. The request must go through the public URL — hitting localhost
 * would not count as inbound traffic for Render.
 */
const config = require('../config');
const logger = require('./logger');

let timer = null;

const ping = async url => {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ewinery-keep-alive' },
      signal: AbortSignal.timeout(30000)
    });
    logger.debug('Keep-alive ping', { url, status: res.status });
  } catch (err) {
    logger.warn('Keep-alive ping failed', { url, error: err.message });
  }
};

const start = () => {
  const { enabled, url, intervalMinutes } = config.keepAlive;
  if (!enabled || !url || timer) return;

  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
  timer = setInterval(() => ping(url), intervalMs);
  // Never keep the process alive on its own (lets graceful shutdown exit).
  timer.unref();

  logger.info(`Keep-alive enabled: pinging ${url} every ${intervalMinutes} min`);
};

const stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { start, stop };
