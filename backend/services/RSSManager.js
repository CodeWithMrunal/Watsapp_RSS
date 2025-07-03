// services/RSSManager.js - Enhanced database-driven RSS manager
const RSS = require('rss');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

class RSSManager {
  constructor(databaseService) {
    this.db = databaseService;
    this.rssFeed = null;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
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
    console.log('✅ RSS Manager initialized with database support');
  }

  /**
   * Store message in database and update RSS feed
   */
  async updateFeed(messageGroup, selectedGroupId = null) {
    try {
      // Store message group in database
      await this.storeMessageGroup(messageGroup);
      
      // Generate RSS feed from database
      await this.generateRSSFromDatabase(selectedGroupId);
      
      console.log(`✅ RSS feed updated with message group: ${messageGroup.id}`);
    } catch (error) {
      console.error('❌ Error updating RSS feed:', error);
      throw error;
    }
  }

  /**
   * Store individual message in database
   */
  async storeMessage(messageData, groupId) {
    try {
      // First, ensure user exists
      if (messageData.author && messageData.userId) {
        await this.upsertUser(messageData.userId, {
          name: messageData.author,
          pushName: messageData.author
        });
      }

      // Store the message
      const messageRecord = {
        id: messageData.id,
        group_id: groupId,
        user_id: messageData.userId || null,
        message_type: messageData.type || 'chat',
        body: messageData.body || null,
        caption: messageData.caption || null,
        timestamp: messageData.timestamp,
        has_media: messageData.hasMedia || false,
        media_path: messageData.mediaPath || null,
        media_type: messageData.mediaType || null,
        media_size: messageData.mediaSize || null,
        media_mimetype: messageData.mediaMimetype || null,
        is_forwarded: messageData.isForwarded || false,
        reply_to_message_id: messageData.replyTo || null
      };

      // Check if message already exists
      const existingMessage = await this.db.findById('messages', messageData.id);
      
      if (existingMessage) {
        await this.db.update('messages', messageData.id, messageRecord);
        console.log(`📝 Updated message: ${messageData.id}`);
      } else {
        await this.db.create('messages', messageRecord);
        console.log(`💾 Stored new message: ${messageData.id}`);
      }

      return messageRecord;
    } catch (error) {
      console.error('❌ Error storing message:', error);
      throw error;
    }
  }

  /**
   * Store message group for RSS generation
   */
async storeMessageGroup(messageGroup) {
  try {
    // FIRST: Ensure the group exists in the groups table
    const groupId = messageGroup.groupId || messageGroup.id;
    await this.ensureGroupExists(groupId, messageGroup);

    // SECOND: Store individual messages (now that group exists)
    for (const message of messageGroup.messages) {
      await this.storeMessage(message, groupId);
    }

    // THIRD: Create/update message group record
    const groupRecord = {
      id: messageGroup.id,
      group_id: groupId,
      author_id: messageGroup.userId || null,
      author_name: messageGroup.author || 'Unknown',
      message_count: messageGroup.messages.length,
      first_message_id: messageGroup.messages[0]?.id || null,
      last_message_id: messageGroup.messages[messageGroup.messages.length - 1]?.id || null,
      timestamp: messageGroup.timestamp
    };

    // Check if group already exists
    const existingGroup = await this.db.findById('message_groups', messageGroup.id);
    
    if (existingGroup) {
      await this.db.update('message_groups', messageGroup.id, groupRecord);
    } else {
      await this.db.create('message_groups', groupRecord);
    }

    return groupRecord;
  } catch (error) {
    console.error('❌ Error storing message group:', error);
    throw error;
  }
}

async ensureGroupExists(groupId, messageGroup) {
  try {
    // Check if group already exists
    const existingGroup = await this.db.findById('groups', groupId);
    
    if (!existingGroup) {
      // Create basic group record
      const groupRecord = {
        id: groupId,
        name: messageGroup.groupName || messageGroup.author || 'Unknown Group',
        description: null,
        participant_count: 0,
        is_archived: false,
        is_muted: false
      };

      await this.db.create('groups', groupRecord);
      console.log(`📁 Created group record: ${groupId}`);
    }
  } catch (error) {
    console.error('❌ Error ensuring group exists:', error);
    throw error;
  }
}
  /**
   * Generate RSS feed from database
   */
  async generateRSSFromDatabase(selectedGroupId = null, limit = 50) {
    try {
      // Reset RSS feed
      this.initialize();

      // Get message groups from database with messages
      const messageGroups = await this.getMessageGroupsWithMessages(selectedGroupId, limit);

      // Generate RSS items
      for (const group of messageGroups) {
        await this.addRSSItem(group);
      }

      // Save to file system
      await this.saveRSSToFile();

      console.log(`✅ Generated RSS feed with ${messageGroups.length} message groups`);
      return messageGroups.length;
    } catch (error) {
      console.error('❌ Error generating RSS from database:', error);
      throw error;
    }
  }

