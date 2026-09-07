'use strict';

/** Notification controllers. */
const notificationService = require('../services/notification.service');
const { ok } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const pagination = require('../utils/pagination');

const listNotifications = asyncHandler(async (req, res) => {
  const paging = pagination.resolve(req.query);
  const result = await notificationService.listForUser({
    userId: req.user.id,
    page: paging.page,
    limit: paging.limit,
    unreadOnly: req.query.unreadOnly === true
  });
  return ok(res, 'Notifications retrieved.', pagination.format(result, paging, 'notifications'));
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markRead({
    notificationId: req.params.id,
    userId: req.user.id
  });
  return ok(res, 'Notification marked as read.', { notification });
});

const markAllRead = asyncHandler(async (req, res) => {
  await notificationService.markAllRead(req.user.id);
  return ok(res, 'All notifications marked as read.');
});

const getCounts = asyncHandler(async (req, res) => {
  const counts = await notificationService.getCounts(req.user.id);
  return ok(res, 'Notification counts retrieved.', counts);
});

module.exports = { listNotifications, markRead, markAllRead, getCounts };