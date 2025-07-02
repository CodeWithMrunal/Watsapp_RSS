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

  // NEW: Enhanced RSS web view endpoint
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

  // NEW: Individual message view
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

  // NEW: Media info endpoint
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

  // NEW: Debug endpoint to inspect message structure
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

function generateRSSWebView(messages, whatsappManager) {
  const status = whatsappManager.getStatus();
  const groupedMessages = messages.slice().reverse(); // Show newest first

  return `
    <!DOCTYPE html>
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
          cursor: pointer;
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
        
        .close-modal {
          position: absolute;
          top: 20px;
          right: 35px;
          color: #f1f1f1;
          font-size: 40px;
          font-weight: bold;
          cursor: pointer;
          z-index: 1001;
        }
        
        .close-modal:hover {
          opacity: 0.7;
        }
        
        /* Mobile responsiveness */
        @media (max-width: 768px) {
          .container {
            padding: 10px;
          }
          
          .header {
            padding: 20px;
            margin-bottom: 20px;
          }
          
          .header h1 {
            font-size: 2rem;
          }
          
          .message-header {
            padding: 15px;
            flex-direction: column;
            gap: 10px;
            align-items: flex-start;
          }
          
          .message-content {
            padding: 15px;
          }
          
          .document-info {
            flex-direction: column;
            text-align: center;
            gap: 10px;
          }
          
          .message-stats {
            flex-direction: column;
            gap: 10px;
            align-items: flex-start;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📱 WhatsApp Monitor</h1>
          <p style="text-align: center; color: #666; margin: 10px 0;">Real-time message feed with media support</p>
          
          <div class="status-bar">
            <div class="status-item ${status.authenticated ? 'status-active' : ''}">
              ${status.authenticated ? '✅ Connected' : '❌ Disconnected'}
            </div>
            <div class="status-item ${status.ready ? 'status-active' : ''}">
              ${status.ready ? '🟢 Ready' : '🟡 Initializing'}
            </div>
            ${status.selectedGroup ? `<div class="status-item status-active">📁 ${status.selectedGroup}</div>` : ''}
            ${status.cachedGroups > 0 ? `<div class="status-item">${status.cachedGroups} Groups Cached</div>` : ''}
          </div>
        </div>
        
        ${groupedMessages.length === 0 ? generateEmptyStateHTML() : generateMessagesHTML(groupedMessages)}
      </div>
      
      <!-- Image Modal -->
      <div id="imageModal" class="modal">
        <span class="close-modal">&times;</span>
        <div class="modal-content">
          <img class="modal-image" src="" alt="Enlarged image">
        </div>
      </div>
      
      <script>
        // Image modal functionality
        function openImageModal(img) {
          const modal = document.getElementById('imageModal');
          const modalImg = modal.querySelector('.modal-image');
          modalImg.src = img.src;
          modal.style.display = 'block';
          document.body.style.overflow = 'hidden';
        }
        
        // Close modal functionality
        const modal = document.getElementById('imageModal');
        const closeBtn = modal.querySelector('.close-modal');
        
        closeBtn.addEventListener('click', function() {
          modal.style.display = 'none';
          document.body.style.overflow = 'auto';
        });
        
        modal.addEventListener('click', function(e) {
          if (e.target === modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
          }
        });
        
        // Close on escape key
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape' && modal.style.display === 'block') {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
          }
        });
        
        // Auto-refresh every 30 seconds
        setInterval(function() {
          window.location.reload();
        }, 30000);
        
        // Lazy loading for images
        const images = document.querySelectorAll('.media-image');
        const imageObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const img = entry.target;
              img.style.opacity = '1';
            }
          });
        });
        
        images.forEach(img => {
          img.style.opacity = '0.5';
          img.style.transition = 'opacity 0.3s ease';
          imageObserver.observe(img);
        });
      </script>
    </body>
    </html>
  `;
}

function generateMessagesHTML(messages) {
  return `
    <div class="message-feed">
      ${messages.map(messageGroup => generateMessageCardHTML(messageGroup)).join('')}
    </div>
  `;
}

