const { Sequelize } = require('sequelize');
const config = require('../config/database');
const fs = require('fs-extra');
const path = require('path');

// Initialize Sequelize
const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

// Ensure database directory exists
if (dbConfig.storage) {
  fs.ensureDirSync(path.dirname(dbConfig.storage));
}

const sequelize = new Sequelize({
  ...dbConfig,
  retry: {
    max: 3
  }
});

// Enable foreign key constraints for SQLite
if (dbConfig.dialect === 'sqlite') {
  sequelize.query('PRAGMA foreign_keys = ON;');
}

// Test connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
    process.exit(1);
  }
};

// Initialize models with better error handling
const initializeModels = () => {
  const models = {};
  
  // Import all models
  const modelFiles = [
    'Message',
    'Media', 
    'MessageGroup',
    'Author',
    'Url',
    'Keyword',
    'MessageUrl',
    'MessageKeyword',
    'GroupStatistic'
  ];

  modelFiles.forEach(file => {
    try {
      console.log(`Loading model: ${file}`);
      const modelPath = path.join(__dirname, 'models', file);
      console.log(`Model path: ${modelPath}`);
      
      // Check if file exists
      if (!fs.existsSync(`${modelPath}.js`)) {
        console.error(`❌ Model file not found: ${modelPath}.js`);
        throw new Error(`Model file not found: ${file}.js`);
      }
      
      const modelDefiner = require(modelPath);
      console.log(`Type of ${file} export:`, typeof modelDefiner);
      
      if (typeof modelDefiner !== 'function') {
        console.error(`❌ Model ${file} does not export a function`);
        throw new Error(`Model ${file} must export a function`);
      }
      
      const model = modelDefiner(sequelize, Sequelize.DataTypes);
      models[model.name] = model;
      console.log(`✅ Loaded model: ${model.name}`);
    } catch (error) {
      console.error(`❌ Error loading model ${file}:`, error);
      throw error;
    }
  });

  // Run associations
  Object.keys(models).forEach(modelName => {
    if (models[modelName].associate) {
      models[modelName].associate(models);
    }
  });

  return models;
};

// Sync database
const syncDatabase = async (force = false) => {
  try {
    // Only use alter in development when explicitly needed
    const syncOptions = {
      force: force,
      alter: false,// Don't alter tables by default
      // Add this to handle external schema changes
      hooks: {
        beforeSync: async () => {
          // Check for columns added by external scripts
          const queryInterface = sequelize.getQueryInterface();
          const tableDescription = await queryInterface.describeTable('urls').catch(() => ({}));
          
          console.log('📊 Current urls table structure:', Object.keys(tableDescription));
        }
      }
    };
    
    await sequelize.sync(syncOptions);
    console.log(`✅ Database synchronized ${force ? '(forced)' : ''}`);
  } catch (error) {
    console.error('❌ Error synchronizing database:', error);
    throw error;
  }
};

module.exports = {
  sequelize,
  testConnection,
  initializeModels,
  syncDatabase,
  Sequelize
};