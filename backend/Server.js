const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const cors = require('cors');
const path = require('path');

// Import configuration and utilities
const config = require('./config');
const FileUtils = require('./utils/fileUtils');

// Import database and models
const { syncDatabase } = require('./models');

// Import services
const RSSManagerFactory = require('./services/RSSManagerFactory');
const WhatsAppManagerPool = require('./services/WhatsAppManagerPool');
const SocketManager = require('./services/SocketManager');

// Import middleware
const { authenticateSocket } = require('./middleware/auth');

// Import routes
const authRoutes = require('./routes/auth');
const createApiRoutes = require('./routes/api');

class WhatsAppMonitorServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: config.server.cors
    });

    this.rssManagerFactory = null;
    this.whatsappManagerPool = null;
    this.socketManager = null;

    this.initialize();
  }

  async initialize() {
    console.log('🚀 Server.js starting...');
    
    try {
      // Initialize database
      await syncDatabase();
      
      // Ensure required directories exist
      FileUtils.ensureDirectories();
      
      // Initialize services
      this.rssManagerFactory = new RSSManagerFactory();
      this.whatsappManagerPool = new WhatsAppManagerPool(this.io, this.rssManagerFactory);
      
      // Start cleanup interval for inactive managers
      this.whatsappManagerPool.startCleanupInterval();
      
      // Setup Socket.io authentication
      this.io.use(authenticateSocket);
      
      // Initialize socket manager with pool
      this.socketManager = new SocketManager(this.io, this.whatsappManagerPool);
      
      // Setup middleware and routes
      this.setupMiddleware();
      this.setupRoutes();
      
      console.log('✅ Server initialized successfully');
    } catch (error) {
      console.error('❌ Server initialization error:', error);
      process.exit(1);
    }
  }

  setupMiddleware() {
    // CORS configuration
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
      credentials: true
    }));
    
    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // Serve static files with user isolation
    this.app.use('/media/:userId', (req, res, next) => {
      // TODO: Add authentication check for media access
      const userId = req.params.userId;
      const userMediaPath = path.join(__dirname, 'media', `user_${userId}`);
      express.static(userMediaPath)(req, res, next);
    });
    
    // Public RSS feeds (optional - you might want to protect these too)
    this.app.use('/rss/:userId', (req, res, next) => {
      const userId = req.params.userId;
      const userRssPath = path.join(__dirname, 'rss', `user_${userId}`);
      express.static(userRssPath)(req, res, next);
    });
  }

  setupRoutes() {
    // Health check endpoint (public)
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        services: {
          database: 'connected',
          activeUsers: this.whatsappManagerPool.managers.size,
          socketConnections: this.io.engine.clientsCount
        }
      });
    });

    // Authentication routes (public)
    this.app.use('/api/auth', authRoutes);
    
    // API routes (protected)
    this.app.use('/api', createApiRoutes(this.whatsappManagerPool));
    
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Route not found' });
    });

    // Error handler
    this.app.use((err, req, res, next) => {
      console.error('Server error:', err);
      res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
      });
    });
  }

  start() {
    const PORT = config.server.port;
    
    this.server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 WebSocket server ready for connections`);
      console.log(`🔐 Authentication enabled`);
      console.log(`💾 Database connected`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  }

  // Graceful shutdown
  async shutdown() {
    console.log('🛑 Shutting down server...');
    
    try {
      // Close all WhatsApp connections
      for (const [userId, manager] of this.whatsappManagerPool.managers) {
        try {
          if (manager.client) {
            await manager.client.destroy();
          }
        } catch (error) {
          console.error(`Error destroying client for user ${userId}:`, error);
        }
      }
      
      // Close database connection
      const { sequelize } = require('./models');
      await sequelize.close();
      
      // Close HTTP server
      this.server.close(() => {
        console.log('✅ Server shut down successfully');
        process.exit(0);
      });
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Create and start the server
const server = new WhatsAppMonitorServer();
server.start();

// Handle graceful shutdown
process.on('SIGINT', () => server.shutdown());
process.on('SIGTERM', () => server.shutdown());

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  server.shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  server.shutdown();
});

module.exports = WhatsAppMonitorServer;