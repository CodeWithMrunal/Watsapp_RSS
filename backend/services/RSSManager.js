const RSS = require('rss');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const DatabaseService = require('./DatabaseService');

class RSSManager {
  constructor() {
    this.rssFeed = null;
    this.databaseService = new DatabaseService();
    this.initialize();
  }

async initialize() {
  try {
    // Initialize RSS feed
    this.rssFeed = new RSS({
      ...config.rss,
      custom_namespaces: {
        'content': 'http://purl.org/rss/1.0/modules/content/',
        'media': 'http://search.yahoo.com/mrss/',
        'dc': 'http://purl.org/dc/elements/1.1/'
      }
    });
    
    // Initialize database if not already done
    if (!this.databaseService.isInitialized) {
      await this.databaseService.initialize(false); // Don't force sync
    }
    
    console.log('✅ RSS Feed initialized with database support');
  } catch (error) {
    console.error('⚠️ RSS Manager initialization error:', error);
    // Don't throw - allow the app to continue even if DB has issues
  }
}
  /**
   * Generate RSS feed from database
   */
  async generateFeedFromDatabase(options = {}) {
    try {
      const { 
        limit = 50, 
        authorId = null, 
        groupId = null,
        mediaOnly = false,
        startDate = null,
        endDate = null
      } = options;

      // Reset feed
      this.rssFeed = new RSS({
        ...config.rss,
        custom_namespaces: {
          'content': 'http://purl.org/rss/1.0/modules/content/',
          'media': 'http://search.yahoo.com/mrss/',
          'dc': 'http://purl.org/dc/elements/1.1/'
        }
      });

      // Get message groups from database
      const groups = await this.databaseService.getMessageGroups({
        limit,
        authorId,
        startDate,
        endDate
      });

      // Add CSS and JS to the feed
      const enhancedCSS = this.generateEnhancedCSS();
      const enhancedJS = this.generateEnhancedJS();

      // Process each group
      for (const group of groups) {
        await this.addGroupToFeed(group, enhancedCSS, enhancedJS);
      }

      // Save the feed
      const rssXml = this.rssFeed.xml({ indent: true });
      fs.writeFileSync('./rss/feed.xml', rssXml);
      
      console.log(`✅ RSS feed generated from database with ${groups.length} groups`);
      
      return {
        success: true,
        groupCount: groups.length,
        feedPath: './rss/feed.xml'
      };
    } catch (error) {
      console.error('❌ Error generating RSS feed from database:', error);
      throw error;
    }
  }

  /**
   * Add a message group to the RSS feed
   */
  async addGroupToFeed(group, css, js) {
    let description = '';
    let mediaCount = 0;
    let linkCount = 0;
    
    // Add CSS and JS
    description += css;
    description += js;
    
    // Start message container
    description += '<div class="message-container">';
    description += `<div class="message-header">
      <div class="author-name">${group.author.name || group.author.whatsapp_id}</div>
      <div class="message-time">${new Date(group.start_timestamp * 1000).toLocaleString()}</div>
    </div>`;
    description += '<div class="message-content">';

    // Process each message in the group
    for (const message of group.messages) {
      if (message.type === 'chat' && message.body) {
        // Text message
        const formattedBody = this.formatMessageForRSS(message.body);
        description += `<div class="text-message">${formattedBody}</div>`;
        linkCount += message.url_count || 0;
      } else if (message.has_media && message.media) {
        // Media message
        mediaCount++;
        const mediaHTML = this.generateMediaHTMLFromDB(message.media, message.body);
        description += mediaHTML;
      }
    }

    // Close message content
    description += '</div>';
    
    // Add statistics
    const stats = [];
    if (group.message_count > 1) {
      stats.push(`${group.message_count} messages`);
    }
    if (group.media_count > 0) {
      const mediaTypes = Object.entries(group.media_types || {})
        .map(([type, count]) => `${count} ${type}`)
        .join(', ');
      stats.push(`${group.media_count} media files (${mediaTypes})`);
    }
    if (group.url_count > 0) {
      stats.push(`🔗 ${group.url_count} link${group.url_count > 1 ? 's' : ''}`);
    }
    if (group.emoji_count > 0) {
      stats.push(`😊 ${group.emoji_count} emoji${group.emoji_count > 1 ? 's' : ''}`);
    }

    if (stats.length > 0) {
      description += `<div class="message-stats">${stats.join(' • ')}</div>`;
    }
    
    // Add sentiment indicator if available
    if (group.dominant_sentiment && group.dominant_sentiment !== 'neutral') {
      const sentimentEmoji = group.dominant_sentiment === 'positive' ? '😊' : '😔';
      description += `<div class="sentiment-indicator">Sentiment: ${sentimentEmoji} ${group.dominant_sentiment}</div>`;
    }
    
    // Close message container
    description += '</div>';

    // Create RSS item
    const rssItem = {
      title: `Messages from ${group.author.name || group.author.whatsapp_id}`,
      description: description,
      url: `http://localhost:${config.server.port}/message-group/${group.id}`,
      date: new Date(group.start_timestamp * 1000),
      guid: `group-${group.id}`,
      categories: ['whatsapp', ...group.languages || []],
      custom_elements: [
        { 'content:encoded': `<![CDATA[${description}]]>` },
        { 'dc:creator': group.author.name || group.author.whatsapp_id }
      ]
    };

    // Add media enclosure if available
    if (group.messages.length > 0 && group.messages[0].media) {
      const firstMedia = group.messages[0].media;
      rssItem.enclosure = {
        url: `http://localhost:${config.server.port}/media/${path.basename(firstMedia.filepath)}`,
        type: firstMedia.mimetype,
        length: firstMedia.filesize || 0
      };
    }

    this.rssFeed.item(rssItem);
  }

