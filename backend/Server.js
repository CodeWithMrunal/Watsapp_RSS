const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const cors = require('cors');
const path = require('path');

// Import configuration and utilities
const config = require('./config');
const FileUtils = require('./utils/fileUtils');

// Import services
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

    this.rssManager = null;
    this.whatsappManager = null;
    this.socketManager = null;

    this.initialize();
  }

  initialize() {
    console.log('Server.js starting...');
    
    // Ensure required directories exist
    FileUtils.ensureDirectories();
    
    // Initialize services
    this.rssManager = new RSSManager();
    this.whatsappManager = new WhatsAppManager(this.io, this.rssManager);
    this.socketManager = new SocketManager(this.io, this.whatsappManager);
    
    // Setup middleware and routes
    this.setupMiddleware();
    this.setupRoutes();
    
    console.log('✅ Server initialized successfully');
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Serve static files from public directory
    this.app.use(express.static(path.join(__dirname, 'public')));

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
      setHeaders: (res, path, stat) => {
        // Set appropriate headers based on file type
        const ext = path.toLowerCase().substring(path.lastIndexOf('.'));
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
    // API routes
    this.app.use('/api', createApiRoutes(this.whatsappManager));
    
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
    
    // Health check endpoint with enhanced information
    this.app.get('/health', (req, res) => {
      const status = this.whatsappManager.getStatus();
      const uptime = process.uptime();
      const memoryUsage = process.memoryUsage();
      
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: {
          seconds: Math.floor(uptime),
          human: this.formatUptime(uptime)
        },
        memory: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB'
        },
        services: {
          whatsapp: {
            authenticated: status.authenticated,
            ready: status.ready,
            selectedGroup: status.selectedGroup,
            cachedGroups: status.cachedGroups
          },
          rss: this.rssManager ? 'initialized' : 'not initialized',
          socket: this.socketManager ? 'active' : 'inactive'
        },
        endpoints: {
          rssWebView: `/api/rss-view`,
          rssXml: `/rss/feed.xml`,
          mediaFiles: `/media/`,
          api: `/api/`,
          health: `/health`
        }
      });
    });
    
    // API documentation endpoint
    this.app.get('/api-docs', (req, res) => {
      res.json({
        name: 'WhatsApp Monitor API',
        version: '1.0.0',
        description: 'API for monitoring WhatsApp messages with RSS feed generation',
        endpoints: {
          'GET /health': 'Server health and status information',
          'GET /api/status': 'WhatsApp client status',
          'GET /api/groups': 'List available WhatsApp groups',
          'POST /api/select-group': 'Select a group to monitor',
          'GET /api/group-participants': 'Get participants of selected group',
          'POST /api/select-user': 'Filter messages by specific user',
          'POST /api/fetch-history': 'Fetch message history',
          'GET /api/messages': 'Get current messages',
          'POST /api/initialize': 'Initialize WhatsApp client',
          'POST /api/logout': 'Logout and clear session',
          'POST /api/backup-messages': 'Backup messages to file',
          'GET /api/rss-view': 'Enhanced web view of RSS feed',
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
        timestamp: new Date().toISOString()
      });
    });
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
      console.log(`🌐 Enhanced RSS web view: http://localhost:${PORT}/`);
      console.log(`🔗 RSS XML feed: http://localhost:${PORT}/rss/feed.xml`);
      console.log(`📱 Media files served at: http://localhost:${PORT}/media/`);
      console.log(`🔍 API documentation: http://localhost:${PORT}/api-docs`);
      console.log(`💚 Health check: http://localhost:${PORT}/health`);
      
      // Log available endpoints
      console.log('\n📋 Available endpoints:');
      console.log('   Main RSS View: /');
      console.log('   Enhanced RSS: /api/rss-view');
      console.log('   XML Feed: /rss/feed.xml');
      console.log('   WhatsApp API: /api/*');
      console.log('   Media Files: /media/*');
      console.log('   Health Check: /health');
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

  // Enhanced graceful shutdown
  shutdown() {
    console.log('\n🛑 Initiating graceful shutdown...');
    
    const shutdownTimeout = setTimeout(() => {
      console.log('⏰ Shutdown timeout reached, forcing exit');
      process.exit(1);
    }, 10000); // 10 second timeout
    
    // Close server first
    this.server.close(async () => {
      console.log('🌐 HTTP server closed');
      
      try {
        // Close WhatsApp client
        if (this.whatsappManager && this.whatsappManager.client) {
          console.log('📱 Closing WhatsApp client...');
          await this.whatsappManager.client.destroy();
          console.log('✅ WhatsApp client closed');
        }
        
        // Close Socket.IO
        if (this.io) {
          console.log('📡 Closing WebSocket server...');
          this.io.close();
          console.log('✅ WebSocket server closed');
        }
        
        clearTimeout(shutdownTimeout);
        console.log('✅ Graceful shutdown completed');
        process.exit(0);
        
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        clearTimeout(shutdownTimeout);
        process.exit(1);
      }
    });
    
    // Stop accepting new connections
    this.server.closeAllConnections?.();
  }
}

// Create and start the server
const server = new WhatsAppMonitorServer();
server.start();

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

module.exports = WhatsAppMonitorServer;