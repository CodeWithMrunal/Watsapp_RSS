// Server.js - Enhanced with database integration
const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const cors = require('cors');
const path = require('path');

// Import configuration and utilities
const config = require('./config');
const FileUtils = require('./utils/fileUtils');

// Import services
const DatabaseService = require('./services/DatabaseService');
const RSSManager = require('./services/RSSManager');
const WhatsAppManager = require('./services/WhatsAppManager');
const SocketManager = require('./services/SocketManager');

// Import routes
const createApiRoutes = require('./routes/api');

class WhatsAppMonitorServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: config.server.cors
    });

    this.databaseService = null;
    this.rssManager = null;
    this.whatsappManager = null;
    this.socketManager = null;

    this.initialize();
  }

  async initialize() {
    console.log('🚀 Starting WhatsApp Monitor Server...');
    
    try {
      // Ensure required directories exist
      FileUtils.ensureDirectories();
      
      // Initialize database first
      await this.initializeDatabase();
      
      // Initialize services with database
      this.rssManager = new RSSManager(this.databaseService);
      this.whatsappManager = new WhatsAppManager(this.io, this.rssManager, this.databaseService);
      this.socketManager = new SocketManager(this.io, this.whatsappManager);
      
      // Setup middleware and routes
      this.setupMiddleware();
      this.setupRoutes();
      
      console.log('✅ Server initialized successfully');
    } catch (error) {
      console.error('❌ Server initialization failed:', error);
      process.exit(1);
    }
  }

  async initializeDatabase() {
    console.log('🗄️ Initializing database...');
    
    this.databaseService = new DatabaseService();
    
    try {
      await this.databaseService.initialize();
      console.log('✅ Database connected successfully');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      
      // Decide whether to continue without database or exit
      if (config.database.required !== false) {
        throw error;
      } else {
        console.warn('⚠️ Continuing without database (file-based mode)');
        this.databaseService = null;
      }
    }
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // Request logging middleware
    this.app.use((req, res, next) => {
      console.log(`📝 ${req.method} ${req.path} - ${new Date().toISOString()}`);
      next();
    });
    
    // Enhanced static file serving with better caching
    this.app.use('/rss', express.static(path.join(__dirname, 'rss'), {
      maxAge: '5m', // Cache RSS files for 5 minutes
      etag: true,
      lastModified: true
    }));
    
    this.app.use('/media', express.static(path.join(__dirname, 'media'), {
      maxAge: '1d', // Cache media files for 1 day
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        // Set appropriate headers based on file type
        const ext = path.extname(filePath).toLowerCase();
        switch (ext) {
          case '.mp4':
          case '.webm':
          case '.avi':
          case '.mov':
            res.set('Content-Type', 'video/mp4');
            res.set('Accept-Ranges', 'bytes'); // Enable video seeking
            break;
          case '.mp3':
          case '.wav':
          case '.ogg':
          case '.m4a':
            res.set('Content-Type', 'audio/mpeg');
            res.set('Accept-Ranges', 'bytes'); // Enable audio seeking
            break;
          case '.jpg':
          case '.jpeg':
            res.set('Content-Type', 'image/jpeg');
            break;
          case '.png':
            res.set('Content-Type', 'image/png');
            break;
          case '.gif':
            res.set('Content-Type', 'image/gif');
            break;
          case '.webp':
            res.set('Content-Type', 'image/webp');
            break;
        }
      }
    }));
  }

  setupRoutes() {
    // API routes with database service
    this.app.use('/api', createApiRoutes(this.whatsappManager, this.databaseService));
    
    // Enhanced RSS feed route - redirect to web view by default
    this.app.get('/rss', (req, res) => {
      res.redirect('/api/rss-view');
    });
    
    // Direct access to XML feed
    this.app.get('/rss/feed.xml', (req, res) => {
      res.sendFile(path.join(__dirname, 'rss', 'feed.xml'));
    });
    
    // Main RSS web view route (also accessible directly)
    this.app.get('/', (req, res) => {
      res.redirect('/api/rss-view');
    });
    
    // Enhanced health check endpoint with database status
    this.app.get('/health', async (req, res) => {
      const status = this.whatsappManager.getStatus();
      const uptime = process.uptime();
      const memoryUsage = process.memoryUsage();
      
      // Database health check
      let databaseHealth = { status: 'disabled', type: 'none' };
      if (this.databaseService) {
        try {
          databaseHealth = await this.databaseService.healthCheck();
        } catch (error) {
          databaseHealth = { status: 'error', error: error.message };
        }
      }
      
      const healthStatus = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: {
          seconds: Math.floor(uptime),
          human: this.formatUptime(uptime)
        },
        memory: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
          external: Math.round(memoryUsage.external / 1024 / 1024) + ' MB'
        },
        services: {
          whatsapp: {
            authenticated: status.authenticated,
            ready: status.ready,
            selectedGroup: status.selectedGroup,
            cachedGroups: status.cachedGroups,
            messageHistory: status.messageHistoryCount
          },
          database: databaseHealth,
          rss: this.rssManager ? 'initialized' : 'not initialized',
          socket: this.socketManager ? 'active' : 'inactive'
        },
        endpoints: {
          rssWebView: `/api/rss-view`,
          rssXml: `/rss/feed.xml`,
          mediaFiles: `/media/`,
          api: `/api/`,
          health: `/health`,
          metrics: `/api/metrics`
        }
      };
      
      // Return appropriate status code based on service health
      const statusCode = (
        databaseHealth.status === 'error' || 
        !status.ready
      ) ? 503 : 200;
      
      res.status(statusCode).json(healthStatus);
    });
    
    // Database metrics endpoint
    this.app.get('/api/metrics', async (req, res) => {
      if (!this.databaseService || !this.databaseService.isConnected) {
        return res.status(503).json({ 
          error: 'Database not connected',
          metrics: null 
        });
      }
      
      try {
        const metrics = await this.getSystemMetrics();
        res.json(metrics);
      } catch (error) {
        console.error('Error getting metrics:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // API documentation endpoint with database info
    this.app.get('/api-docs', (req, res) => {
      res.json({
        name: 'WhatsApp Monitor API',
        version: '2.0.0',
        description: 'API for monitoring WhatsApp messages with database-driven RSS feeds',
        database: {
          type: this.databaseService?.dbType || 'none',
          connected: this.databaseService?.isConnected || false
        },
        endpoints: {
          'GET /health': 'Server health and status information',
          'GET /api/metrics': 'System and database metrics',
          'GET /api/status': 'WhatsApp client status',
          'GET /api/groups': 'List available WhatsApp groups',
          'POST /api/select-group': 'Select a group to monitor',
          'GET /api/group-participants': 'Get participants of selected group',
          'POST /api/select-user': 'Filter messages by specific user',
          'POST /api/fetch-history': 'Fetch message history',
          'GET /api/messages': 'Get current messages',
          'GET /api/search': 'Search messages',
          'GET /api/statistics': 'Get message statistics',
          'POST /api/initialize': 'Initialize WhatsApp client',
          'POST /api/logout': 'Logout and clear session',
          'POST /api/backup-messages': 'Backup messages to file',
          'GET /api/rss-view': 'Enhanced web view of RSS feed',
          'GET /api/rss-xml-content': 'Get RSS XML content',
          'GET /api/message/:id': 'View individual message',
          'GET /api/media-info/:filename': 'Get media file information',
          'GET /rss/feed.xml': 'RSS XML feed',
          'GET /media/:filename': 'Media file access'
        },
        websocket: {
          events: {
            connection: 'Client connected',
            qr: 'QR code for WhatsApp authentication',
            authenticated: 'WhatsApp client authenticated',
            ready: 'WhatsApp client ready',
            disconnected: 'WhatsApp client disconnected',
            new_message: 'New message received',
            status: 'Status update',
            loading_progress: 'Loading progress update'
          }
        }
      });
    });
    
    // Catch-all route for SPA-like behavior
    this.app.get('*', (req, res) => {
      // For any unmatched route, redirect to the main RSS view
      res.redirect('/api/rss-view');
    });
    
    // Error handling middleware
    this.app.use((err, req, res, next) => {
      console.error('Server error:', err);
      
      // Don't expose error details in production
      const isDevelopment = process.env.NODE_ENV !== 'production';
      
      res.status(err.status || 500).json({
        error: 'Internal server error',
        message: isDevelopment ? err.message : 'Something went wrong',
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] || 'unknown'
      });
    });
  }

  async getSystemMetrics() {
    const metrics = {
      timestamp: new Date().toISOString(),
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      },
      database: null,
      whatsapp: this.whatsappManager.getStatus(),
      messages: {
        total: 0,
        today: 0,
        thisWeek: 0,
        mediaCount: 0
      }
    };

    // Get database metrics
    if (this.databaseService && this.databaseService.isConnected) {
      try {
        metrics.database = await this.databaseService.healthCheck();
        
        // Get message statistics
        if (this.rssManager) {
          const stats24h = await this.rssManager.getMessageStats(null, '24h');
          const stats7d = await this.rssManager.getMessageStats(null, '7d');
          
          metrics.messages = {
            today: stats24h.totalMessages || 0,
            thisWeek: stats7d.totalMessages || 0,
            mediaToday: stats24h.mediaMessages || 0,
            uniqueUsersToday: stats24h.uniqueUsers || 0
          };
        }
      } catch (error) {
        metrics.database = { status: 'error', error: error.message };
      }
    }

    return metrics;
  }

  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0) parts.push(`${secs}s`);
    
    return parts.join(' ') || '0s';
  }

  start() {
    const PORT = config.server.port;
    
    this.server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 WebSocket server ready for connections`);
      console.log(`🗄️ Database: ${config.database.type} (${this.databaseService?.isConnected ? 'Connected' : 'Disconnected'})`);
      console.log(`🌐 Enhanced RSS web view: http://localhost:${PORT}/`);
      console.log(`🔗 RSS XML feed: http://localhost:${PORT}/rss/feed.xml`);
      console.log(`📱 Media files served at: http://localhost:${PORT}/media/`);
      console.log(`🔍 API documentation: http://localhost:${PORT}/api-docs`);
      console.log(`💚 Health check: http://localhost:${PORT}/health`);
      console.log(`📊 Metrics: http://localhost:${PORT}/api/metrics`);
      
      // Log available endpoints
      console.log('\n📋 Available endpoints:');
      console.log('   Main RSS View: /');
      console.log('   Enhanced RSS: /api/rss-view');
      console.log('   XML Feed: /rss/feed.xml');
      console.log('   WhatsApp API: /api/*');
      console.log('   Media Files: /media/*');
      console.log('   Health Check: /health');
      console.log('   Metrics: /api/metrics');
      console.log('   API Docs: /api-docs\n');
    });
    
    // Enhanced error handling
    this.server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        console.log('💡 Try changing the port in config.js or stopping other services');
      } else {
        console.error('❌ Server error:', error);
      }
      process.exit(1);
    });
  }

  // Enhanced graceful shutdown with database cleanup
  async shutdown() {
    console.log('\n🛑 Initiating graceful shutdown...');
    
    const shutdownTimeout = setTimeout(() => {
      console.log('⏰ Shutdown timeout reached, forcing exit');
      process.exit(1);
    }, 20000); // 20 second timeout for database operations
    
    try {
      // Cleanup WhatsApp manager first (most important)
      if (this.whatsappManager) {
        console.log('📱 Cleaning up WhatsApp manager...');
        await this.whatsappManager.cleanup();
        console.log('✅ WhatsApp manager cleaned up');
      }
      
      // Close Socket.IO
      if (this.io) {
        console.log('📡 Closing WebSocket server...');
        this.io.close();
        console.log('✅ WebSocket server closed');
      }
      
      // Disconnect from database
      if (this.databaseService) {
        console.log('🗄️ Closing database connection...');
        await this.databaseService.disconnect();
        console.log('✅ Database disconnected');
      }
      
      // Close HTTP server
      this.server.close(() => {
        console.log('🌐 HTTP server closed');
        clearTimeout(shutdownTimeout);
        console.log('✅ Graceful shutdown completed');
        process.exit(0);
      });
      
      // Force close all connections
      this.server.closeAllConnections?.();
      
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  }
}

// Create and start the server
async function startServer() {
  const server = new WhatsAppMonitorServer();
  
  // Enhanced signal handling
  const gracefulShutdown = (signal) => {
    console.log(`\n📡 Received ${signal}, starting graceful shutdown...`);
    server.shutdown();
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    server.shutdown();
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    server.shutdown();
  });

  // Start the server
  server.start();
  
  return server;
}

// Start the server
startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

module.exports = { WhatsAppMonitorServer, startServer };