  /**
   * Generate media HTML from database media object
   */
  generateMediaHTMLFromDB(media, caption) {
    const mediaUrl = `http://localhost:${config.server.port}/media/${path.basename(media.filepath)}`;
    const formattedCaption = caption ? this.formatMessageForRSS(caption) : '';
    
    switch (media.media_type) {
      case 'image':
        return `
          <div class="media-container image-container">
            <img src="${mediaUrl}" alt="Shared image" class="media-image" loading="lazy" onclick="openImageModal(this)"
              ${media.width ? `width="${media.width}"` : ''}
              ${media.height ? `height="${media.height}"` : ''}>
            ${formattedCaption ? `<div class="media-caption">${formattedCaption}</div>` : ''}
            <div class="media-info">${media.filesize_human} • ${media.width}x${media.height}</div>
          </div>
        `;
      
      case 'video':
        return `
          <div class="media-container video-container">
            <video controls class="media-video" preload="metadata">
              <source src="${mediaUrl}" type="${media.mimetype}">
              Your browser does not support the video tag.
            </video>
            ${formattedCaption ? `<div class="media-caption">${formattedCaption}</div>` : ''}
            <div class="media-info">${media.filesize_human} • ${media.duration ? `${Math.floor(media.duration / 60)}:${(media.duration % 60).toString().padStart(2, '0')}` : ''}</div>
          </div>
        `;
      
      case 'audio':
        return `
          <div class="media-container audio-container">
            <audio controls class="media-audio">
              <source src="${mediaUrl}" type="${media.mimetype}">
              Your browser does not support the audio tag.
            </audio>
            ${formattedCaption ? `<div class="media-caption">${formattedCaption}</div>` : ''}
            <div class="media-info">${media.filesize_human} • ${media.duration ? `${Math.floor(media.duration / 60)}:${(media.duration % 60).toString().padStart(2, '0')}` : ''}</div>
          </div>
        `;
      
      case 'document':
      case 'pdf':
        const fileName = media.original_filename || path.basename(media.filepath);
        const icon = media.media_type === 'pdf' ? '📄' : '📎';
        return `
          <div class="media-container document-container">
            <div class="document-info">
              <div class="document-icon">${icon}</div>
              <div class="document-details">
                <a href="${mediaUrl}" download="${fileName}" class="document-link">
                  ${fileName}
                </a>
                <div class="document-type">${media.media_type.toUpperCase()} • ${media.filesize_human}</div>
              </div>
            </div>
            ${formattedCaption ? `<div class="media-caption">${formattedCaption}</div>` : ''}
          </div>
        `;
      
      default:
        return `
          <div class="media-container generic-container">
            <div class="generic-media">
              <a href="${mediaUrl}" target="_blank" class="media-link">
                📎 ${media.media_type.toUpperCase()} File
              </a>
              <div class="media-info">${media.filesize_human}</div>
            </div>
            ${formattedCaption ? `<div class="media-caption">${formattedCaption}</div>` : ''}
          </div>
        `;
    }
  }

  /**
   * Legacy method - now saves to database instead
   */
  async updateFeed(messageGroup, messageHistory) {
    try {
      // Save to database
      await this.databaseService.saveMessageGroup(messageGroup);
      
      // Regenerate RSS feed from database
      await this.generateFeedFromDatabase({ limit: 50 });
      
      console.log('✅ RSS feed updated via database');
    } catch (error) {
      console.error('❌ Error updating RSS feed:', error);
    }
  }

