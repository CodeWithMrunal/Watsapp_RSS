const mongoose = require('mongoose');
const config = require('../config');

class DatabaseConnection {
  constructor() {
    this.isConnected = false;
    this.connection = null;
  }

  async connect() {
    if (this.isConnected) {
      console.log('✅ Using existing MongoDB connection');
      return this.connection;
    }

    try {
      // MongoDB connection options from config
      const options = {
        ...config.database.mongodb.options,
        dbName: 'whatsapp-monitor'
      };

      // Connect to MongoDB
      this.connection = await mongoose.connect(
        config.database.mongodb.uri,
        options
      );

      this.isConnected = true;
      console.log('✅ MongoDB connected successfully');
      console.log(`   📍 Connected to: ${this.connection.connection.host}`);
      console.log(`   📊 Database: ${this.connection.connection.name}`);

      // Connection event handlers
      mongoose.connection.on('error', (error) => {
        console.error('❌ MongoDB connection error:', error);
        this.isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        console.log('⚠️  MongoDB disconnected');
        this.isConnected = false;
      });

      mongoose.connection.on('reconnected', () => {
        console.log('✅ MongoDB reconnected');
        this.isConnected = true;
      });

      // Graceful shutdown
      process.on('SIGINT', async () => {
        await this.disconnect();
        process.exit(0);
      });

      return this.connection;
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      this.isConnected = false;
      throw error;
    }
  }

  async disconnect() {
    if (!this.isConnected) {
      return;
    }

    try {
      await mongoose.connection.close();
      this.isConnected = false;
      console.log('✅ MongoDB disconnected gracefully');
    } catch (error) {
      console.error('❌ Error disconnecting from MongoDB:', error);
      throw error;
    }
  }

  getConnection() {
    if (!this.isConnected) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.connection;
  }

  async healthCheck() {
    try {
      if (!this.isConnected) {
        return { status: 'disconnected', error: 'Not connected to database' };
      }

      // Ping the database
      await mongoose.connection.db.admin().ping();

      // Get database stats
      const stats = await mongoose.connection.db.stats();

      return {
        status: 'connected',
        host: mongoose.connection.host,
        database: mongoose.connection.name,
        collections: stats.collections,
        documents: stats.objects,
        dataSize: `${(stats.dataSize / 1024 / 1024).toFixed(2)} MB`,
        indexSize: `${(stats.indexSize / 1024 / 1024).toFixed(2)} MB`
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  async ensureIndexes() {
    try {
      console.log('🔧 Ensuring database indexes...');
      
      // Import models to ensure indexes are created
      require('./models/Message');
      require('./models/Media');
      require('./models/Group');
    //   require('./models/Author');
    //   require('./models/Link');
      require('./models/Analytics');

      await mongoose.connection.syncIndexes();
      console.log('✅ Database indexes ensured');
    } catch (error) {
      console.error('❌ Error ensuring indexes:', error);
      throw error;
    }
  }

  async dropDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot drop database in production');
    }

    try {
      await mongoose.connection.dropDatabase();
      console.log('✅ Database dropped');
    } catch (error) {
      console.error('❌ Error dropping database:', error);
      throw error;
    }
  }
}

// Create singleton instance
const dbConnection = new DatabaseConnection();

module.exports = dbConnection;