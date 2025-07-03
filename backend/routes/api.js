const express = require('express');
const moment = require('moment');
const fs = require('fs-extra');
const path = require('path');
const FileUtils = require('../utils/fileUtils');

const router = express.Router();

function createApiRoutes(whatsappManager) {
  // Existing routes (keeping all your current functionality)
  router.get('/status', (req, res) => {
    res.json(whatsappManager.getStatus());
  });

  router.get('/groups', async (req, res) => {
    console.log('GET /api/groups');
    
    try {
      if (!whatsappManager.isClientReady()) {
        return res.status(503).json({ 
          error: 'WhatsApp client is still initializing. Please wait a moment and try again.',
          status: whatsappManager.getStatus()
        });
      }
      
      const groups = await whatsappManager.getGroups();
      res.json(groups);
    } catch (error) {
      console.error('Error fetching groups:', error);
      res.status(500).json({ 
        error: error.message,
        status: whatsappManager.getStatus()
      });
    }
  });

  router.post('/select-group', async (req, res) => {
    console.log('POST /api/select-group', req.body);
    const { groupId } = req.body;
    
    try {
      const selectedGroup = await whatsappManager.selectGroup(groupId);
      res.json({ success: true, group: selectedGroup });
    } catch (error) {
      console.error('Error selecting group:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/group-participants', async (req, res) => {
    console.log('GET /api/group-participants');
    
    try {
      const participants = whatsappManager.getGroupParticipants();
      res.json(participants);
    } catch (error) {
      console.error('Error fetching participants:', error);
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/select-user', (req, res) => {
    console.log('POST /api/select-user', req.body);
    const { userId } = req.body;
    
    try {
      const selectedUser = whatsappManager.selectUser(userId);
      res.json({ success: true, selectedUser });
    } catch (error) {
      console.error('Error selecting user:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/fetch-history', async (req, res) => {
    console.log('POST /api/fetch-history', req.body);
    const { limit = 50 } = req.body;
    
    try {
      const messages = await whatsappManager.fetchHistory(limit);
      res.json({ messages });
    } catch (error) {
      console.error('Error fetching history:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/messages', (req, res) => {
    const { grouped = true } = req.query;
    
    try {
      const messages = whatsappManager.getMessages(grouped === 'true');
      res.json(messages);
    } catch (error) {
      console.error('Error getting messages:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/initialize', (req, res) => {
    try {
      whatsappManager.initialize();
      res.json({ success: true });
    } catch (error) {
      console.error('Error initializing WhatsApp manager:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/logout', async (req, res) => {
    console.log('POST /api/logout - Logging out WhatsApp session');
    
    try {
      await whatsappManager.logout();
      res.json({ success: true, message: 'Successfully logged out' });
    } catch (error) {
      console.error('Error during logout:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/backup-messages', (req, res) => {
    const messageHistory = whatsappManager.messageHistory;
    
    if (!messageHistory || messageHistory.length === 0) {
      return res.status(400).json({ error: 'No messages to backup' });
    }

    const timestamp = moment().format('YYYY-MM-DD_HH-mm-ss');
    const filename = `./backups/messages-${timestamp}.json`;

    try {
      const success = FileUtils.saveJSON(filename, messageHistory);
      if (success) {
        res.json({ success: true, message: `Messages backed up to ${filename}` });
      } else {
        res.status(500).json({ error: 'Failed to write backup file' });
      }
    } catch (err) {
      console.error('❌ Failed to write backup:', err);
      res.status(500).json({ error: 'Failed to write backup file' });
    }
  });

  // NEW: Get XML feed content for modal display
  router.get('/rss-xml-content', (req, res) => {
    try {
      const rssPath = path.join(__dirname, '../rss/feed.xml');
      
      if (!fs.existsSync(rssPath)) {
        return res.status(404).json({ 
          error: 'RSS feed not found',
          message: 'No RSS feed available. Start monitoring messages to generate the feed.'
        });
      }

      const xmlContent = fs.readFileSync(rssPath, 'utf8');
      res.json({ 
        xml: xmlContent,
        timestamp: new Date().toISOString(),
        size: xmlContent.length
      });
      
    } catch (error) {
      console.error('Error reading RSS XML:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Enhanced RSS web view endpoint with XML button
  router.get('/rss-view', (req, res) => {
    try {
      // Read the RSS feed file
      const rssPath = path.join(__dirname, '../rss/feed.xml');
      const messagesPath = path.join(__dirname, '../rss/messages.json');
      
      if (!fs.existsSync(rssPath) || !fs.existsSync(messagesPath)) {
        return res.status(404).send(generateEmptyFeedHTML());
      }

      const rawMessages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
      console.log('Raw messages structure:', JSON.stringify(rawMessages, null, 2));
      
      // Convert messages to the expected format
      const messages = convertToExpectedFormat(rawMessages);
      console.log('Converted messages count:', messages.length);
      
      const html = generateRSSWebView(messages, whatsappManager);
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
      
    } catch (error) {
      console.error('Error generating RSS web view:', error);
      console.error('Error stack:', error.stack);
      res.status(500).send(`<h1>Error loading RSS feed</h1><p>${error.message}</p><pre>${error.stack}</pre>`);
    }
  });

  // Individual message view
  router.get('/message/:messageId', (req, res) => {
    try {
      const { messageId } = req.params;
      const messagesPath = path.join(__dirname, '../rss/messages.json');
      
      if (!fs.existsSync(messagesPath)) {
        return res.status(404).send('<h1>Messages not found</h1>');
      }

      const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
      const messageGroup = messages.find(group => group.id === messageId);
      
      if (!messageGroup) {
        return res.status(404).send('<h1>Message not found</h1>');
      }

      const html = generateSingleMessageView(messageGroup);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
      
    } catch (error) {
      console.error('Error loading message:', error);
      res.status(500).send(`<h1>Error loading message</h1><p>${error.message}</p>`);
    }
  });

  // Media info endpoint
  router.get('/media-info/:filename', (req, res) => {
    try {
      const { filename } = req.params;
      const mediaPath = path.join(__dirname, '../media', filename);
      
      if (!fs.existsSync(mediaPath)) {
        return res.status(404).json({ error: 'Media file not found' });
      }

      const stats = fs.statSync(mediaPath);
      const ext = path.extname(filename).toLowerCase();
      
      let mediaType = 'unknown';
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        mediaType = 'image';
      } else if (['.mp4', '.avi', '.mov', '.webm'].includes(ext)) {
        mediaType = 'video';
      } else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) {
        mediaType = 'audio';
      }

      res.json({
        filename,
        size: stats.size,
        mediaType,
        created: stats.birthtime,
        modified: stats.mtime,
        url: `/media/${filename}`
      });
      
    } catch (error) {
      console.error('Error getting media info:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Debug endpoint to inspect message structure
  router.get('/debug-messages', (req, res) => {
    try {
      const messagesPath = path.join(__dirname, '../rss/messages.json');
      
      if (!fs.existsSync(messagesPath)) {
        return res.json({ 
          error: 'No messages file found',
          suggestion: 'Try fetching some messages first through your WhatsApp monitor'
        });
      }

      const rawMessages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
      
      res.json({
        messageCount: Array.isArray(rawMessages) ? rawMessages.length : 'Not an array',
        messageStructure: rawMessages,
        firstMessage: Array.isArray(rawMessages) && rawMessages.length > 0 ? rawMessages[0] : null,
        dataType: typeof rawMessages,
        isArray: Array.isArray(rawMessages)
      });
      
    } catch (error) {
      console.error('Error reading debug messages:', error);
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  return router;
}

// Helper function to generate message card HTML
function generateMessageCard(group) {
  const authorInitials = group.author ? group.author.charAt(0).toUpperCase() : 'U';
  const messageTime = new Date(group.timestamp * 1000).toLocaleString();
  
  return `
    <div class="message-card">
      <div class="message-header">
        <div class="author-info">
          <div class="author-avatar">${authorInitials}</div>
          <div class="author-name">${escapeHtml(group.author || 'Unknown')}</div>
        </div>
        <div class="message-time">${messageTime}</div>
      </div>
      <div class="message-content">
        ${group.messages.map(msg => generateMessageContent(msg)).join('')}
      </div>
      <div class="message-stats">
        <span>Messages: ${group.messages.length}</span>
        <span>Type: ${group.type || 'group'}</span>
      </div>
    </div>
  `;
}

// Helper function to generate individual message content
function generateMessageContent(message) {
  let content = '';
  
  if (message.body && message.body.trim()) {
    // Check if message contains URLs
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const hasLinks = urlRegex.test(message.body);
    
    if (hasLinks) {
      content += `<div class="link-preview">`;
      const bodyWithLinks = message.body.replace(urlRegex, '<a href="$1" target="_blank">$1</a>');
      content += `<div class="text-message">${escapeHtml(bodyWithLinks)}</div>`;
      content += `</div>`;
    } else {
      content += `<div class="text-message">${escapeHtml(message.body)}</div>`;
    }
  }
  
  // Handle media
  if (message.hasMedia && message.mediaPath) {
    const mediaExt = path.extname(message.mediaPath).toLowerCase();
    const mediaUrl = `/media/${path.basename(message.mediaPath)}`;
    
    content += `<div class="media-container">`;
    
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(mediaExt)) {
      content += `<img src="${mediaUrl}" alt="Image" class="media-image" onclick="openImageModal('${mediaUrl}')">`;
    } else if (['.mp4', '.avi', '.mov', '.webm'].includes(mediaExt)) {
      content += `<video src="${mediaUrl}" controls class="media-video"></video>`;
    } else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(mediaExt)) {
      content += `<audio src="${mediaUrl}" controls class="media-audio"></audio>`;
    } else {
      // Document or other file type
      content += `
        <div class="document-container">
          <div class="document-info">
            <div class="document-icon">📄</div>
            <div>
              <a href="${mediaUrl}" target="_blank" class="document-link">
                ${path.basename(message.mediaPath)}
              </a>
              <div class="document-type">${mediaExt.substring(1).toUpperCase()} file</div>
            </div>
          </div>
        </div>
      `;
    }
    
    // Add caption if present
    if (message.caption && message.caption.trim()) {
      content += `<div class="media-caption">${escapeHtml(message.caption)}</div>`;
    }
    
    content += `</div>`;
  }
  
  return content;
}

// Helper function to generate single message view
function generateSingleMessageView(messageGroup) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Message from ${escapeHtml(messageGroup.author || 'Unknown')}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
      line-height: 1.6;
    }
    
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    
    .header {
      background: linear-gradient(135deg, #25D366, #128C7E);
      color: white;
      padding: 30px;
      text-align: center;
    }
    
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    
    .header p {
      margin: 10px 0 0;
      opacity: 0.9;
    }
    
    .content {
      padding: 30px;
    }
    
    .message {
      margin: 20px 0;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 12px;
      border-left: 4px solid #25D366;
    }
    
    .back-link {
      display: inline-block;
      margin: 20px 0;
      padding: 10px 20px;
      background: #25D366;
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 500;
    }
    
    .back-link:hover {
      background: #128C7E;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Message from ${escapeHtml(messageGroup.author || 'Unknown')}</h1>
      <p>${new Date(messageGroup.timestamp * 1000).toLocaleString()}</p>
    </div>
    <div class="content">
      <a href="/api/rss-view" class="back-link">← Back to Feed</a>
      ${messageGroup.messages.map(msg => `
        <div class="message">
          ${generateMessageContent(msg)}
        </div>
      `).join('')}
    </div>
  </div>
</body>
</html>`;
}

// Helper function to generate empty feed HTML
function generateEmptyFeedHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatsApp Monitor - No Feed Available</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      text-align: center;
    }
    
    .container {
      max-width: 600px;
      padding: 40px;
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    
    h1 {
      font-size: 3rem;
      margin-bottom: 20px;
    }
    
    p {
      font-size: 1.2rem;
      opacity: 0.9;
      margin-bottom: 30px;
    }
    
    .refresh-btn {
      background: #25D366;
      color: white;
      padding: 15px 30px;
      border: none;
      border-radius: 25px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.3s ease;
    }
    
    .refresh-btn:hover {
      background: #128C7E;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📭</h1>
    <h2>No RSS Feed Available</h2>
    <p>The RSS feed hasn't been generated yet. Start monitoring WhatsApp messages to create the feed.</p>
    <button class="refresh-btn" onclick="location.reload()">Refresh Page</button>
  </div>
</body>
</html>`;
}

// Helper function to escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Helper function to convert messages to expected format
function convertToExpectedFormat(rawMessages) {
  if (!Array.isArray(rawMessages)) {
    console.log('Raw messages is not an array:', typeof rawMessages);
    return [];
  }

  return rawMessages.map(msg => {
    // Handle different message structures
    if (msg.messages && Array.isArray(msg.messages)) {
      // Already in expected format
      return {
        id: msg.id || `msg_${Date.now()}_${Math.random()}`,
        author: msg.author || 'Unknown',
        timestamp: msg.timestamp || Date.now() / 1000,
        messages: msg.messages,
        type: msg.type || 'group'
      };
    } else {
      // Convert single message to group format
      return {
        id: msg.id || `msg_${Date.now()}_${Math.random()}`,
        author: msg.author || 'Unknown', 
        timestamp: msg.timestamp || Date.now() / 1000,
        messages: [{
          id: msg.id,
          body: msg.body,
          type: msg.type || 'chat',
          hasMedia: msg.hasMedia || false,
          mediaPath: msg.mediaPath,
          timestamp: msg.timestamp
        }],
        type: 'group'
      };
    }
  });
}

module.exports = createApiRoutes;

function generateRSSWebView(messages, whatsappManager) {
  const status = whatsappManager.getStatus();
  const groupedMessages = messages.slice().reverse();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatsApp Monitor - RSS Feed</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 30px;
      margin-bottom: 30px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    
    .header h1 {
      color: #25D366;
      font-size: 2.5rem;
      margin-bottom: 10px;
      text-align: center;
    }

    .header-actions {
      display: flex;
      justify-content: center;
      gap: 15px;
      margin: 20px 0;
      flex-wrap: wrap;
    }

    .xml-button {
      background: linear-gradient(45deg, #FF6B6B, #FF8E53);
      color: white;
      padding: 12px 24px;
      border: none;
      border-radius: 25px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.3s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
    }

    .xml-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(255, 107, 107, 0.4);
    }

    .refresh-button {
      background: linear-gradient(45deg, #4ECDC4, #44A08D);
      color: white;
      padding: 12px 24px;
      border: none;
      border-radius: 25px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.3s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
    }

    .refresh-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(78, 205, 196, 0.4);
    }
    
    .status-bar {
      display: flex;
      justify-content: center;
      gap: 20px;
      flex-wrap: wrap;
      margin-top: 20px;
    }
    
    .status-item {
      background: #f8f9fa;
      padding: 10px 20px;
      border-radius: 25px;
      font-size: 14px;
      border: 2px solid #e9ecef;
    }
    
    .status-active {
      background: #d4edda;
      border-color: #25D366;
      color: #155724;
    }
    
    .message-feed {
      display: grid;
      gap: 20px;
    }
    
    .message-card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    
    .message-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
    }
    
    .message-header {
      background: linear-gradient(135deg, #25D366, #128C7E);
      color: white;
      padding: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .author-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .author-avatar {
      width: 40px;
      height: 40px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 18px;
    }
    
    .author-name {
      font-weight: 600;
      font-size: 16px;
    }
    
    .message-time {
      font-size: 14px;
      opacity: 0.9;
    }
    
    .message-content {
      padding: 20px;
    }
    
    .text-message {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 12px;
      margin: 10px 0;
      border-left: 4px solid #25D366;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    
    .media-container {
      margin: 15px 0;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    
    .media-image {
      width: 100%;
      height: auto;
      max-height: 400px;
      object-fit: cover;
      cursor: pointer;
      transition: transform 0.3s ease;
    }
    
    .media-image:hover {
      transform: scale(1.02);
    }
    
    .media-video {
      width: 100%;
      max-height: 400px;
      background: #000;
    }
    
    .media-audio {
      width: 100%;
      height: 60px;
    }
    
    .media-caption {
      padding: 15px;
      background: #f8f9fa;
      font-style: italic;
      color: #666;
      border-top: 1px solid #e9ecef;
    }
    
    .document-container {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 12px;
      border: 2px dashed #dee2e6;
    }
    
    .document-info {
      display: flex;
      align-items: center;
      gap: 15px;
    }
    
    .document-icon {
      width: 50px;
      height: 50px;
      background: #007bff;
      color: white;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }
    
    .document-link {
      color: #007bff;
      text-decoration: none;
      font-weight: 500;
      font-size: 16px;
    }
    
    .document-link:hover {
      text-decoration: underline;
    }
    
    .document-type {
      color: #666;
      font-size: 14px;
    }
    
    .message-stats {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px 20px;
      background: #f8f9fa;
      border-top: 1px solid #e9ecef;
      font-size: 14px;
      color: #666;
    }
    
    .link-preview {
      background: #e3f2fd;
      border: 1px solid #2196f3;
      border-radius: 8px;
      padding: 12px;
      margin: 10px 0;
    }
    
    .link-preview a {
      color: #1976d2;
      text-decoration: none;
      word-break: break-all;
      font-weight: 500;
    }
    
    .link-preview a:hover {
      text-decoration: underline;
    }
    
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: white;
    }
    
    .empty-state h2 {
      font-size: 2rem;
      margin-bottom: 15px;
      opacity: 0.9;
    }
    
    .empty-state p {
      font-size: 1.1rem;
      opacity: 0.7;
    }
    
    /* Modal styles */
    .modal {
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.9);
    }
    
    .modal-content {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      max-width: 90vw;
      max-height: 90vh;
    }
    
    .modal-image {
      width: 100%;
      height: auto;
      border-radius: 8px;
    }

    /* XML Modal styles */
    .xml-modal {
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(5px);
    }

    .xml-modal-content {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 90vw;
      max-width: 800px;
      height: 80vh;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .xml-modal-header {
      background: linear-gradient(135deg, #FF6B6B, #FF8E53);
      color: white;
      padding: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
    }

    .xml-modal-title {
      font-size: 18px;
      margin: 0;
    }

    .xml-modal-close {
      background: none;
      border: none;
      color: white;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: background-color 0.3s ease;
    }

    .xml-modal-close:hover {
      background-color: rgba(255, 255, 255, 0.2);
    }

    .xml-modal-body {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .xml-content {
      flex: 1;
      overflow: auto;
      padding: 20px;
      background: #f8f9fa;
      font-family: 'Courier New', monospace;
      font-size: 14px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .xml-actions {
      padding: 20px;
      background: white;
      border-top: 1px solid #e9ecef;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 15px;
    }

    .xml-copy-button {
      background: linear-gradient(45deg, #4ECDC4, #44A08D);
      color: white;
      padding: 10px 20px;
      border: none;
      border-radius: 20px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .xml-copy-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(78, 205, 196, 0.4);
    }

    .xml-download-button {
      background: linear-gradient(45deg, #667eea, #764ba2);
      color: white;
      padding: 10px 20px;
      border: none;
      border-radius: 20px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .xml-download-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }

    .xml-info {
      color: #666;
      font-size: 14px;
    }

    .close {
      position: absolute;
      top: 15px;
      right: 35px;
      color: #f1f1f1;
      font-size: 40px;
      font-weight: bold;
      cursor: pointer;
    }
    
    .close:hover,
    .close:focus {
      color: #bbb;
      text-decoration: none;
      cursor: pointer;
    }

    .loading {
      display: none;
      position: fixed;
      z-index: 1001;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
    }

    .loading-content {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 30px;
      border-radius: 16px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    }

    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #25D366;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 15px;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    @media (max-width: 768px) {
      .container {
        padding: 10px;
      }
      
      .header {
        padding: 20px;
      }
      
      .header h1 {
        font-size: 2rem;
      }
      
      .header-actions {
        flex-direction: column;
        align-items: center;
      }
      
      .xml-button, .refresh-button {
        width: 100%;
        max-width: 250px;
        justify-content: center;
      }
      
      .message-header {
        flex-direction: column;
        gap: 10px;
        text-align: center;
      }
      
      .status-bar {
        flex-direction: column;
        align-items: center;
      }
      
      .xml-modal-content {
        width: 95vw;
        height: 90vh;
      }
      
      .xml-actions {
        flex-direction: column;
      }
      
      .xml-copy-button, .xml-download-button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📱 WhatsApp Monitor</h1>
      <div class="header-actions">
        <button class="xml-button" onclick="showXMLModal()">
          📄 View XML Feed
        </button>
        <button class="refresh-button" onclick="location.reload()">
          🔄 Refresh
        </button>
      </div>
      <div class="status-bar">
        <div class="status-item ${status.isConnected ? 'status-active' : ''}">
          Status: ${status.isConnected ? 'Connected' : 'Disconnected'}
        </div>
        <div class="status-item">
          Messages: ${groupedMessages.length}
        </div>
        <div class="status-item">
          Last Updated: ${new Date().toLocaleString()}
        </div>
      </div>
    </div>

    <div class="message-feed">
      ${groupedMessages.length === 0 ? `
        <div class="empty-state">
          <h2>📭 No Messages Yet</h2>
          <p>Messages will appear here once your WhatsApp monitor starts collecting data.</p>
        </div>
      ` : groupedMessages.map(group => generateMessageCard(group)).join('')}
    </div>
  </div>

  <!-- Image Modal -->
  <div id="imageModal" class="modal">
    <span class="close" onclick="closeImageModal()">&times;</span>
    <div class="modal-content">
      <img id="modalImage" class="modal-image" alt="Full size image">
    </div>
  </div>

  <!-- XML Modal -->
  <div id="xmlModal" class="xml-modal">
    <div class="xml-modal-content">
      <div class="xml-modal-header">
        <h3 class="xml-modal-title">RSS Feed XML Content</h3>
        <button class="xml-modal-close" onclick="closeXMLModal()">&times;</button>
      </div>
      <div class="xml-modal-body">
        <div id="xmlContent" class="xml-content">
          Loading XML content...
        </div>
        <div class="xml-actions">
          <div class="xml-info">
            <span id="xmlSize">Size: --</span> | 
            <span id="xmlTimestamp">Updated: --</span>
          </div>
          <div>
            <button class="xml-copy-button" onclick="copyXMLToClipboard()">
              📋 Copy to Clipboard
            </button>
            <button class="xml-download-button" onclick="downloadXML()">
              💾 Download XML
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Loading Modal -->
  <div id="loadingModal" class="loading">
    <div class="loading-content">
      <div class="spinner"></div>
      <p>Loading XML content...</p>
    </div>
  </div>

  <script>
    // Image modal functionality
    function openImageModal(src) {
      const modal = document.getElementById('imageModal');
      const modalImage = document.getElementById('modalImage');
      modal.style.display = 'block';
      modalImage.src = src;
    }

    function closeImageModal() {
      const modal = document.getElementById('imageModal');
      modal.style.display = 'none';
    }

    // XML modal functionality
    let xmlData = null;

    function showXMLModal() {
      const modal = document.getElementById('xmlModal');
      const loading = document.getElementById('loadingModal');
      
      loading.style.display = 'block';
      modal.style.display = 'block';
      
      // Fetch XML content
      fetch('/api/rss-xml-content')
        .then(response => response.json())
        .then(data => {
          loading.style.display = 'none';
          
          if (data.error) {
            document.getElementById('xmlContent').textContent = 
              'Error: ' + data.error + '\\n\\n' + (data.message || '');
            document.getElementById('xmlSize').textContent = 'Size: --';
            document.getElementById('xmlTimestamp').textContent = 'Updated: --';
          } else {
            xmlData = data;
            document.getElementById('xmlContent').textContent = data.xml;
            document.getElementById('xmlSize').textContent = 
              \`Size: \${(data.size / 1024).toFixed(2)} KB\`;
            document.getElementById('xmlTimestamp').textContent = 
              \`Updated: \${new Date(data.timestamp).toLocaleString()}\`;
          }
        })
        .catch(error => {
          loading.style.display = 'none';
          document.getElementById('xmlContent').textContent = 
            'Error loading XML: ' + error.message;
          document.getElementById('xmlSize').textContent = 'Size: --';
          document.getElementById('xmlTimestamp').textContent = 'Updated: --';
        });
    }

    function closeXMLModal() {
      document.getElementById('xmlModal').style.display = 'none';
    }

    function copyXMLToClipboard() {
      if (!xmlData || !xmlData.xml) {
        alert('No XML content to copy');
        return;
      }

      navigator.clipboard.writeText(xmlData.xml).then(() => {
        const button = document.querySelector('.xml-copy-button');
        const originalText = button.textContent;
        button.textContent = '✅ Copied!';
        button.style.background = 'linear-gradient(45deg, #28a745, #20c997)';
        
        setTimeout(() => {
          button.textContent = originalText;
          button.style.background = 'linear-gradient(45deg, #4ECDC4, #44A08D)';
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy: ', err);
        alert('Failed to copy XML to clipboard');
      });
    }

    function downloadXML() {
      if (!xmlData || !xmlData.xml) {
        alert('No XML content to download');
        return;
      }

      const blob = new Blob([xmlData.xml], { type: 'application/xml' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = \`whatsapp-feed-\${new Date().toISOString().split('T')[0]}.xml\`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }

    // Close modals when clicking outside
    window.onclick = function(event) {
      const imageModal = document.getElementById('imageModal');
      const xmlModal = document.getElementById('xmlModal');
      
      if (event.target === imageModal) {
        closeImageModal();
      }
      if (event.target === xmlModal) {
        closeXMLModal();
      }
    }

    // Handle escape key
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        closeImageModal();
        closeXMLModal();
      }
    });
  </script>
</body>
</html>`;}