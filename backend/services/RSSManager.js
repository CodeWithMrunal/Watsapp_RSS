const RSS = require('rss');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const DatabaseService = require('./DatabaseService');

class RSSManager {
  constructor() {
    this.rssFeed = null;
    this.initialize();
  }

  initialize() {
    this.rssFeed = new RSS({
      ...config.rss,
      // Enhanced RSS configuration
      custom_namespaces: {
        'content': 'http://purl.org/rss/1.0/modules/content/',
        'media': 'http://search.yahoo.com/mrss/',
        'dc': 'http://purl.org/dc/elements/1.1/'
      }
    });
    console.log('✅ RSS Feed initialized with enhanced features');
  }

  /**
   * Get media type and generate appropriate HTML
   */
  generateMediaHTML(mediaPath, messageBody, mediaType) {
    if (!mediaPath) return '';

    const mediaUrl = `http://localhost:${config.server.port}/media/${path.basename(mediaPath)}`;
    const caption = messageBody ? this.formatMessageForRSS(messageBody) : '';
    
    switch (mediaType) {
      case 'image':
        return `
          <div class="media-container image-container">
            <img src="${mediaUrl}" alt="Shared image" class="media-image" loading="lazy" onclick="openImageModal(this)">
            ${caption ? `<div class="media-caption">${caption}</div>` : ''}
          </div>
        `;
      
      case 'video':
        return `
          <div class="media-container video-container">
            <video controls class="media-video" preload="metadata">
              <source src="${mediaUrl}" type="video/mp4">
              <source src="${mediaUrl}" type="video/webm">
              <source src="${mediaUrl}" type="video/quicktime">
              Your browser does not support the video tag.
            </video>
            ${caption ? `<div class="media-caption">${caption}</div>` : ''}
          </div>
        `;
      
      case 'audio':
      case 'ptt': // Voice message
        return `
          <div class="media-container audio-container">
            <audio controls class="media-audio">
              <source src="${mediaUrl}" type="audio/mpeg">
              <source src="${mediaUrl}" type="audio/ogg">
              <source src="${mediaUrl}" type="audio/wav">
              Your browser does not support the audio tag.
            </audio>
            ${caption ? `<div class="media-caption">${caption}</div>` : ''}
          </div>
        `;
      
      case 'document':
        const fileName = path.basename(mediaPath);
        return `
          <div class="media-container document-container">
            <div class="document-info">
              <div class="document-icon">📄</div>
              <div class="document-details">
                <a href="${mediaUrl}" download="${fileName}" class="document-link">
                  ${fileName}
                </a>
                <div class="document-type">Document</div>
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
                📎 ${mediaType.toUpperCase()} File
              </a>
            </div>
            ${caption ? `<div class="media-caption">${caption}</div>` : ''}
          </div>
        `;
    }
  }

  /**
   * Generate enhanced CSS for the RSS feed (same as before)
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
   * Generate JavaScript for enhanced functionality (same as before)
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
   * Generate RSS feed from database
   */
  async generateFromDatabase(groupId, options = {}) {
    const {
      limit = 20,
      authorId = null,
      startDate = null,
      endDate = null
    } = options;

    try {
      console.log('🔄 Generating RSS feed from database...');
      
      // Reset the feed
      this.initialize();
      
      // Get message groups from database
      const messageGroups = await DatabaseService.getMessageGroupsForRSS(groupId, {
        limit,
        authorId,
        startDate,
        endDate
      });

      console.log(`📊 Found ${messageGroups.length} message groups in database`);

      // Process each message group
      for (const group of messageGroups) {
        await this.addMessageGroupToFeed(group);
      }

      // Save the feed
      await this.saveFeed();
      
      console.log('✅ RSS feed generated from database successfully');
      return true;
    } catch (error) {
      console.error('❌ Error generating RSS from database:', error);
      throw error;
    }
  }

