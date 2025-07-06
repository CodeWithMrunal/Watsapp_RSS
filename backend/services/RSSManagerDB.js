const RSS = require('rss');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const Message = require('../database/models/Message');
const Media = require('../database/models/Media');
const { Group, Author, Link } = require('../database/models/Group');
const Analytics = require('../database/models/Analytics');

class RSSManagerDB {
  constructor() {
    this.rssFeed = null;
    this.initialize();
  }

  initialize() {
    this.rssFeed = new RSS({
      ...config.rss,
      custom_namespaces: {
        'content': 'http://purl.org/rss/1.0/modules/content/',
        'media': 'http://search.yahoo.com/mrss/',
        'dc': 'http://purl.org/dc/elements/1.1/'
      }
    });
    console.log('✅ RSS Feed initialized with MongoDB support');
  }

  /**
   * Generate media HTML from database record
   */
  generateMediaHTML(media) {
    if (!media) return '';

    const mediaUrl = `http://localhost:${config.server.port}/${media.path}`;
    const caption = media.caption ? this.formatMessageForRSS(media.caption) : '';
    
    switch (media.mediaType) {
      case 'image':
        return `
          <div class="media-container image-container">
            <img src="${mediaUrl}" alt="Shared image" class="media-image" loading="lazy" onclick="openImageModal(this)">
            ${caption ? `<div class="media-caption">${caption}</div>` : ''}
            <div class="media-meta">
              <span class="file-size">${media.humanFileSize || media.fileSizeMB + ' MB'}</span>
              ${media.dimensions?.width ? `<span class="dimensions">${media.dimensions.width}×${media.dimensions.height}</span>` : ''}
            </div>
          </div>
        `;
      
      case 'video':
        return `
          <div class="media-container video-container">
            <video controls class="media-video" preload="metadata">
              <source src="${mediaUrl}" type="${media.mimetype || 'video/mp4'}">
              Your browser does not support the video tag.
            </video>
            ${caption ? `<div class="media-caption">${caption}</div>` : ''}
            <div class="media-meta">
              <span class="file-size">${media.humanFileSize || media.fileSizeMB + ' MB'}</span>
              ${media.dimensions?.duration ? `<span class="duration">${this.formatDuration(media.dimensions.duration)}</span>` : ''}
            </div>
          </div>
        `;
      
      case 'audio':
      case 'ptt':
        return `
          <div class="media-container audio-container">
            <audio controls class="media-audio">
              <source src="${mediaUrl}" type="${media.mimetype || 'audio/mpeg'}">
              Your browser does not support the audio tag.
            </audio>
            ${caption ? `<div class="media-caption">${caption}</div>` : ''}
            <div class="media-meta">
              <span class="file-size">${media.humanFileSize || media.fileSizeMB + ' MB'}</span>
              ${media.dimensions?.duration ? `<span class="duration">${this.formatDuration(media.dimensions.duration)}</span>` : ''}
            </div>
          </div>
        `;
      
      case 'document':
        return `
          <div class="media-container document-container">
            <div class="document-info">
              <div class="document-icon">📄</div>
              <div class="document-details">
                <a href="${mediaUrl}" download="${media.filename}" class="document-link">
                  ${media.originalFilename || media.filename}
                </a>
                <div class="document-meta">
                  <span class="document-type">Document</span>
                  <span class="file-size">${media.humanFileSize || media.fileSizeMB + ' MB'}</span>
                </div>
              </div>
            </div>
            ${caption ? `<div class="media-caption">${caption}</div>` : ''}
          </div>
        `;
      
      default:
        return `
          <div class="media-container generic-container">
            <div class="generic-media">
              <a href="${mediaUrl}" target="_blank" class="media-link">
                📎 ${media.mediaType.toUpperCase()} File
              </a>
            </div>
            ${caption ? `<div class="media-caption">${caption}</div>` : ''}
          </div>
        `;
    }
  }

