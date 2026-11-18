'use strict';

/**
 * Admin email broadcast to every customer — durable and duplicate-safe.
 *
 * How it works
 *  1. Start: the broadcast row and one recipient row per eligible customer
 *     (active, verified email, role USER) are created in ONE transaction.
 *     A unique (broadcastId, userId) key means nobody is queued twice.
 *  2. Send: a worker claims the next batch (default 10) of PENDING rows with
 *     `FOR UPDATE SKIP LOCKED`, marks them SENDING, emails them, then marks
 *     each row SENT, RETRY (temporary failure, tried again later) or FAILED
 *     (permanent failure or out of attempts). Rows already SENT are never
 *     picked again, so nobody gets the same broadcast twice.
 *  3. Repeat with a short pause between batches until no row is PENDING /
 *     SENDING / RETRY, then the broadcast is COMPLETED.
 *  4. Resume: progress lives in the database. On server start (and every
 *     minute) the worker picks up any RUNNING broadcast where it stopped.
 *
 * Crash window: if the server dies after the email provider accepted a batch
 * but before the rows were marked SENT, those rows (at most one batch) are
 * still SENDING. After 5 minutes they are put back to PENDING and sent again —
 * so a crash can duplicate at most one batch, but never skips anyone.
 */
const { Op, QueryTypes } = require('sequelize');
const { sequelize, EmailBroadcast, EmailBroadcastRecipient } = require('../models');
const config = require('../config');
const { ROLES } = require('../config/constants');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const emailService = require('./email.service');

const B = EmailBroadcast.STATUS;
const R = EmailBroadcastRecipient.STATUS;

/** Retry delays after the 1st, 2nd, 3rd… failed attempt. */
const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const STALE_SENDING_MS = 5 * 60 * 1000;
const SAFETY_TICK_MS = 60 * 1000;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Arbitrary constant key for the "start a broadcast" advisory lock. */
const START_LOCK_KEY = 74210931;

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// --------------------------------------------------------------------------
// Worker
// --------------------------------------------------------------------------

let working = false;
let wakeTimer = null;
let safetyTimer = null;

/** Puts rows stuck in SENDING (server died mid-batch) back in the queue. */
const releaseStale = () => EmailBroadcastRecipient.update(
  { status: R.PENDING, claimedAt: null },
  { where: { status: R.SENDING, claimedAt: { [Op.lt]: new Date(Date.now() - STALE_SENDING_MS) } } }
);

/**
 * Atomically claims the next batch for a broadcast. SKIP LOCKED makes this
 * safe even if two server instances run the worker at the same time.
 */
const claimBatch = async broadcastId => sequelize.query(`
  UPDATE email_broadcast_recipients
     SET status = :sending, "claimedAt" = NOW(), attempts = attempts + 1, "updatedAt" = NOW()
   WHERE id IN (
     SELECT id FROM email_broadcast_recipients
      WHERE "broadcastId" = :broadcastId
        AND (status = :pending OR (status = :retry AND "nextAttemptAt" <= NOW()))
      ORDER BY "createdAt", id
      LIMIT :limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING id, email, name, attempts
`, {
  replacements: {
    broadcastId,
    sending: R.SENDING,
    pending: R.PENDING,
    retry: R.RETRY,
    limit: config.broadcast.batchSize
  },
  type: QueryTypes.SELECT
});

const sendBatch = async (broadcast, rows) => {
  const results = await Promise.all(rows.map(row => emailService.deliver({
    to: row.email,
    type: 'broadcast',
    params: { name: row.name, subject: broadcast.subject, content: broadcast.content }
  }).catch(err => ({ ok: false, retryable: true, error: err.message }))));

  const now = new Date();
  await Promise.all(rows.map((row, i) => {
    const result = results[i];
    if (result.ok) {
      return EmailBroadcastRecipient.update(
        { status: R.SENT, sentAt: now, lastError: null, nextAttemptAt: null, claimedAt: null },
        { where: { id: row.id, status: R.SENDING } }
      );
    }
    const canRetry = result.retryable && row.attempts < config.broadcast.maxAttempts;
    const delay = RETRY_DELAYS_MS[Math.min(row.attempts - 1, RETRY_DELAYS_MS.length - 1)];
    return EmailBroadcastRecipient.update({
      status: canRetry ? R.RETRY : R.FAILED,
      lastError: String(result.error || 'Unknown error').slice(0, 255),
      nextAttemptAt: canRetry ? new Date(now.getTime() + delay) : null,
      claimedAt: null
    }, { where: { id: row.id, status: R.SENDING } });
  }));
};

