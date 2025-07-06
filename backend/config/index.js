const path = require('path');

const config = {
  server: {
    port: process.env.PORT || 3001,
    host: process.env.HOST || 'localhost',
    cors: {
      origin: true,
      methods: ["GET", "POST"]
    }
  },
  
  directories: {
    media: './media',
    rss: './rss',
    temp: './temp',
    thumbnails: './media/thumbnails',
    backups: './backups'
  },
  
  whatsapp: {
  puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--no-first-run',
        '--no-default-browser-check',
        '--single-process',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-background-mode',
        '--disable-sync',
        '--disable-translate',
        '--disable-plugins',
        '--user-data-dir=/tmp/chrome-profile-' + Date.now(), // Unique profile per restart
        '--remote-debugging-port=9222'
      ],
      defaultViewport: null,
      timeout: 60000,
      // executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
    }
},
  
  rss: {
    title: 'WhatsApp Group Monitor Feed',
    description: 'Real-time updates from monitored WhatsApp groups',
    generator: 'WhatsApp Monitor v2.0',
    feed_url: 'http://localhost:3001/rss/feed.xml',
    site_url: 'http://localhost:3001',
    image_url: 'http://localhost:3001/logo.png',
    managingEditor: 'admin@whatsappmonitor.local',
    webMaster: 'admin@whatsappmonitor.local',
    copyright: '2024 WhatsApp Monitor',
    language: 'en',
    categories: ['WhatsApp', 'Messaging', 'Real-time'],
    pubDate: new Date(),
    ttl: 60 // 60 minutes
  },
  
  messaging: {
    groupTimeoutMinutes: 5,
    messageRetentionDays: 30
  },

  media: {
    thumbnailSize: {
      width: 200,
      height: 200
    },
    videoThumbnailAt: '00:00:01', // Extract thumbnail at 1 second
    compressionQuality: 80
  },

  metadata: {
    version: '2.0',
    enrichment: {
      extractLinks: true,
      extractMentions: true,
      analyzeContent: true,
      detectLanguage: true,
      generateHashes: true,
      extractMediaMetadata: true
    },
    indices: {
      createTimelineIndex: true,
      createAuthorIndex: true,
      createMediaTypeIndex: true,
      createLinkIndex: true
    }
  },

  database: {
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-monitor',
      options: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000
      },
      collections: {
        messages: 'messages',
        media: 'media',
        groups: 'groups',
        authors: 'authors',
        links: 'links',
        analytics: 'analytics'
      }
    }
  },

  // Analytics configuration
  analytics: {
    enableRealTimeAnalytics: true,
    updateInterval: 60000, // 1 minute
    metrics: {
      messageVolume: true,
      authorActivity: true,
      mediaDistribution: true,
      linkTracking: true,
      timePatterns: true
    }
  },

  // Export configuration
  export: {
    formats: ['json', 'csv', 'xml'],
    compression: true,
    includeMetadata: true,
    batchSize: 1000
  },

  // Security configuration
  security: {
    enableEncryption: false,
    hashAlgorithm: 'sha256',
    sanitizeContent: true,
    maxContentLength: 50000
  },

  // Performance configuration
  performance: {
    enableCaching: true,
    cacheTimeout: 300000, // 5 minutes
    maxConcurrentDownloads: 5,
    downloadTimeout: 30000, // 30 seconds
    retryAttempts: 3,
    retryDelay: 1000 // 1 second
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableFileLogging: true,
    logDirectory: './logs',
    maxLogSize: '10m',
    maxLogFiles: 5,
    format: 'json'
  }
};

module.exports = config;