  /**
   * Generate enhanced CSS for the RSS feed
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
        
        .message-container {
          background: white;
          margin: 20px 0;
          padding: 20px;
          border-radius: 12px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          border-left: 4px solid #25D366;
        }
        
        .message-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
          padding-bottom: 10px;
          border-bottom: 1px solid #eee;
        }
        
        .author-name {
          font-weight: 600;
          color: #25D366;
          font-size: 16px;
        }
        
        .message-time {
          color: #666;
          font-size: 14px;
        }
        
        .message-content {
          margin: 15px 0;
        }
        
        .text-message {
          margin: 10px 0;
          padding: 12px;
          background: #f0f0f0;
          border-radius: 8px;
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
          transition: transform 0.2s ease;
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
          height: 54px;
        }
        
        .media-caption {
          padding: 12px;
          background: #f8f9fa;
          border-top: 1px solid #eee;
          font-style: italic;
          color: #666;
        }
        
        .media-info {
          padding: 8px 12px;
          background: #f0f0f0;
          font-size: 12px;
          color: #666;
          border-top: 1px solid #eee;
        }
        
        .document-container {
          padding: 15px;
        }
        
        .document-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .document-icon {
          font-size: 24px;
        }
        
        .document-link {
          text-decoration: none;
          color: #007bff;
          font-weight: 500;
        }
        
        .document-link:hover {
          text-decoration: underline;
        }
        
        .document-type {
          font-size: 12px;
          color: #666;
        }
        
        .message-stats {
          margin-top: 15px;
          padding-top: 10px;
          border-top: 1px solid #eee;
          font-size: 12px;
          color: #666;
          display: flex;
          gap: 15px;
        }
        
        .sentiment-indicator {
          margin-top: 10px;
          padding: 8px 12px;
          background: #e8f5e9;
          border-radius: 6px;
          font-size: 13px;
          color: #2e7d32;
          display: inline-block;
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
        
        .link-preview a:hover {
          text-decoration: underline;
        }
        
        /* Mobile responsiveness */
        @media (max-width: 768px) {
          body {
            padding: 10px;
          }
          
          .message-container {
            margin: 10px 0;
            padding: 15px;
          }
          
          .message-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 5px;
          }
          