  /**
   * Format duration in seconds to human-readable format
   */
  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Generate enhanced CSS
   */
  generateEnhancedCSS() {
    return `
      <style type="text/css">
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          background-color: #f8f9fa;
        }
        
        .message-group {
          background: white;
          margin: 20px 0;
          padding: 20px;
          border-radius: 12px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          border-left: 4px solid #25D366;
        }
        
        .group-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
          padding-bottom: 10px;
          border-bottom: 1px solid #eee;
        }
        
        .author-info {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .author-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #25D366;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
        }
        
        .author-name {
          font-weight: 600;
          color: #25D366;
          font-size: 16px;
        }
        
        .group-time {
          color: #666;
          font-size: 14px;
        }
        
        .group-stats {
          display: flex;
          gap: 15px;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid #eee;
          font-size: 12px;
          color: #666;
        }
        
        .stat-item {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        
        .message-container {
          margin: 15px 0;
          padding: 12px;
          background: #f5f5f5;
          border-radius: 8px;
        }
        
        .message-time {
          font-size: 11px;
          color: #999;
          margin-bottom: 5px;
        }
        
        .message-content {
          white-space: pre-wrap;
          word-wrap: break-word;
        }
        
        .media-container {
          margin: 15px 0;
          border-radius: 8px;
          overflow: hidden;
          background: #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .media-image {
          max-width: 100%;
          height: auto;
          display: block;
          cursor: pointer;
        }
        
        .media-video {
          width: 100%;
          max-height: 400px;
          background: #000;
        }
        
        .media-audio {
          width: 100%;
        }
        
        .media-caption {
          padding: 12px;
          background: #f8f9fa;
          border-top: 1px solid #eee;
          font-style: italic;
          color: #666;
        }
        
        .media-meta {
          padding: 8px 12px;
          background: #f0f0f0;
          font-size: 12px;
          color: #666;
          display: flex;
          gap: 15px;
        }
        
        .link-preview {
          margin: 10px 0;
          padding: 12px;
          border: 1px solid #ddd;
          border-radius: 8px;
          background: #f8f9fa;
        }
        
        .link-preview a {
          color: #007bff;
          text-decoration: none;
          word-break: break-all;
        }
        
        .analytics-summary {
          background: #e8f5e9;
          padding: 15px;
          border-radius: 8px;
          margin-top: 20px;
        }
        
        .analytics-summary h4 {
          margin: 0 0 10px 0;
          color: #2e7d32;
        }
        
        .analytics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 10px;
        }
        
        .analytics-item {
          background: white;
          padding: 10px;
          border-radius: 6px;
          text-align: center;
        }
        
        .analytics-value {
          font-size: 24px;
          font-weight: bold;
          color: #25D366;
        }
        
        .analytics-label {
          font-size: 12px;
          color: #666;
        }
        
        @media (max-width: 768px) {
          body {
            padding: 10px;
          }
          
          .message-group {
            margin: 10px 0;
            padding: 15px;
          }
          
          .group-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }
          
          .analytics-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      </style>
    `;
  }

  /**
   * Generate JavaScript for enhanced functionality
   */
  generateEnhancedJS() {
    return `
      <script type="text/javascript">
        // Image modal functionality
        function openImageModal(img) {
          const modal = document.getElementById('imageModal') || createImageModal();
          const modalImg = modal.querySelector('.modal-image');
          modalImg.src = img.src;
          modal.style.display = 'block';
          document.body.style.overflow = 'hidden';
        }
        
        function createImageModal() {
          const modal = document.createElement('div');
          modal.id = 'imageModal';
          modal.className = 'image-modal';
          modal.innerHTML = \`
            <span class="close-modal">&times;</span>
            <div class="modal-content">
              <img class="modal-image" src="" alt="Enlarged image">
            </div>
          \`;
          document.body.appendChild(modal);
          
          modal.addEventListener('click', function(e) {
            if (e.target === modal || e.target.className === 'close-modal') {
              modal.style.display = 'none';
              document.body.style.overflow = 'auto';
            }
          });
          
          return modal;
        }
      </script>
    `;
  }

  /**
   * Format message body for RSS
   */
  formatMessageForRSS(body) {
    if (!body) return '';
    
    // Escape HTML characters
    let formatted = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    
    // Enhanced URL detection and formatting
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    formatted = formatted.replace(urlRegex, (url) => {
      if (url.includes('drive.google.com')) {
        return `<div class="link-preview"><a href="${url}" target="_blank">📁 Google Drive: ${url}</a></div>`;
      } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return `<div class="link-preview"><a href="${url}" target="_blank">🎥 YouTube: ${url}</a></div>`;
      } else {
        return `<div class="link-preview"><a href="${url}" target="_blank">🔗 ${url}</a></div>`;
      }
    });
    
    // Convert newlines to <br> tags
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
  }

  /**
   * Generate RSS feed from database
   */
