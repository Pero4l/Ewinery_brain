require('dotenv').config();

const dbConfig = {
  username: process.env.DB_USER || 'avnadmin',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'defaultdb',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  dialect: 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
    evict: 10000
  },
  connectionTimeoutMillis: 15000,
  dialectOptions: {
    ssl: process.env.DB_HOST && process.env.DB_HOST.includes('aivencloud.com') ? {
      require: true,
      rejectUnauthorized: false
    } : false,
    // Keep TCP alive so proxies/firewalls do not silently drop idle sockets.
    keepAlive: true
  }
};

module.exports = {
  development: dbConfig,
  test: dbConfig,
  production: dbConfig
};
