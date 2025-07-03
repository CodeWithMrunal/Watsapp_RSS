// services/DatabaseService.js - Database abstraction layer
const config = require('../config');

class DatabaseService {
  constructor() {
    this.db = null;
    this.dbType = config.database.type; // 'postgresql' or 'mongodb'
    this.isConnected = false;
  }

  async initialize() {
    try {
      if (this.dbType === 'postgresql') {
        await this.initializePostgreSQL();
      } else if (this.dbType === 'mongodb') {
        await this.initializeMongoDB();
      } else {
        throw new Error(`Unsupported database type: ${this.dbType}`);
      }
      
      this.isConnected = true;
      console.log(`✅ Database (${this.dbType}) connected successfully`);
      
      // Run migrations/setup
      await this.runSetup();
      
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  async initializePostgreSQL() {
    const { Pool } = require('pg');
    
    this.db = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
      max: config.database.maxConnections || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection
    const client = await this.db.connect();
    await client.query('SELECT NOW()');
    client.release();
  }

  async initializeMongoDB() {
    const { MongoClient } = require('mongodb');
    
    const connectionString = config.database.connectionString || 
      `mongodb://${config.database.host}:${config.database.port}/${config.database.name}`;
    
    this.client = new MongoClient(connectionString, {
      maxPoolSize: config.database.maxConnections || 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    await this.client.connect();
    this.db = this.client.db(config.database.name);

    // Test connection
    await this.db.admin().ping();
  }

  async runSetup() {
    if (this.dbType === 'postgresql') {
      await this.createPostgreSQLTables();
    } else if (this.dbType === 'mongodb') {
      await this.createMongoDBCollections();
    }
  }

  async createPostgreSQLTables() {
    const tables = [
      // Groups table
      `CREATE TABLE IF NOT EXISTS groups (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(500) NOT NULL,
        description TEXT,
        participant_count INTEGER DEFAULT 0,
        is_archived BOOLEAN DEFAULT FALSE,
        is_muted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(500),
        push_name VARCHAR(500),
        phone_number VARCHAR(50),
        profile_pic_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // Group memberships
      `CREATE TABLE IF NOT EXISTS group_memberships (
        group_id VARCHAR(255) REFERENCES groups(id) ON DELETE CASCADE,
        user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
        is_admin BOOLEAN DEFAULT FALSE,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id)
      )`,

      // Messages table
      `CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(255) PRIMARY KEY,
        group_id VARCHAR(255) REFERENCES groups(id) ON DELETE CASCADE,
        user_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
        message_type VARCHAR(50) NOT NULL DEFAULT 'chat',
        body TEXT,
        caption TEXT,
        timestamp BIGINT NOT NULL,
        has_media BOOLEAN DEFAULT FALSE,
        media_path VARCHAR(1000),
        media_type VARCHAR(50),
        media_size INTEGER,
        media_mimetype VARCHAR(100),
        is_forwarded BOOLEAN DEFAULT FALSE,
        reply_to_message_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // Message groups for RSS
      `CREATE TABLE IF NOT EXISTS message_groups (
        id VARCHAR(255) PRIMARY KEY,
        group_id VARCHAR(255) REFERENCES groups(id) ON DELETE CASCADE,
        author_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
        author_name VARCHAR(500),
        message_count INTEGER DEFAULT 0,
        first_message_id VARCHAR(255),
        last_message_id VARCHAR(255),
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // RSS feeds metadata
      `CREATE TABLE IF NOT EXISTS rss_feeds (
        id SERIAL PRIMARY KEY,
        group_id VARCHAR(255) REFERENCES groups(id) ON DELETE CASCADE,
        title VARCHAR(500),
        description TEXT,
        link VARCHAR(1000),
        last_build_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        item_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // Session management
      `CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE,
        selected_group_id VARCHAR(255),
        selected_user_id VARCHAR(255),
        is_authenticated BOOLEAN DEFAULT FALSE,
        is_ready BOOLEAN DEFAULT FALSE,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        session_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_messages_group_timestamp ON messages(group_id, timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_messages_user_timestamp ON messages(user_id, timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type)',
      'CREATE INDEX IF NOT EXISTS idx_messages_media ON messages(has_media, media_type)',
      'CREATE INDEX IF NOT EXISTS idx_message_groups_timestamp ON message_groups(timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_group_memberships_group ON group_memberships(group_id)'
    ];

    // Create tables
    for (const table of tables) {
      await this.db.query(table);
    }

    // Create indexes
    for (const index of indexes) {
      await this.db.query(index);
    }

    console.log('✅ PostgreSQL tables and indexes created');
  }

  async createMongoDBCollections() {
    const collections = ['groups', 'users', 'messages', 'messageGroups', 'rssFeeds', 'whatsappSessions'];
    
    for (const collectionName of collections) {
      try {
        await this.db.createCollection(collectionName);
      } catch (error) {
        // Collection might already exist
        if (error.code !== 48) {
          console.warn(`Warning creating collection ${collectionName}:`, error.message);
        }
      }
    }

    // Create indexes
    await this.db.collection('messages').createIndex({ groupId: 1, timestamp: -1 });
    await this.db.collection('messages').createIndex({ userId: 1, timestamp: -1 });
    await this.db.collection('messages').createIndex({ messageType: 1 });
    await this.db.collection('messages').createIndex({ hasMedia: 1, mediaType: 1 });
    await this.db.collection('messageGroups').createIndex({ timestamp: -1 });

    console.log('✅ MongoDB collections and indexes created');
  }

  // Generic CRUD operations
  async create(table, data) {
    if (this.dbType === 'postgresql') {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const columns = keys.join(', ');
      
      const query = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`;
      const result = await this.db.query(query, values);
      return result.rows[0];
    } else {
      const result = await this.db.collection(table).insertOne(data);
      return { ...data, _id: result.insertedId };
    }
  }

  async findById(table, id) {
    if (this.dbType === 'postgresql') {
      const result = await this.db.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
      return result.rows[0];
    } else {
      return await this.db.collection(table).findOne({ _id: id });
    }
  }

  async findMany(table, conditions = {}, options = {}) {
    if (this.dbType === 'postgresql') {
      let query = `SELECT * FROM ${table}`;
      const values = [];
      
      if (Object.keys(conditions).length > 0) {
        const whereClause = Object.keys(conditions).map((key, i) => {
          values.push(conditions[key]);
          return `${key} = $${i + 1}`;
        }).join(' AND ');
        query += ` WHERE ${whereClause}`;
      }
      
      if (options.orderBy) {
        query += ` ORDER BY ${options.orderBy}`;
      }
      
      if (options.limit) {
        query += ` LIMIT ${options.limit}`;
      }
      
      const result = await this.db.query(query, values);
      return result.rows;
    } else {
      let cursor = this.db.collection(table).find(conditions);
      
      if (options.sort) {
        cursor = cursor.sort(options.sort);
      }
      
      if (options.limit) {
        cursor = cursor.limit(options.limit);
      }
      
      return await cursor.toArray();
    }
  }

  async update(table, id, data) {
    if (this.dbType === 'postgresql') {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const setClause = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
      
      const query = `UPDATE ${table} SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`;
      const result = await this.db.query(query, [id, ...values]);
      return result.rows[0];
    } else {
      const result = await this.db.collection(table).findOneAndUpdate(
        { _id: id },
        { $set: { ...data, updatedAt: new Date() } },
        { returnDocument: 'after' }
      );
      return result.value;
    }
  }

  async delete(table, id) {
    if (this.dbType === 'postgresql') {
      const result = await this.db.query(`DELETE FROM ${table} WHERE id = $1 RETURNING *`, [id]);
      return result.rows[0];
    } else {
      const result = await this.db.collection(table).findOneAndDelete({ _id: id });
      return result.value;
    }
  }

  async query(sql, params = []) {
    if (this.dbType === 'postgresql') {
      const result = await this.db.query(sql, params);
      return result.rows;
    } else {
      throw new Error('Raw SQL queries not supported for MongoDB');
    }
  }

  async aggregate(collection, pipeline) {
    if (this.dbType === 'mongodb') {
      return await this.db.collection(collection).aggregate(pipeline).toArray();
    } else {
      throw new Error('Aggregation pipelines not supported for PostgreSQL');
    }
  }

  async disconnect() {
    try {
      if (this.dbType === 'postgresql' && this.db) {
        await this.db.end();
      } else if (this.dbType === 'mongodb' && this.client) {
        await this.client.close();
      }
      
      this.isConnected = false;
      console.log('✅ Database disconnected');
    } catch (error) {
      console.error('❌ Error disconnecting from database:', error);
    }
  }

  // Health check
  async healthCheck() {
    try {
      if (this.dbType === 'postgresql') {
        await this.db.query('SELECT 1');
      } else {
        await this.db.admin().ping();
      }
      return { status: 'healthy', type: this.dbType, connected: this.isConnected };
    } catch (error) {
      return { status: 'unhealthy', type: this.dbType, error: error.message };
    }
  }
}

module.exports = DatabaseService;