async generateFeed(options = {}) {
  const {
    groupId = null,
    limit = 50,
    startDate = null,
    endDate = null,
    includeAnalytics = true
  } = options;

  try {
    // Reset feed
    this.initialize();

    // Build query
    const query = {};
    if (groupId) query.groupId = groupId;
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = startDate;
      if (endDate) query.timestamp.$lte = endDate;
    }

    // Get recent message groups
    const groups = await Group.find(query)
      .sort({ startTimestamp: -1 })
      .limit(limit)
      .populate('mediaIds');

    console.log(`📊 Generating RSS feed with ${groups.length} message groups`);

    // If no groups found but we have a groupId, try to create from messages
    if (groups.length === 0 && groupId) {
      console.log('📋 No groups found, checking for messages...');
      
      const messages = await Message.findByGroup(groupId, { limit: 100 });
      if (messages.length > 0) {
        console.log(`📊 Found ${messages.length} messages, creating groups...`);
        
        // Convert messages to the format expected by MessageUtils
        const messageData = messages.map(msg => msg.toObject());
        const groupedMessages = MessageUtils.groupMessages(messageData);
        
        // Save groups to database
        for (const group of groupedMessages) {
          const groupData = MessageUtils.createGroupMetadata(group);
          const savedGroup = await Group.create(groupData);
          groups.push(savedGroup);
        }
        
        console.log(`✅ Created ${groups.length} groups from messages`);
      }
    }

    // Add analytics summary if requested
    if (includeAnalytics && groupId) {
      await this.addAnalyticsSummary(groupId);
    }

    // Process each group
    for (const group of groups) {
      await this.addGroupToFeed(group);
    }

    // Save feed
    await this.saveFeed();

    return true;
  } catch (error) {
    console.error('❌ Error generating RSS feed:', error);
    return false;
  }
}

  /**
   * Add analytics summary to feed
   */
  async addAnalyticsSummary(groupId) {
    try {
      const summary = await Analytics.getGroupSummary(groupId);
      if (!summary) return;

      const trends = await Analytics.getGroupTrends(groupId, 7);
      
      let description = this.generateEnhancedCSS() + this.generateEnhancedJS();
      
      description += `
        <div class="analytics-summary">
          <h4>📊 Weekly Analytics Summary</h4>
          <div class="analytics-grid">
            <div class="analytics-item">
              <div class="analytics-value">${summary.totalMessages}</div>
              <div class="analytics-label">Total Messages</div>
            </div>
            <div class="analytics-item">
              <div class="analytics-value">${Math.round(summary.avgDailyMessages)}</div>
              <div class="analytics-label">Daily Average</div>
            </div>
            <div class="analytics-item">
              <div class="analytics-value">${Math.round(summary.avgUniqueAuthors)}</div>
              <div class="analytics-label">Active Users</div>
            </div>
            <div class="analytics-item">
              <div class="analytics-value">${summary.totalMediaMessages}</div>
              <div class="analytics-label">Media Shared</div>
            </div>
          </div>
        </div>
      `;

      this.rssFeed.item({
        title: '📊 Weekly Analytics Summary',
        description: description,
        url: `http://localhost:${config.server.port}/analytics/${groupId}`,
        date: new Date(),
        guid: `analytics_${groupId}_${Date.now()}`,
        categories: ['analytics', 'summary']
      });
    } catch (error) {
      console.error('❌ Error adding analytics summary:', error);
    }
  }

  /**
   * Add a message group to the feed
   */
  async addGroupToFeed(group) {
    try {
      // Get messages for this group
      const messages = await Message.find({
        id: { $in: group.messageIds }
      }).sort({ timestamp: 1 });

      // Get author information
      const author = await Author.findOne({ id: group.author });
      
      let description = '';
      let title = `Messages from ${author?.displayName || group.author}`;
      
      // Start group container
      description += '<div class="message-group">';
      
      // Group header
      description += `
        <div class="group-header">
          <div class="author-info">
            <div class="author-avatar">${this.getInitials(author?.displayName || group.author)}</div>
            <div>
              <div class="author-name">${author?.displayName || group.author}</div>
              <div class="group-time">${new Date(group.startTimestamp * 1000).toLocaleString()}</div>
            </div>
          </div>
          <div class="group-duration">${group.formattedDuration || this.formatDuration(group.duration)}</div>
        </div>
      `;

      // Process messages
      for (const message of messages) {
        description += '<div class="message-container">';
        description += `<div class="message-time">${new Date(message.timestamp * 1000).toLocaleTimeString()}</div>`;
        
        if (message.hasMedia && message.mediaId) {
          // Get media from database
          const media = await Media.findById(message.mediaId);
          if (media) {
            description += this.generateMediaHTML(media);
          }
        } else if (message.body) {
          description += `<div class="message-content">${this.formatMessageForRSS(message.body)}</div>`;
        }
        
        description += '</div>';
      }

      // Group statistics
      description += `
        <div class="group-stats">
          <div class="stat-item">
            <span>💬</span>
            <span>${group.statistics.totalMessages} messages</span>
          </div>
          ${group.statistics.mediaMessages > 0 ? `
            <div class="stat-item">
              <span>🎬</span>
              <span>${group.statistics.mediaMessages} media</span>
            </div>
          ` : ''}
          ${group.statistics.linkCount > 0 ? `
            <div class="stat-item">
              <span>🔗</span>
              <span>${group.statistics.linkCount} links</span>
            </div>
          ` : ''}
        </div>
      `;
      
      description += '</div>';

      // Create RSS item
      const rssItem = {
        title: title,
        description: description,
        url: `http://localhost:${config.server.port}/group/${group.id}`,
        date: new Date(group.startTimestamp * 1000),
        guid: group.id,
        categories: ['whatsapp', group.groupId],
        custom_elements: [
          { 'content:encoded': `<![CDATA[${description}]]>` },
          { 'dc:creator': author?.displayName || group.author }
        ]
      };

      this.rssFeed.item(rssItem);
    } catch (error) {
      console.error('❌ Error adding group to feed:', error);
    }
  }

  /**
   * Get initials from name
   */
  getInitials(name) {
    const parts = name.split(/[\s@]+/);
    if (parts.length >= 2) {
      return parts[0][0] + parts[1][0];
    }
    return name.substring(0, 2).toUpperCase();
  }

  /**
   * Save RSS feed to file
   */
  async saveFeed() {
    try {
      await fs.ensureDir('./rss');
      
      const rssXml = this.rssFeed.xml({ indent: true });
      await fs.writeFile('./rss/feed.xml', rssXml);
      
      console.log('✅ RSS feed saved to ./rss/feed.xml');
    } catch (error) {
      console.error('❌ Error saving RSS feed:', error);
      throw error;
    }
  }

  /**
   * Generate feed for specific time range
   */
  async generateDailyFeed(date = new Date()) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return this.generateFeed({
      startDate: Math.floor(startOfDay.getTime() / 1000),
      endDate: Math.floor(endOfDay.getTime() / 1000),
      includeAnalytics: true
    });
  }

  /**
   * Generate feed for specific author
   */
  async generateAuthorFeed(authorId, limit = 20) {
    try {
      this.initialize();

      const author = await Author.findOne({ id: authorId });
      if (!author) {
        console.error('❌ Author not found');
        return false;
      }

      const groups = await Group.find({ author: authorId })
        .sort({ startTimestamp: -1 })
        .limit(limit);

      console.log(`📊 Generating author feed for ${author.displayName || authorId} with ${groups.length} groups`);

      // Add author summary
      let summaryDesc = this.generateEnhancedCSS() + this.generateEnhancedJS();
      summaryDesc += `
        <div class="analytics-summary">
          <h4>Author Summary: ${author.displayName || authorId}</h4>
          <div class="analytics-grid">
            <div class="analytics-item">
              <div class="analytics-value">${author.totalMessages}</div>
              <div class="analytics-label">Total Messages</div>
            </div>
            <div class="analytics-item">
              <div class="analytics-value">${author.mediaPercentage}%</div>
              <div class="analytics-label">Media Messages</div>
            </div>
            <div class="analytics-item">
              <div class="analytics-value">${author.groupCount}</div>
              <div class="analytics-label">Groups</div>
            </div>
            <div class="analytics-item">
              <div class="analytics-value">${author.activityStatus}</div>
              <div class="analytics-label">Status</div>
            </div>
          </div>
        </div>
      `;

      this.rssFeed.item({
        title: `Author Profile: ${author.displayName || authorId}`,
        description: summaryDesc,
        url: `http://localhost:${config.server.port}/author/${authorId}`,
        date: new Date(),
        guid: `author_${authorId}_${Date.now()}`
      });

      // Add groups
      for (const group of groups) {
        await this.addGroupToFeed(group);
      }

      await this.saveFeed();
      return true;
    } catch (error) {
      console.error('❌ Error generating author feed:', error);
      return false;
    }
  }

  reset() {
    this.initialize();
  }
}

module.exports = RSSManagerDB;