require('dotenv').config();
const config = require('./config');
const app = require('./app');
const db = require('./models');

const PORT = process.env.PORT || 9200;

config.validate();

const server = app.listen(PORT, () => {
  console.log(`🚀 eWinery Server listening on port http://localhost:${PORT}`);
  console.log(`🏥 Health check endpoint: http://localhost:${PORT}/health`);
});

// Connect to database AFTER the server is already listening so Render's
// proxy sees an open port immediately (prevents ERR_CONNECTION_CLOSED on
// free-tier cold starts where the DB handshake can take several seconds).
db.testConnection()
  .then((dbStatus) => {
    if (dbStatus.success) {
      console.log('✅ Database connected successfully to PostgreSQL (Aiven Cloud).');
    } else {
      console.error('❌ Database connection failed:', dbStatus.error);
    }
  })
  .catch((err) => {
    console.error('❌ Database connection error:', err);
  });

// Graceful Shutdown
const shutdown = async (signal) => {
  console.log(`\n⚠️ Received ${signal}. Shutting down server gracefully...`);
  server.close(async () => {
    console.log('🔌 HTTP Server closed.');
    try {
      await db.sequelize.close();
      console.log('🔌 Database connection closed.');
    } catch (err) {
      console.error('Error closing DB connection:', err);
    }
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
