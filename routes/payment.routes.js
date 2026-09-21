'use strict';

const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { writeLimiter } = require('../middleware/rateLimiters');
const validators = require('../validators/payment.validator');

const escapeHtml = value => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

router.post('/initialize', protect, writeLimiter(), validate(validators.initializePayment), paymentController.initializePayment);
router.post('/guest/initialize', writeLimiter(), validate(validators.initializeGuestPayment), paymentController.initializeGuestPayment);
router.post('/guest/verify', writeLimiter(), validate(validators.verifyGuestPayment), paymentController.verifyGuestPayment);
router.get('/verify/:reference', protect, validate(validators.verifyPaymentParams, 'params'), paymentController.verifyPayment);
// Raw body route (mounted with express.raw in app.js before JSON parsing).
router.post('/webhook', paymentController.handleWebhook);
router.get('/transactions', protect, validate(validators.transactionQuery, 'query'), paymentController.listMyTransactions);

/**
 * Paystack redirects the customer here after payment (config.paystack.callbackUrl).
 * Serves a minimal page that lets the in-app browser hand control back to the app.
 * Query reflects what Paystack appends: ?reference=...&trxref=...
 */
router.get('/callback', (req, res) => {
  const reference = req.query.reference || req.query.trxref || '';
  res
    .status(200)
    .type('html')
    .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Payment complete — eWinery</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#7b2d26;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0;text-align:center;padding:24px;box-sizing:border-box}
    .card{max-width:420px;padding:32px;border-radius:20px;background:rgba(255,255,255,.12)}
    h1{font-size:22px;margin:0 0 8px} p{font-size:15px;line-height:1.5;opacity:.9;margin:0}
    .ref{font-size:13px;margin-top:16px;opacity:.7;font-family:ui-monospace,monospace}
  </style>
</head>
<body>
  <div class="card">
    <h1>Payment received</h1>
    <p>Your order is now being processed by eWinery.</p>
    <p>You can safely close this window and continue in the app.</p>
    ${reference ? `<div class="ref">${escapeHtml(String(reference))}</div>` : ''}
  </div>
  <script>
    try { if (window.opener) { window.opener.postMessage({ type: 'ewinery-payment-return' }, '*'); window.close(); } } catch (e) {}
    setTimeout(function () { try { window.close(); } catch (e) {} }, 2500);
  </script>
</body>
</html>`);
});

module.exports = router;