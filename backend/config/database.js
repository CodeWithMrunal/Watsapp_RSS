const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

// Create database directory if it doesn't exist
const dbDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize Sequelize with SQLite
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(dbDir, 'whatsapp_monitor.db'),
  logging: false, // Set to console.log to see SQL queries
  define: {
    timestamps: true,
    underscored: true, // Use snake_case for columns
  }
});

// Test the connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
  } catch (err) {
    console.error('❌ Unable to connect to the database:', err);
    throw err;
  }
};

// Call test connection
testConnection();

module.exports = sequelize;