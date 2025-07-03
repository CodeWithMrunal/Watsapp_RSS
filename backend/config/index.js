const path = require('path');
const databaseConfig = require('./database');

const config = {
  server: {
    port: process.env.PORT || 3001,
    cors: {
      origin: true,
      credentials:true,
      methods: ["GET", "POST"]
    }
  },

  database: {
    type: databaseConfig.type,
    ...databaseConfig[databaseConfig.type]
  },
  
  directories: {
    rss: './rss',
    backups: './backups',
    media: './media'
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
    title: 'WhatsApp Monitor RSS Feed',
    description: 'Real-time WhatsApp message monitoring with media support',
    site_url: `http://localhost:${process.env.PORT || 3001}`,
    feed_url: `http://localhost:${process.env.PORT || 3001}/rss/feed.xml`,
    image_url: `http://localhost:${process.env.PORT || 3001}/favicon.ico`,
    managingEditor: 'WhatsApp Monitor',
    webMaster: 'WhatsApp Monitor',
    copyright: '2024 WhatsApp Monitor',
    language: 'en',
    categories: ['WhatsApp', 'Messages', 'Communication'],
    pubDate: new Date(),
    ttl: '60'
  },
  
  app: {
    environment: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    enableMetrics: process.env.ENABLE_METRICS !== 'false',
    maxMessageHistory: parseInt(process.env.MAX_MESSAGE_HISTORY) || 1000
  },
  
  messaging: {
    groupTimeoutMinutes: 5
  }
};

module.exports = config;