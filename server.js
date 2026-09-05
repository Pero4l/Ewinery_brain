require('dotenv').config();
const app = require('./app');
const db = require('./models');

const PORT = process.env.PORT || 9200;

async function startServer() {
  try {
    console.log('🔄 Connecting to Database...');
    const dbStatus = await db.testConnection();

    if (dbStatus.success) {
      console.log('✅ Database connected successfully to PostgreSQL (Aiven Cloud).');
    } else {
      console.error('❌ Database connection failed:', dbStatus.error);
    }

    const server = app.listen(PORT, () => {
      console.log(`🚀 eWinery Server listening on port http://localhost:${PORT}`);
      console.log(`🏥 Health check endpoint: http://localhost:${PORT}/health`);
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

  } catch (error) {
    console.error('Fatal startup error:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

startServer();