function generateMessageCardHTML(messageGroup) {
  // Add safety checks
  if (!messageGroup) {
    console.warn('messageGroup is undefined');
    return '<div class="message-card"><div class="message-content">Invalid message group</div></div>';
  }

  if (!messageGroup.messages || !Array.isArray(messageGroup.messages)) {
    console.warn('messageGroup.messages is invalid:', messageGroup);
    return `
      <div class="message-card">
        <div class="message-header">
          <div class="author-info">
            <div class="author-avatar">${messageGroup.author ? messageGroup.author.charAt(0).toUpperCase() : '?'}</div>
            <div class="author-name">${messageGroup.author || 'Unknown'}</div>
          </div>
          <div class="message-time">${new Date(messageGroup.timestamp * 1000).toLocaleString()}</div>
        </div>
        <div class="message-content">
          <div class="text-message">No messages found or invalid format</div>
        </div>
      </div>
    `;
  }

  const authorInitial = messageGroup.author ? messageGroup.author.charAt(0).toUpperCase() : '?';
  const messageTime = new Date((messageGroup.timestamp || Date.now() / 1000) * 1000).toLocaleString();
  
  let mediaCount = 0;
  let linkCount = 0;
  let hasImages = false;
  let hasVideos = false;
  let hasAudio = false;
  
  const messageContent = messageGroup.messages.map(msg => {
    // Safety check for individual messages
    if (!msg) {
      return '<div class="text-message">Invalid message</div>';
    }

    if (msg.type === 'chat' && msg.body) {
      // Count links
      const links = msg.body.match(/https?:\/\/[^\s]+/g) || [];
      linkCount += links.length;
      
      // Format message with link previews
      let formattedBody = msg.body
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      
      // Convert URLs to previews
      formattedBody = formattedBody.replace(/(https?:\/\/[^\s]+)/g, (url) => {
        if (url.includes('drive.google.com')) {
          return `<div class="link-preview"><a href="${url}" target="_blank">📁 Google Drive: ${url}</a></div>`;
        } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
          return `<div class="link-preview"><a href="${url}" target="_blank">🎥 YouTube: ${url}</a></div>`;
        } else {
          return `<div class="link-preview"><a href="${url}" target="_blank">🔗 ${url}</a></div>`;
        }
      });
      
      formattedBody = formattedBody.replace(/\n/g, '<br>');
      return `<div class="text-message">${formattedBody}</div>`;
      
    } else if (msg.hasMedia) {
      mediaCount++;
      
      if (msg.mediaPath) {
        const mediaUrl = `/media/${path.basename(msg.mediaPath)}`;
        const caption = msg.body ? msg.body.replace(/\n/g, '<br>') : '';
        
        switch (msg.type) {
          case 'image':
            hasImages = true;
            return `
              <div class="media-container">
                <img src="${mediaUrl}" alt="Shared image" class="media-image" onclick="openImageModal(this)" loading="lazy">
                ${caption ? `<div class="media-caption">${caption}</div>` : ''}
              </div>
            `;
          
          case 'video':
            hasVideos = true;
            return `
              <div class="media-container">
                <video controls class="media-video" preload="metadata">
                  <source src="${mediaUrl}" type="video/mp4">
                  <source src="${mediaUrl}" type="video/webm">
                  Your browser does not support the video tag.
                </video>
                ${caption ? `<div class="media-caption">${caption}</div>` : ''}
              </div>
            `;
          
          case 'audio':
          case 'ptt':
            hasAudio = true;
            return `
              <div class="media-container">
                <audio controls class="media-audio">
                  <source src="${mediaUrl}" type="audio/mpeg">
                  <source src="${mediaUrl}" type="audio/ogg">
                  Your browser does not support the audio tag.
                </audio>
                ${caption ? `<div class="media-caption">${caption}</div>` : ''}
              </div>
            `;
          
          case 'document':
            const fileName = path.basename(msg.mediaPath);
            return `
              <div class="document-container">
                <div class="document-info">
                  <div class="document-icon">📄</div>
                  <div>
                    <a href="${mediaUrl}" download="${fileName}" class="document-link">${fileName}</a>
                    <div class="document-type">Document</div>
                    ${caption ? `<div class="media-caption">${caption}</div>` : ''}
                  </div>
                </div>
              </div>
            `;
          
          default:
            return `
              <div class="document-container">
                <div class="document-info">
                  <div class="document-icon">📎</div>
                  <div>
                    <a href="${mediaUrl}" target="_blank" class="document-link">${msg.type.toUpperCase()} File</a>
                    ${caption ? `<div class="media-caption">${caption}</div>` : ''}
                  </div>
                </div>
              </div>
            `;
        }
      } else {
        // Media without file
        return `
          <div class="document-container">
            <div class="document-info">
              <div class="document-icon">❌</div>
              <div>
                <span class="document-link">${msg.type ? msg.type.toUpperCase() : 'UNKNOWN'} - Download Failed</span>
                ${msg.body ? `<div class="media-caption">${msg.body}</div>` : ''}
              </div>
            </div>
          </div>
        `;
      }
    }
    
    // Handle empty or unknown message types
    return msg.body ? `<div class="text-message">${msg.body}</div>` : '';
  }).filter(content => content !== '').join(''); // Filter out empty content
  
  // Generate stats
  const stats = [];
  if (messageGroup.messages.length > 1) {
    stats.push(`${messageGroup.messages.length} messages`);
  }
  if (mediaCount > 0) {
    const mediaTypes = [];
    if (hasImages) mediaTypes.push('📸 images');
    if (hasVideos) mediaTypes.push('🎥 videos');
    if (hasAudio) mediaTypes.push('🎵 audio');
    stats.push(`${mediaCount} media file${mediaCount > 1 ? 's' : ''} ${mediaTypes.length > 0 ? `(${mediaTypes.join(', ')})` : ''}`);
  }
  if (linkCount > 0) {
    stats.push(`🔗 ${linkCount} link${linkCount > 1 ? 's' : ''}`);
  }
  
  return `
    <div class="message-card">
      <div class="message-header">
        <div class="author-info">
          <div class="author-avatar">${authorInitial}</div>
          <div class="author-name">${messageGroup.author || 'Unknown'}</div>
        </div>
        <div class="message-time">${messageTime}</div>
      </div>
      
      <div class="message-content">
        ${messageContent || '<div class="text-message">No content available</div>'}
      </div>
      
      ${stats.length > 0 ? `
        <div class="message-stats">
          <div>${stats.join(' • ')}</div>
          <div><a href="/api/message/${messageGroup.id}" target="_blank">View Details</a></div>
        </div>
      ` : ''}
    </div>
  `;
}

function generateEmptyStateHTML() {
  return `
    <div class="empty-state">
      <h2>📭 No Messages Yet</h2>
      <p>Start monitoring a WhatsApp group to see messages appear here!</p>
    </div>
  `;
}

function generateEmptyFeedHTML() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp Monitor - No Feed</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0;
        }
        .container {
          text-align: center;
          color: white;
          padding: 40px;
        }
        h1 { font-size: 3rem; margin-bottom: 20px; }
        p { font-size: 1.2rem; opacity: 0.8; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📱 WhatsApp Monitor</h1>
        <p>RSS feed will be available once you start monitoring messages</p>
      </div>
    </body>
    </html>
  `;
}

function generateSingleMessageView(messageGroup) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Message from ${messageGroup.author}</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 20px;
          margin: 0;
        }
        .container {
          max-width: 800px;
          margin: 0 auto;
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${generateMessageCardHTML(messageGroup)}
        <div style="text-align: center; margin-top: 20px;">
          <a href="/api/rss-view" style="color: white; text-decoration: none; background: rgba(255,255,255,0.2); padding: 10px 20px; border-radius: 25px;">← Back to Feed</a>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = createApiRoutes;