  /**
   * Add a message group to the RSS feed
   */
  async addMessageGroupToFeed(messageGroup) {
    let description = '';
    let title = `Messages from ${messageGroup.Author?.push_name || messageGroup.author_id}`;
    let mediaCount = 0;
    let linkCount = 0;
    let hasImages = false;
    let hasVideos = false;
    let hasAudio = false;

    // Add CSS and JS to the beginning of description
    description += this.generateEnhancedCSS();
    description += this.generateEnhancedJS();
    
    // Start message container
    description += '<div class="message-container">';
    description += `<div class="message-header">
      <div class="author-name">${messageGroup.Author?.push_name || messageGroup.author_id}</div>
      <div class="message-time">${new Date(messageGroup.start_date).toLocaleString()} - ${new Date(messageGroup.end_date).toLocaleString()}</div>
    </div>`;
    description += '<div class="message-content">';

    // Process each message in the group
    if (messageGroup.messages && messageGroup.messages.length > 0) {
      for (const msg of messageGroup.messages) {
        if (msg.type === 'chat' && msg.body) {
          // Text message
          const formattedBody = this.formatMessageForRSS(msg.body);
          description += `<div class="text-message">${formattedBody}</div>`;
          
          // Count links
          if (msg.Links) {
            linkCount += msg.Links.length;
          }
        } else if (msg.has_media && msg.Media) {
          // Media message with database media info
          mediaCount++;
          const mediaPath = msg.Media.file_path;
          const mediaHTML = this.generateMediaHTML(mediaPath, msg.body || msg.caption, msg.type);
          description += mediaHTML;
          
          // Track media types
          switch (msg.type) {
            case 'image': hasImages = true; break;
            case 'video': hasVideos = true; break;
            case 'audio':
            case 'ptt': hasAudio = true; break;
          }
        } else if (msg.has_media) {
          // Media without file (failed download)
          mediaCount++;
          const mediaType = msg.type.toUpperCase();
          const mediaDescription = msg.body ? this.formatMessageForRSS(msg.body) : 'Media file (failed to download)';
          description += `<div class="media-container generic-container">
            <div class="document-info">
              <div class="document-icon">❌</div>
              <div class="document-details">
                <strong>[${mediaType} - Download Failed]</strong>
                <div class="media-caption">${mediaDescription}</div>
              </div>
            </div>
          </div>`;
        }
      }
    }

    // Close message content and add stats
    description += '</div>';
    
    // Add message statistics from database
    const stats = [];
    if (messageGroup.message_count > 1) {
      stats.push(`${messageGroup.message_count} messages`);
    }
    if (messageGroup.media_count > 0) {
      const mediaTypes = [];
      if (hasImages) mediaTypes.push('📸 images');
      if (hasVideos) mediaTypes.push('🎥 videos');
      if (hasAudio) mediaTypes.push('🎵 audio');
      stats.push(`${messageGroup.media_count} media file${messageGroup.media_count > 1 ? 's' : ''} (${mediaTypes.join(', ')})`);
    }
    if (messageGroup.link_count > 0) {
      stats.push(`🔗 ${messageGroup.link_count} link${messageGroup.link_count > 1 ? 's' : ''}`);
    }
    if (messageGroup.mention_count > 0) {
      stats.push(`👥 ${messageGroup.mention_count} mention${messageGroup.mention_count > 1 ? 's' : ''}`);
    }

    // Add duration info
    const duration = this.formatDuration(messageGroup.duration);
    stats.push(`⏱️ ${duration}`);

    if (stats.length > 0) {
      description += `<div class="message-stats">${stats.join(' • ')}</div>`;
    }
    
    // Close message container
    description += '</div>';

    // Create enhanced RSS item
    const rssItem = {
      title: title,
      description: description,
      url: `http://localhost:${config.server.port}/message-group/${messageGroup.id}`,
      date: new Date(messageGroup.start_date),
      guid: messageGroup.id,
      categories: ['whatsapp', 'message-group'],
      custom_elements: [
        { 'content:encoded': `<![CDATA[${description}]]>` },
        { 'dc:creator': messageGroup.Author?.push_name || messageGroup.author_id }
      ]
    };

    // Add media RSS extensions if there are media files
    if (messageGroup.media_count > 0 && messageGroup.messages) {
      const firstMedia = messageGroup.messages.find(m => m.has_media && m.Media);
      if (firstMedia && firstMedia.Media) {
        rssItem.enclosure = {
          url: `http://localhost:${config.server.port}/media/${path.basename(firstMedia.Media.file_path)}`,
          type: firstMedia.Media.mimetype || this.getMimeType(firstMedia.type),
          length: firstMedia.Media.file_size || 0
        };
      }
    }

    this.rssFeed.item(rssItem);
  }

  /**
   * Format duration helper
   */
  formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  /**
   * Save the feed to file
   */
  async saveFeed() {
    try {
      fs.ensureDirSync('./rss');
      
      // Save RSS feed with proper formatting
      const rssXml = this.rssFeed.xml({ indent: true });
      fs.writeFileSync('./rss/feed.xml', rssXml);
      
      console.log('✅ RSS feed saved to ./rss/feed.xml');
    } catch (error) {
      console.error('❌ Error saving RSS feed:', error);
      throw error;
    }
  }

  /**
   * Legacy method - redirect to database generation
   */
  async updateFeed(messageGroup, messageHistory) {
    console.log('⚠️  updateFeed called - redirecting to database generation');
    
    // For backward compatibility, we'll just trigger a database regeneration
    // You might want to get the group ID from somewhere appropriate
    if (messageGroup.groupId) {
      await this.generateFromDatabase(messageGroup.groupId, { limit: 50 });
    }
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

  reset() {
    this.initialize();
  }
}

module.exports = RSSManager;