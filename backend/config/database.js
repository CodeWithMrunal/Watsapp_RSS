module.exports = {
  development: {
    username: process.env.DB_USERNAME || 'mrunal.a',
    password: process.env.DB_PASSWORD || 'Mrunal2004',
    database: process.env.DB_NAME || 'whatsapp_monitor_dev',
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false 
  },
  test: {
    username: process.env.DB_USERNAME || 'mrunal.a',
    password: process.env.DB_PASSWORD || 'Mrunal2004',
    database: process.env.DB_NAME_TEST || 'whatsapp_monitor_test',
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false 
  },
  production: {
    username: process.env.DB_USERNAME || 'mrunal.a',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'whatsapp_monitor_prod',
    host: process.env.DB_HOST || 'postgres',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false 
  }
};