  /**
   * Get message groups with their messages from database
   */
  async getMessageGroupsWithMessages(selectedGroupId = null, limit = 50) {
    try {
      let conditions = {};
      if (selectedGroupId) {
        conditions.group_id = selectedGroupId;
      }

      const options = {
        orderBy: 'timestamp DESC',
        limit: limit
      };

      // Get message groups
      const messageGroups = await this.db.findMany('message_groups', conditions, options);

      // Enrich with actual messages
      for (const group of messageGroups) {
        group.messages = await this.getMessagesForGroup(group.id);
      }

      return messageGroups;
    } catch (error) {
      console.error('❌ Error getting message groups:', error);
      throw error;
    }
  }

  /**
   * Get messages for a specific message group
   */
  async getMessagesForGroup(messageGroupId) {
    try {
      // Get the message group to find the message IDs
      const group = await this.db.findById('message_groups', messageGroupId);
      if (!group) return [];

      // Get messages between first and last message timestamps
      const conditions = {
        group_id: group.group_id,
        timestamp: group.timestamp // For simplicity, getting messages around this timestamp
      };

      // This is a simplified approach - you might want to store message IDs in the group
      // or use a more sophisticated query to get the exact messages
      const messages = await this.db.findMany('messages', 
        { group_id: group.group_id }, 
        { 
          orderBy: 'timestamp DESC',
          limit: 10 // Limit messages per group
        }
      );

      return messages.filter(msg => 
        Math.abs(msg.timestamp - group.timestamp) < 300000 // Within 5 minutes
      );
    } catch (error) {
      console.error('❌ Error getting messages for group:', error);
      return [];
    }
  }

  /**
   * Add RSS item from message group
   */
  async addRSSItem(messageGroup) {
    try {
      let description = '';
      let title = `Messages from ${messageGroup.author_name}`;
      let mediaCount = 0;
      let linkCount = 0;

      // Add CSS and JS
      description += this.generateEnhancedCSS();
      description += this.generateEnhancedJS();
      
      // Start message container
      description += '<div class="message-container">';
      description += `<div class="message-header">
        <div class="author-name">${messageGroup.author_name}</div>
        <div class="message-time">${new Date(messageGroup.timestamp * 1000).toLocaleString()}</div>
      </div>`;
      description += '<div class="message-content">';

      // Process each message
      for (const message of messageGroup.messages) {
        if (message.message_type === 'chat' && message.body) {
          const formattedBody = this.formatMessageForRSS(message.body);
          description += `<div class="text-message">${formattedBody}</div>`;
          
          const links = message.body.match(/https?:\/\/[^\s]+/g) || [];
          linkCount += links.length;
        } else if (message.has_media && message.media_path) {
          mediaCount++;
          const mediaHTML = this.generateMediaHTML(
            message.media_path, 
            message.body || message.caption, 
            message.media_type
          );
          description += mediaHTML;
        }
      }

      // Close content and add stats
      description += '</div>';
      
      // Add statistics
      const stats = [];
      if (messageGroup.message_count > 1) {
        stats.push(`${messageGroup.message_count} messages`);
      }
      if (mediaCount > 0) {
        stats.push(`${mediaCount} media file${mediaCount > 1 ? 's' : ''}`);
      }
      if (linkCount > 0) {
        stats.push(`🔗 ${linkCount} link${linkCount > 1 ? 's' : ''}`);
      }

      if (stats.length > 0) {
        description += `<div class="message-stats">${stats.join(' • ')}</div>`;
      }
      
      description += '</div>';

      // Create RSS item
      const rssItem = {
        title: title,
        description: description,
        url: `http://localhost:${config.server.port}/message/${messageGroup.id}`,
        date: new Date(messageGroup.timestamp * 1000),
        guid: messageGroup.id,
        categories: ['whatsapp', 'messages'],
        custom_elements: [
          { 'content:encoded': `<![CDATA[${description}]]>` },
          { 'dc:creator': messageGroup.author_name }
        ]
      };

      this.rssFeed.item(rssItem);
    } catch (error) {
      console.error('❌ Error adding RSS item:', error);
    }
  }

