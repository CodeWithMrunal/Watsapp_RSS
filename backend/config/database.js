module.exports = {
  development: {
    dialect: 'sqlite',
    storage: './database/whatsapp_monitor.sqlite',
    logging: console.log, // Set to false to disable SQL logging
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true
    }
  },
  production: {
    dialect: 'postgres', 
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'whatsapp_monitor',
    username: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'password',
    logging: false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true
    }
  }
};