          .media-video {
            max-height: 250px;
          }
        }
        
        /* Image modal styles */
        .image-modal {
          display: none;
          position: fixed;
          z-index: 1000;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0,0,0,0.9);
          cursor: pointer;
        }
        
        .modal-content {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          max-width: 90%;
          max-height: 90%;
        }
        
        .modal-image {
          width: 100%;
          height: auto;
        }
        
        .close-modal {
          position: absolute;
          top: 15px;
          right: 35px;
          color: #f1f1f1;
          font-size: 40px;
          font-weight: bold;
          cursor: pointer;
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
          
          // Close modal on click
          modal.addEventListener('click', function(e) {
            if (e.target === modal || e.target.className === 'close-modal') {
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
          
          return modal;
        }
        
        // Auto-play videos when they come into view
        function setupVideoAutoplay() {
          const videos = document.querySelectorAll('.media-video');
          const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                entry.target.play().catch(() => {
                  // Auto-play failed, that's okay
                });
              } else {
                entry.target.pause();
              }
            });
          }, { threshold: 0.5 });
          
          videos.forEach(video => observer.observe(video));
        }
        
        // Initialize when DOM is ready
        document.addEventListener('DOMContentLoaded', function() {
          setupVideoAutoplay();
        });
        
        // Lazy loading for images
        function setupLazyLoading() {
          const images = document.querySelectorAll('.media-image[loading="lazy"]');
          const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src || img.src;
                img.classList.remove('lazy');
                imageObserver.unobserve(img);
              }
            });
          });
          
          images.forEach(img => imageObserver.observe(img));
        }
      </script>
    `;
  }

  /**
   * Format message body for RSS feed with enhanced link handling
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
      // Special handling for Google Drive links
      if (url.includes('drive.google.com')) {
        return `<div class="link-preview"><a href="${url}" target="_blank">📁 Google Drive: ${url}</a></div>`;
      }
      // Special handling for YouTube links
      else if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return `<div class="link-preview"><a href="${url}" target="_blank">🎥 YouTube: ${url}</a></div>`;
      }
      // General links
      else {
        return `<div class="link-preview"><a href="${url}" target="_blank">🔗 ${url}</a></div>`;
      }
    });
    
    // Convert newlines to <br> tags
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
  }

  /**
   * Get MIME type for media type
   */
  getMimeType(type) {
    const mimeTypes = {
      'image': 'image/jpeg',
      'video': 'video/mp4', 
      'audio': 'audio/mpeg',
      'ptt': 'audio/ogg',
      'document': 'application/octet-stream'
    };
    return mimeTypes[type] || 'application/octet-stream';
  }

  /**
   * Generate statistics feed
   */
  async generateStatisticsFeed() {
    try {
      const stats = await this.databaseService.getGlobalStatistics();
      
      const statsFeed = new RSS({
        title: 'WhatsApp Monitor Statistics',
        description: 'Global statistics from WhatsApp monitoring',
        feed_url: `http://localhost:${config.server.port}/rss/stats.xml`,
        site_url: `http://localhost:${config.server.port}`,
        generator: 'WhatsApp Monitor RSS Generator'
      });

      // Create statistics item
      let description = '<div class="stats-container">';
      description += '<h2>WhatsApp Monitor Global Statistics</h2>';
      
      // Overall stats
      description += '<div class="stat-section">';
      description += '<h3>Overview</h3>';
      description += `<p>Total Messages: <strong>${stats.totalMessages}</strong></p>`;
      description += `<p>Total Media Files: <strong>${stats.totalMedia}</strong></p>`;
      description += `<p>Total Authors: <strong>${stats.totalAuthors}</strong></p>`;
      description += `<p>Total Message Groups: <strong>${stats.totalGroups}</strong></p>`;
      description += `<p>Total URLs Shared: <strong>${stats.totalUrls}</strong></p>`;
      description += `<p>Total Keywords: <strong>${stats.totalKeywords}</strong></p>`;
      description += '</div>';
      
      // Media breakdown
      if (stats.mediaByType.length > 0) {
        description += '<div class="stat-section">';
        description += '<h3>Media Breakdown</h3>';
        description += '<ul>';
        stats.mediaByType.forEach(item => {
          const sizeGB = (item.dataValues.total_size / (1024 * 1024 * 1024)).toFixed(2);
          description += `<li>${item.media_type}: ${item.dataValues.count} files (${sizeGB} GB)</li>`;
        });
        description += '</ul>';
        description += '</div>';
      }
      
      // Top authors
      if (stats.topAuthors.length > 0) {
        description += '<div class="stat-section">';
        description += '<h3>Top Authors</h3>';
        description += '<ol>';
        stats.topAuthors.forEach(author => {
          description += `<li>${author.name}: ${author.message_count} messages</li>`;
        });
        description += '</ol>';
        description += '</div>';
      }
      
      // Top keywords
      if (stats.topKeywords.length > 0) {
        description += '<div class="stat-section">';
        description += '<h3>Top Keywords</h3>';
        description += '<ul>';
        stats.topKeywords.forEach(keyword => {
          description += `<li>${keyword.word}: ${keyword.frequency} occurrences</li>`;
        });
        description += '</ul>';
        description += '</div>';
      }
      
      // Language distribution
      if (stats.languageDistribution.length > 0) {
        description += '<div class="stat-section">';
        description += '<h3>Language Distribution</h3>';
        description += '<ul>';
        stats.languageDistribution.forEach(lang => {
          description += `<li>${lang.language}: ${lang.dataValues.count} messages</li>`;
        });
        description += '</ul>';
        description += '</div>';
      }
      
      // Sentiment distribution
      if (stats.sentimentDistribution.length > 0) {
        description += '<div class="stat-section">';
        description += '<h3>Sentiment Analysis</h3>';
        description += '<ul>';
        stats.sentimentDistribution.forEach(sentiment => {
          const emoji = sentiment.sentiment === 'positive' ? '😊' : 
                       sentiment.sentiment === 'negative' ? '😔' : '😐';
          description += `<li>${emoji} ${sentiment.sentiment}: ${sentiment.dataValues.count} messages</li>`;
        });
        description += '</ul>';
        description += '</div>';
      }
      
      description += '</div>';

      statsFeed.item({
        title: 'WhatsApp Monitor Statistics',
        description: description,
        url: `http://localhost:${config.server.port}/stats`,
        date: new Date(),
        guid: `stats-${Date.now()}`
      });

      const statsXml = statsFeed.xml({ indent: true });
      fs.writeFileSync('./rss/stats.xml', statsXml);
      
      console.log('✅ Statistics RSS feed generated');
      return true;
    } catch (error) {
      console.error('❌ Error generating statistics feed:', error);
      throw error;
    }
  }

  reset() {
    this.initialize();
  }
}

module.exports = RSSManager;