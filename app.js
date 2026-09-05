'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const db = require('./models');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { globalLimiter } = require('./middleware/rateLimiters');

const app = express();

// Trust proxy when deployed behind a reverse proxy (rate limiting uses req.ip).
if (config.app.trustProxy) {
  app.set('trust proxy', true);
}

// Basic security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS
if (Array.isArray(config.cors.origins) && config.cors.origins.length) {
  app.use(cors({ origin: config.cors.origins, credentials: config.cors.credentials }));
} else {
  app.use(cors());
}

// Raw body stream ONLY for the Paystack webhook (signature verification).
// Must be registered before the JSON parser consumes the body.
app.post('/payments/webhook', express.raw({ type: '*/*', limit: '2mb' }));

// Strict JSON size cap
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global rate limiting (unless disabled for local development/tests).
if (config.rateLimit.enabled) {
  app.use(globalLimiter());
}

// Health check
app.get('/health', async (req, res) => {
  const dbStatus = await db.testConnection();
  const memoryUsage = process.memoryUsage();

  const healthData = {
    status: 'online',
    service: 'eWinery Store Backend API',
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString(),
    database: {
      connected: dbStatus.success,
      message: dbStatus.message || dbStatus.error
    },
    memory: {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`
    }
  };

  res.status(dbStatus.success ? 200 : 503).json(healthData);
});

// Root route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to eWinery Store API.',
    version: '1.0.0',
    documentation: '/health'
  });
});

// API routes
app.use(config.app.apiPrefix, require('./routes'));

// Not Found & Error Handling Middlewares
app.use(notFound);
app.use(errorHandler);


module.exports = app;