'use strict';

/**
 * Brevo transactional email service.
 *
 * Uses the Brevo REST API v3. Emails are intentionally never awaited by
 * callers — `send` catches all failures and only logs them, so a slow or
 * failing email provider can never crash a main request. Designed so this
 * file can be swapped for a queue worker later without touching callers.
 */
const config = require('../config');
const logger = require('../utils/logger');
const { escapeHtml } = require('../utils/sanitize');

const BREVO_ENDPOINT = `${config.brevo.apiUrl}/smtp/email`;

const isEnabled = () => config.brevo.enabled && Boolean(config.brevo.apiKey);

/** Wraps content in the shared branded layout. */
const layout = (title, bodyHtml) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:#4a0e0e;padding:20px 28px;">
              <span style="color:#ffffff;font-size:20px;font-weight:bold;">eWinery</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px;border-top:1px solid #eee;color:#888;font-size:12px;">
              &copy; ${new Date().getFullYear()} eWinery. Thank you for shopping with us.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const paragraph = text => `<p style="font-size:15px;line-height:1.6;color:#333;">${escapeHtml(text)}</p>`;

const heading = text => `<h2 style="color:#4a0e0e;font-size:18px;margin:0 0 16px;">${escapeHtml(text)}</h2>`;

const button = (url, label) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="background:#4a0e0e;border-radius:8px;">
        <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>
`;

const codeBlock = code => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="background:#f6f5f2;border-radius:8px;padding:20px 28px;letter-spacing:4px;font-size:24px;font-weight:bold;color:#4a0e0e;">
        ${escapeHtml(String(code))}
      </td>
    </tr>
  </table>
`;

const listItem = (label, value) => `
  <tr>
    <td style="padding:6px 12px;color:#888;font-size:13px;">${escapeHtml(label)}</td>
    <td style="padding:6px 12px;color:#333;font-size:14px;font-weight:bold;">${escapeHtml(String(value))}</td>
  </tr>
`;

const formatNaira = value => `₦${Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

const orderDetails = (params = {}) => {
  const items = Array.isArray(params.items) ? params.items : [];
  const itemRows = items.map(item => `
    <tr>
      <td style="padding:8px 12px;color:#333;font-size:14px;">${escapeHtml(item.name)}</td>
      <td style="padding:8px 12px;color:#333;font-size:14px;text-align:center;">${escapeHtml(String(item.quantity))}</td>
      <td style="padding:8px 12px;color:#333;font-size:14px;text-align:right;">${formatNaira(item.lineTotal)}</td>
    </tr>
  `).join('');

  const summaryRows = [
    ['Subtotal', formatNaira(params.subtotal)],
    ['Delivery fee', formatNaira(params.deliveryFee)],
    ...(Number(params.discount || 0) > 0 ? [['Discount', `- ${formatNaira(params.discount)}`]] : []),
    ['Total', formatNaira(params.totalAmount)]
  ].map(([label, value]) => listItem(label, value)).join('');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      ${params.customerName ? listItem('Customer', params.customerName) : ''}
      ${params.customerEmail ? listItem('Email', params.customerEmail) : ''}
      ${params.customerPhone ? listItem('Phone', params.customerPhone) : ''}
      ${listItem('Order number', params.orderNumber)}
      ${params.addressLine ? listItem('Ship to', params.addressLine) : ''}
    </table>
    <h3 style="color:#4a0e0e;font-size:15px;margin:24px 0 8px;">Items</h3>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #eee;">
      <tr>
        <th style="padding:8px 12px;background:#f6f5f2;color:#888;font-size:12px;text-align:left;">Item</th>
        <th style="padding:8px 12px;background:#f6f5f2;color:#888;font-size:12px;text-align:center;">Qty</th>
        <th style="padding:8px 12px;background:#f6f5f2;color:#888;font-size:12px;text-align:right;">Total</th>
      </tr>
      ${itemRows || '<tr><td colspan="3" style="padding:12px;color:#888;font-size:13px;">No items recorded.</td></tr>'}
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:8px;">
      ${summaryRows}
      ${params.status ? listItem('Payment', params.status) : ''}
    </table>
  `;
};

/**
 * Renders a typed email message into { subject, html }.
 */