const scheduleWake = at => {
  if (wakeTimer) clearTimeout(wakeTimer);
  const delay = Math.max(1000, new Date(at).getTime() - Date.now());
  wakeTimer = setTimeout(() => { wakeTimer = null; kick(); }, delay);
  if (wakeTimer.unref) wakeTimer.unref();
};

/** Marks a broadcast COMPLETED once nothing is left to send. */
const completeIfDone = async broadcast => {
  const open = await EmailBroadcastRecipient.count({
    where: { broadcastId: broadcast.id, status: { [Op.in]: [R.PENDING, R.SENDING, R.RETRY] } }
  });
  if (open > 0) return false;
  const [updated] = await EmailBroadcast.update(
    { status: B.COMPLETED, completedAt: new Date() },
    { where: { id: broadcast.id, status: B.RUNNING } }
  );
  // Only the instance that actually flipped the status logs the summary.
  if (updated) {
    const counts = await countsFor(broadcast.id);
    logger.info('Email broadcast completed', { id: broadcast.id, ...counts });
  }
  return true;
};

const work = async () => {
  for (;;) {
    await releaseStale();
    const broadcast = await EmailBroadcast.findOne({
      where: { status: B.RUNNING },
      order: [['createdAt', 'ASC']]
    });
    if (!broadcast) return;

    const rows = await claimBatch(broadcast.id);
    if (rows.length) {
      await sendBatch(broadcast, rows);
      if (config.broadcast.batchPauseMs) await pause(config.broadcast.batchPauseMs);
      continue;
    }

    if (await completeIfDone(broadcast)) continue;

    // Nothing claimable right now: wait for the earliest retry (or for rows
    // another instance is sending / stale rows to be released).
    const nextRetry = await EmailBroadcastRecipient.min('nextAttemptAt', {
      where: { broadcastId: broadcast.id, status: R.RETRY }
    });
    scheduleWake(nextRetry || new Date(Date.now() + SAFETY_TICK_MS));
    return;
  }
};

/** Runs the worker unless it is already running in this process. */
const kick = () => {
  if (working) return;
  working = true;
  work()
    .catch(err => {
      logger.error('Email broadcast worker error', { message: err.message });
      scheduleWake(new Date(Date.now() + 30 * 1000));
    })
    .finally(() => { working = false; });
};

/** Called once at server start: resumes unfinished broadcasts and keeps a safety tick. */
const startWorker = () => {
  if (safetyTimer) return;
  kick();
  safetyTimer = setInterval(kick, SAFETY_TICK_MS);
  if (safetyTimer.unref) safetyTimer.unref();
};

const stopWorker = () => {
  if (safetyTimer) clearInterval(safetyTimer);
  if (wakeTimer) clearTimeout(wakeTimer);
  safetyTimer = null;
  wakeTimer = null;
};

// --------------------------------------------------------------------------
// Reads
// --------------------------------------------------------------------------

const countsFor = async broadcastId => {
  const rows = await EmailBroadcastRecipient.findAll({
    where: { broadcastId },
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
    group: ['status'],
    raw: true
  });
  const by = Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
  return {
    sent: by[R.SENT] || 0,
    pending: (by[R.PENDING] || 0) + (by[R.SENDING] || 0),
    retrying: by[R.RETRY] || 0,
    failed: by[R.FAILED] || 0
  };
};

const toJSON = async (broadcast, { withContent = false } = {}) => ({
  id: broadcast.id,
  subject: broadcast.subject,
  ...(withContent ? { content: broadcast.content } : {}),
  status: broadcast.status,
  total: broadcast.totalRecipients,
  ...(await countsFor(broadcast.id)),
  createdBy: broadcast.createdBy,
  createdAt: broadcast.createdAt,
  completedAt: broadcast.completedAt
});

const listBroadcasts = async ({ page = 1, limit = 20 }) => {
  const result = await EmailBroadcast.findAndCountAll({
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit
  });
  return { rows: await Promise.all(result.rows.map(b => toJSON(b))), count: result.count };
};