  /**
   * Save RSS feed to file system
   */
  async saveRSSToFile() {
    try {
      await fs.ensureDir('./rss');
      
      // Generate RSS XML
      const rssXml = this.rssFeed.xml({ indent: true });
      await fs.writeFile('./rss/feed.xml', rssXml);
      
      // Also save a JSON version for easier API access
      const messageGroups = await this.getMessageGroupsWithMessages(null, 100);
      await fs.writeFile('./rss/messages.json', JSON.stringify(messageGroups, null, 2));
      
      console.log('💾 RSS feed saved to file system');
    } catch (error) {
      console.error('❌ Error saving RSS feed:', error);
      throw error;
    }
  }

  /**
   * Get RSS feed data for API endpoints
   */
  async getRSSFeedData(selectedGroupId = null, limit = 50) {
    const cacheKey = `rss_${selectedGroupId || 'all'}_${limit}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
    }

    try {
      const messageGroups = await this.getMessageGroupsWithMessages(selectedGroupId, limit);
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: messageGroups,
        timestamp: Date.now()
      });
      
      return messageGroups;
    } catch (error) {
      console.error('❌ Error getting RSS feed data:', error);
      throw error;
    }
  }

  /**
   * Store group information
   */
  async storeGroup(groupData) {
    try {
      const groupRecord = {
        id: groupData.id,
        name: groupData.name || 'Unknown Group',
        description: groupData.description || null,
        participant_count: groupData.participantCount || 0,
        is_archived: groupData.isArchived || false,
        is_muted: groupData.isMuted || false
      };

      const existingGroup = await this.db.findById('groups', groupData.id);
      
      if (existingGroup) {
        await this.db.update('groups', groupData.id, groupRecord);
      } else {
        await this.db.create('groups', groupRecord);
      }

      return groupRecord;
    } catch (error) {
      console.error('❌ Error storing group:', error);
      throw error;
    }
  }

  /**
   * Store user information
   */
  async upsertUser(userId, userData) {
    try {
      const userRecord = {
        id: userId,
        name: userData.name || null,
        push_name: userData.pushName || userData.name || null,
        phone_number: userData.phoneNumber || null,
        profile_pic_url: userData.profilePicUrl || null
      };

      const existingUser = await this.db.findById('users', userId);
      
      if (existingUser) {
        await this.db.update('users', userId, userRecord);
      } else {
        await this.db.create('users', userRecord);
      }

      return userRecord;
    } catch (error) {
      console.error('❌ Error storing user:', error);
      throw error;
    }
  }

  /**
   * Store group membership
   */
  async storeGroupMembership(groupId, userId, isAdmin = false) {
    try {
      const membershipRecord = {
        group_id: groupId,
        user_id: userId,
        is_admin: isAdmin
      };

      // For PostgreSQL, we need to handle the composite primary key
      if (this.db.dbType === 'postgresql') {
        const existing = await this.db.query(
          'SELECT * FROM group_memberships WHERE group_id = $1 AND user_id = $2',
          [groupId, userId]
        );

        if (existing.length === 0) {
          await this.db.create('group_memberships', membershipRecord);
        }
      } else {
        // For MongoDB, use upsert
        await this.db.db.collection('groupMemberships').updateOne(
          { groupId, userId },
          { $set: { ...membershipRecord, updatedAt: new Date() } },
          { upsert: true }
        );
      }

      return membershipRecord;
    } catch (error) {
      console.error('❌ Error storing group membership:', error);
      throw error;
    }
  }

  /**
   * Get message statistics
   */
  async getMessageStats(groupId = null, timeRange = '24h') {
    try {
      const timeRanges = {
        '1h': 3600000,
        '24h': 86400000,
        '7d': 604800000,
        '30d': 2592000000
      };

      const timeLimit = Date.now() - (timeRanges[timeRange] || timeRanges['24h']);
      
      let conditions = {
        timestamp: { $gte: timeLimit }
      };

      if (groupId) {
        conditions.group_id = groupId;
      }

      if (this.db.dbType === 'postgresql') {
        const query = `
          SELECT 
            COUNT(*) as total_messages,
            COUNT(CASE WHEN has_media THEN 1 END) as media_messages,
            COUNT(DISTINCT user_id) as unique_users,
            media_type,
            COUNT(*) as type_count
          FROM messages 
          WHERE timestamp >= $1 ${groupId ? 'AND group_id = $2' : ''}
          GROUP BY media_type
        `;
        
        const params = groupId ? [timeLimit, groupId] : [timeLimit];
        const result = await this.db.query(query, params);
        
        return this.formatStatsResult(result);
      } else {
        // MongoDB aggregation
        const pipeline = [
          { $match: conditions },
          {
            $group: {
              _id: null,
              totalMessages: { $sum: 1 },
              mediaMessages: { $sum: { $cond: ['$hasMedia', 1, 0] } },
              uniqueUsers: { $addToSet: '$userId' }
            }
          }
        ];

        const result = await this.db.aggregate('messages', pipeline);
        return result[0] || { totalMessages: 0, mediaMessages: 0, uniqueUsers: [] };
      }
    } catch (error) {
      console.error('❌ Error getting message stats:', error);
      return { totalMessages: 0, mediaMessages: 0, uniqueUsers: [] };
    }
  }

  /**
   * Clean up old messages (optional)
   */
  async cleanupOldMessages(retentionDays = 30) {
    try {
      const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      
      if (this.db.dbType === 'postgresql') {
        const result = await this.db.query(
          'DELETE FROM messages WHERE timestamp < $1',
          [cutoffTime]
        );
        console.log(`🧹 Cleaned up ${result.rowCount} old messages`);
      } else {
        const result = await this.db.db.collection('messages').deleteMany({
          timestamp: { $lt: cutoffTime }
        });
        console.log(`🧹 Cleaned up ${result.deletedCount} old messages`);
      }
    } catch (error) {
      console.error('❌ Error cleaning up old messages:', error);
    }
  }

  /**
   * Search messages
   */
  async searchMessages(query, groupId = null, limit = 50) {
    try {
      if (this.db.dbType === 'postgresql') {
        let sql = `
          SELECT m.*, u.name as author_name 
          FROM messages m 
          LEFT JOIN users u ON m.user_id = u.id 
          WHERE (m.body ILIKE $1 OR m.caption ILIKE $1)
        `;
        
        const params = [`%${query}%`];
        
        if (groupId) {
          sql += ' AND m.group_id = $2';
          params.push(groupId);
        }
        
        sql += ' ORDER BY m.timestamp DESC LIMIT  + (params.length + 1)';
        params.push(limit);
        
        return await this.db.query(sql, params);
      } else {
        const conditions = {
          $or: [
            { body: { $regex: query, $options: 'i' } },
            { caption: { $regex: query, $options: 'i' } }
          ]
        };
        
        if (groupId) {
          conditions.groupId = groupId;
        }
        
        return await this.db.findMany('messages', conditions, {
          sort: { timestamp: -1 },
          limit
        });
      }
    } catch (error) {
      console.error('❌ Error searching messages:', error);
      return [];
    }
  }

  // Keep all the existing utility methods
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
      case 'ptt':
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
      </style>
    `;
  }

  generateEnhancedJS() {
    return `
      <script type="text/javascript">
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
        
        document.addEventListener('DOMContentLoaded', function() {
          const videos = document.querySelectorAll('.media-video');
          const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                entry.target.play().catch(() => {});
              } else {
                entry.target.pause();
              }
            });
          }, { threshold: 0.5 });
          
          videos.forEach(video => observer.observe(video));
        });
      </script>
    `;
  }

  formatMessageForRSS(body) {
    if (!body) return '';
    
    let formatted = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    
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
    
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
  }

  formatStatsResult(result) {
    return {
      totalMessages: result[0]?.total_messages || 0,
      mediaMessages: result[0]?.media_messages || 0,
      uniqueUsers: result[0]?.unique_users || 0,
      mediaTypes: result.filter(r => r.media_type).reduce((acc, r) => {
        acc[r.media_type] = r.type_count;
        return acc;
      }, {})
    };
  }

  async reset() {
    this.initialize();
    this.cache.clear();
  }
}

module.exports = RSSManager;