const render = (type, params = {}) => {
  const { name = 'there', code, token, orderNumber, amount, url = config.app.clientUrl } = params;

  switch (type) {
    case 'welcome':
      return {
        subject: 'Welcome to eWinery 🍷',
        html: layout('Welcome to eWinery', `
          ${heading(`Welcome, ${name}!`) }
          ${paragraph('Your account has been created successfully. We are thrilled to have you join the eWinery family.')}
          ${button(`${config.app.clientUrl}/login`, 'Start Shopping')}
        `)
      };
    case 'email_verification':
      return {
        subject: 'Verify your email address',
        html: layout('Verify your email', `
          ${heading('Verify your email address')}
          ${paragraph(`Hi ${name}, please use the code below to verify your email address. It expires in ${config.security.emailVerificationTtlMinutes} minutes.`)}
          ${codeBlock(code)}
        `)
      };
    case 'password_reset':
      return {
        subject: 'Reset your password',
        html: layout('Reset your password', `
          ${heading('Password reset code')}
          ${paragraph(`Hi ${name}, we received a request to reset your password. Use the 6-digit code below. It expires in ${config.security.passwordResetTtlMinutes} minutes.`)}
          ${codeBlock(code)}
          ${paragraph('If you did not request this, you can safely ignore this email.')}
        `)
      };
    case 'password_changed':
      return {
        subject: 'Your password was changed',
        html: layout('Password changed', `
          ${heading('Security notice')}
          ${paragraph(`Hi ${name}, your password was recently changed. If this was not you, please contact support immediately.`)}
        `)
      };
    case 'login_alert':
      return {
        subject: 'New sign-in to your eWinery account',
        html: layout('New sign-in', `
          ${heading('New sign-in detected')}
          ${paragraph(`Hi ${name}, we detected a new sign-in to your eWinery account.`)}
          ${params.ipAddress ? paragraph(`IP address: ${params.ipAddress}`) : ''}
          ${params.userAgent ? paragraph(`Device: ${params.userAgent}`) : ''}
          ${paragraph('If this was you, no further action is needed. If you did not recognise this sign-in, please change your password and contact support immediately.')}
          ${button(`${config.app.clientUrl}/settings`, 'Review account security')}
        `)
      };
    case 'email_verified':
      return {
        subject: 'Email verified',
        html: layout('Email verified', `
          ${heading('Your email has been verified')}
          ${paragraph(`Thanks, ${name}! Your eWinery account email is now verified.`)}
        `)
      };
    case 'order_confirmation':
      return {
        subject: `Order ${orderNumber || ''} confirmed`,
        html: layout('Order confirmation', `
          ${heading('Your order is confirmed')}
          ${paragraph(`Hi ${name}, your order has been received and is awaiting payment.`)}
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
            ${listItem('Order number', orderNumber)}
            ${listItem('Amount', amount)}
          </table>
          ${url ? button(url, 'Complete Payment & Track Order') : ''}
        `)
      };
    case 'payment_success':
      return {
        subject: `Payment received for order ${orderNumber || ''}`,
        html: layout('Payment received', `
          ${heading('Payment successful')}
          ${paragraph(`Hi ${name}, we have received your payment.`)}
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
            ${listItem('Order number', orderNumber)}
            ${listItem('Amount paid', amount)}
            ${listItem('Status', 'Paid')}
          </table>
          ${button(`${config.app.clientUrl}/orders`, 'View your order')}
        `)
      };
    case 'payment_failed':
      return {
        subject: `Payment failed for order ${orderNumber || ''}`,
        html: layout('Payment failed', `
          ${heading('We could not process your payment')}
          ${paragraph(`Hi ${name}, the payment for order ${orderNumber} could not be completed. Please try again.`)}
          ${button(`${config.app.clientUrl}/payment`, 'Retry payment')}
        `)
      };
    case 'order_status':
      return {
        subject: `Order ${orderNumber || ''} is now ${params.status || ''}`,
        html: layout('Order status update', `
          ${heading('Order status update')}
          ${paragraph(`Hi ${name}, your order ${orderNumber} status is now: ${params.status}.`)}
          ${button(`${config.app.clientUrl}/orders`, 'Track your order')}
        `)
      };
    case 'order_delivered':
      return {
        subject: `Order ${orderNumber || ''} has been delivered`,
        html: layout('Order delivered', `
          ${heading('Your order has been delivered 🎉')}
          ${paragraph(`Hi ${name}, we hope you enjoy your drinks! Please take a moment to review your products.`)}
          ${button(`${config.app.clientUrl}/orders`, 'Review your order')}
        `)
      };
    case 'order_completed':
      return {
        subject: `Order ${orderNumber || ''} completed`,
        html: layout('Order completed', `
          ${heading('Thank you for shopping with eWinery')}
          ${paragraph(`Hi ${name}, your order ${orderNumber} has been completed. We hope to see you again soon!`)}
        `)
      };
    case 'support_ticket':
      return {
        subject: `Support ticket ${params.ticketNumber || ''} created`,
        html: layout('Support ticket', `
          ${heading('We have received your ticket')}
          ${paragraph(`Hi ${name}, ticket ${params.ticketNumber} has been created. Our team will get back to you shortly.`)}
        `)
      };
    case 'support_reply':
      return {
        subject: `New reply on ticket ${params.ticketNumber || ''}`,
        html: layout('Support reply', `
          ${heading('You have a new reply')}
          ${paragraph(`There is a new reply on your support ticket ${params.ticketNumber}.`)}
          ${button(`${config.app.clientUrl}/support`, 'View conversation')}
        `)
      };
    case 'coupon': {
      const formatAmount = value => `₦${Number(value || 0).toLocaleString('en-NG')}`;
      return {
        subject: params.subject || 'You have a new coupon from eWinery 🎉',
        html: layout('New coupon', `
          ${heading('You have a coupon!')}
          ${paragraph(`Hi ${name}, use the code below to save ${formatAmount(params.amount)} on your next order.`)}
          ${codeBlock(params.couponCode)}
          ${params.expiresAt ? paragraph(`This coupon is valid until ${params.expiresAt}.`) : ''}
          ${button(`${config.app.clientUrl}/checkout`, 'Shop now')}
        `)
      };
    }
    case 'order_receipt':
      return {
        subject: `Your eWinery receipt for order ${params.orderNumber || ''}`,
        html: layout('Order receipt', `
          ${heading('Thank you for your order')}
          ${paragraph(`Hi ${params.customerName || 'there'}, here is the receipt for order ${params.orderNumber}.`)}
          ${orderDetails(params)}
          ${params.orderId ? button(`${config.app.clientUrl}/orders/${params.orderId}`, 'View your order') : ''}
        `)
      };
    case 'admin_order_alert':
      return {
        subject: params.subject || `Order ${params.orderNumber || ''} received — eWinery`,
        html: layout('Order alert', `
          ${heading(params.title || 'New order received')}
          ${paragraph(params.message || 'A new order has been placed. Details below:')}
          ${orderDetails(params)}
        `)
      };
    case 'admin_alert':
      return {
        subject: params.subject || 'eWinery admin notification',
        html: layout('Admin notification', `
          ${heading(params.title || 'Admin notification')}
          ${paragraph(params.message || '')}
        `)
      };
    default:
      return {
        subject: params.subject || 'eWinery',
        html: layout(params.title || 'Notification', paragraph(params.message || ''))
      };
  }
};

/**
 * @param {object} options
 * @param {string} options.to  Recipient email.
 * @param {string} options.type  Template key.
 * @param {object} [options.params]  Template variables.
 * @returns {Promise<boolean>} Resolves false when emailing is disabled or failed.
 */
const send = async ({ to, type, params = {} }) => {
  if (!isEnabled()) {
    logger.debug('Email skipped (disabled or missing API key)', { to, type });
    return false;
  }
  if (!to) return false;

  const { subject, html } = render(type, params);
  const body = {
    sender: {
      name: config.brevo.senderName,
      email: config.brevo.senderEmail
    },
    to: [{ email: to, name: params.name || '' }],
    subject,
    htmlContent: html
  };

  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': config.brevo.apiKey,
        Accept: 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.error('Brevo send failed', { to, type, status: response.status, detail: detail.slice(0, 500) });
      return false;
    }
    logger.debug('Email sent', { to, type });
    return true;
  } catch (err) {
    logger.warn('Email send error', { to, type, message: err.message });
    return false;
  }
};

/** Fire-and-forget wrapper for callers that don't need the result. */
const sendAsync = (options) => {
  // Never block the request; failures are handled inside send().
  Promise.resolve(send(options)).catch(() => {});
};

module.exports = { send, sendAsync, render };