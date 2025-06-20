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
    
    // Serve static files
    this.app.use('/rss', express.static(path.join(__dirname, 'rss')));
    this.app.use('/media', express.static(path.join(__dirname, 'media')));
  }

  setupRoutes() {
    // API routes
    this.app.use('/api', createApiRoutes(this.whatsappManager));
    
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        services: {
          whatsapp: this.whatsappManager.getStatus(),
          rss: this.rssManager ? 'initialized' : 'not initialized'
        }
      });
    });
  }

  start() {
    const PORT = config.server.port;
    
    this.server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 WebSocket server ready for connections`);
      console.log(`🔗 RSS feed available at: http://localhost:${PORT}/rss/feed.xml`);
      console.log(`📱 Media files served at: http://localhost:${PORT}/media/`);
    });
  }

  // Graceful shutdown
  shutdown() {
    console.log('🛑 Shutting down server...');
    
    if (this.whatsappManager && this.whatsappManager.client) {
      this.whatsappManager.client.destroy();
    }
    
    this.server.close(() => {
      console.log('✅ Server shut down successfully');
      process.exit(0);
    });
  }
}

// Create and start the server
const server = new WhatsAppMonitorServer();
server.start();

// Handle graceful shutdown
process.on('SIGINT', () => server.shutdown());
process.on('SIGTERM', () => server.shutdown());

module.exports = WhatsAppMonitorServer;