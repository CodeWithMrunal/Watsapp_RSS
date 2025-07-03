module.exports = {
  // Database type: 'postgresql' or 'mongodb'
  type: process.env.DB_TYPE || 'postgresql',
  
  // PostgreSQL Configuration
  postgresql: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    name: process.env.DB_NAME || 'whatsappmonitor',
    user: process.env.DB_USER || 'mrunal',
    password: process.env.DB_PASSWORD || 'Mrunal2004',
    maxConnections: process.env.DB_MAX_CONNECTIONS || 10,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  },
  
  // MongoDB Configuration
  mongodb: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 27017,
    name: process.env.DB_NAME || 'whatsapp_monitor',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    connectionString: process.env.MONGODB_URI,
    maxConnections: process.env.DB_MAX_CONNECTIONS || 10
  }
};