const getBroadcast = async ({ broadcastId, status, page = 1, limit = 50 }) => {
  const broadcast = await EmailBroadcast.findByPk(broadcastId);
  if (!broadcast) throw AppError.notFound('Broadcast not found.');

  const where = { broadcastId };
  if (status) where.status = status === 'PENDING' ? { [Op.in]: [R.PENDING, R.SENDING] } : status;
  const recipients = await EmailBroadcastRecipient.findAndCountAll({
    where,
    attributes: ['userId', 'email', 'name', 'status', 'attempts', 'lastError', 'nextAttemptAt', 'sentAt'],
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    offset: (page - 1) * limit,
    limit
  });
  return {
    broadcast: await toJSON(broadcast, { withContent: true }),
    recipients: recipients.rows.map(r => ({
      userId: r.userId,
      email: r.email,
      name: r.name,
      status: r.status === R.SENDING ? R.PENDING : r.status,
      attempts: r.attempts,
      lastError: r.lastError,
      nextAttemptAt: r.nextAttemptAt,
      sentAt: r.sentAt
    })),
    recipientCount: recipients.count
  };
};

// --------------------------------------------------------------------------
// Start
// --------------------------------------------------------------------------

/**
 * Queues a broadcast for every eligible customer and starts sending.
 * Refuses while another broadcast is running, or if the same subject +
 * content was already broadcast in the last 24 hours (accidental re-send).
 */
const startBroadcast = async ({ subject, content, adminId }) => {
  if (!emailService.isEnabled()) {
    throw AppError.serviceUnavailable('Email sending is not configured on this server.', { code: 'EMAIL_DISABLED' });
  }

  const broadcast = await sequelize.transaction(async transaction => {
    // Serializes concurrent "start" requests (double clicks, two admins).
    await sequelize.query('SELECT pg_advisory_xact_lock(:key)', {
      replacements: { key: START_LOCK_KEY },
      transaction
    });

    const running = await EmailBroadcast.findOne({ where: { status: B.RUNNING }, transaction });
    if (running) {
      throw AppError.conflict('Another email broadcast is still being sent. Please wait for it to finish.', {
        code: 'BROADCAST_IN_PROGRESS',
        details: { broadcastId: running.id }
      });
    }

    const duplicate = await EmailBroadcast.findOne({
      where: { subject, content, createdAt: { [Op.gte]: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
      transaction
    });
    if (duplicate) {
      throw AppError.conflict('This exact email was already broadcast in the last 24 hours.', {
        code: 'DUPLICATE_BROADCAST',
        details: { broadcastId: duplicate.id }
      });
    }

    const created = await EmailBroadcast.create({
      subject,
      content,
      status: B.RUNNING,
      createdBy: adminId || null
    }, { transaction });

    // Snapshot the audience in one statement; ON CONFLICT is a second guard
    // against queueing anyone twice.
    const [, inserted] = await sequelize.query(`
      INSERT INTO email_broadcast_recipients
        (id, "broadcastId", "userId", email, name, status, attempts, "createdAt", "updatedAt")
      SELECT gen_random_uuid(), :broadcastId, u.id, u.email, u."fullName", :pending, 0, NOW(), NOW()
        FROM users u
       WHERE u.role = :role
         AND u."isActive" = true
         AND u."emailVerifiedAt" IS NOT NULL
         AND u."deletedAt" IS NULL
      ON CONFLICT ("broadcastId", "userId") DO NOTHING
    `, {
      replacements: { broadcastId: created.id, pending: R.PENDING, role: ROLES.USER },
      transaction
    });

    const total = typeof inserted === 'number' ? inserted : await EmailBroadcastRecipient.count({
      where: { broadcastId: created.id }, transaction
    });
    if (!total) {
      throw AppError.unprocessable('There are no customers with a verified email to send to.', { code: 'NO_RECIPIENTS' });
    }
    await created.update({ totalRecipients: total }, { transaction });
    return created;
  });

  logger.info('Email broadcast started', { id: broadcast.id, adminId, total: broadcast.totalRecipients, subject });
  kick();
  return toJSON(broadcast);
};

module.exports = {
  startBroadcast,
  listBroadcasts,
  getBroadcast,
  startWorker,
  stopWorker,
  // exported for tests
  _kick: kick
};
