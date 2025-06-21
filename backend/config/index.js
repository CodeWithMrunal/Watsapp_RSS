const path = require('path');

const config = {
  server: {
    port: process.env.PORT || 3001,
    cors: {
      origin: "http://localhost:5173",
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
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--shm-size=3gb' // Increase shared memory size for video handling
    ],
    defaultViewport: null,
    timeout: 60000 // Increase timeout
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