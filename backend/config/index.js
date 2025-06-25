const path = require('path');

const config = {
  server: {
    port: process.env.PORT || 3001,
    cors: {
      origin: process.env.CORS_ORIGIN || "http://localhost:5173",
      methods: ["GET", "POST"],
      credentials: true
    }
  },
  
  directories: {
    rss: './rss',
    backups: './backups',
    media: './media',
    data: './data',
    auth: './.wwebjs_auth'
  },
  
  whatsapp: {
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ],
      defaultViewport: null,
      timeout: 60000
      // Let Puppeteer find Chrome automatically
    }
  },
  
  rss: {
    title: 'WhatsApp Monitor Feed',
    description: 'Real-time WhatsApp group messages',
    feed_url: 'http://localhost:3001/rss/feed.xml',
    site_url: 'http://localhost:3001',
    language: 'en'
  },
  
  messaging: {
    groupTimeoutMinutes: 5
  },
  
  // Multi-tenancy settings
  multiTenant: {
    maxUsersPerInstance: 10,
    initializationDelay: 5000, // Increased delay
    cleanupInterval: 5 * 60 * 1000,
    inactiveThreshold: 30 * 60 * 1000
  }
};

module.exports = config;