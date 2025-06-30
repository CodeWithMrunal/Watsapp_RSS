const path = require('path');

const config = {
  server: {
    port: process.env.PORT || 3001,
    cors: {
      origin: true,
      methods: ["GET", "POST"]
    }
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
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
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
  }
};

module.exports = config;