const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

class FileUtils {
  static ensureDirectories() {
    Object.values(config.directories).forEach(dir => {
      fs.ensureDirSync(dir);
    });
    console.log('✅ All directories ensured');
  }

  /**
   * Calculate file hash for deduplication
   */
  static calculateFileHash(filePath) {
    try {
      const fileBuffer = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(fileBuffer).digest('hex');
    } catch (error) {
      console.error('Error calculating file hash:', error);
      return null;
    }
  }

  /**
   * Get file metadata
   */
  static getFileMetadata(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return {
        size: stats.size,
        sizeKB: Math.round(stats.size / 1024),
        sizeMB: Math.round(stats.size / (1024 * 1024) * 100) / 100,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime
      };
    } catch (error) {
      console.error('Error getting file metadata:', error);
      return null;
    }
  }

  /**
   * Extract media dimensions (for images/videos)
   * Note: This is a placeholder - you'd need libraries like sharp or ffprobe for actual implementation
   */
  static getMediaDimensions(filePath, mediaType) {
    // This would require additional libraries:
    // - For images: sharp, jimp, or image-size
    // - For videos: fluent-ffmpeg or ffprobe
    // Returning placeholder data for now
    return {
      width: null,
      height: null,
      duration: null, // For video/audio
      codec: null,
      format: null
    };
  }

  /**
   * Enhanced media saving with metadata extraction
   */
  static saveMedia(mediaData, messageId, messageMetadata = {}) {
    try {
      const ext = mediaData.mimetype.split('/')[1] || 'bin';
      const timestamp = Date.now();
      const filename = `media_${timestamp}_${messageId}.${ext}`;
      const mediaPath = path.join('media', filename);
      const fullPath = path.join(__dirname, '..', mediaPath);

      // Save the file
      fs.writeFileSync(fullPath, mediaData.data, { encoding: 'base64' });
      console.log(`✅ Media saved to: ${mediaPath}`);
      
      // Extract enhanced metadata
      const fileHash = this.calculateFileHash(fullPath);
      const fileMetadata = this.getFileMetadata(fullPath);
      const mediaDimensions = this.getMediaDimensions(fullPath, mediaData.mimetype.split('/')[0]);
      
      // Create rich media metadata
      const mediaMetadata = {
        // File identifiers
        id: `${messageId}_${timestamp}`,
        messageId: messageId,
        filename: filename,
        originalFilename: mediaData.filename || filename,
        path: mediaPath,
        fullPath: fullPath,
        
        // File properties
        mimetype: mediaData.mimetype,
        mediaType: mediaData.mimetype.split('/')[0],
        extension: ext,
        fileHash: fileHash,
        
        // Size information
        fileSize: fileMetadata ? fileMetadata.size : null,
        fileSizeKB: fileMetadata ? fileMetadata.sizeKB : null,
        fileSizeMB: fileMetadata ? fileMetadata.sizeMB : null,
        
        // Media properties
        dimensions: mediaDimensions,
        
        // Message context
        author: messageMetadata.author || null,
        groupId: messageMetadata.groupId || null,
        caption: messageMetadata.caption || '',
        
        // Timestamps
        messageTimestamp: messageMetadata.timestamp || null,
        savedAt: new Date().toISOString(),
        fileCreated: fileMetadata ? fileMetadata.created : null,
        fileModified: fileMetadata ? fileMetadata.modified : null,
        
        // Processing status
        processed: true,
        thumbnailGenerated: false,
        thumbnailPath: null,
        
        // Additional metadata
        isViewOnce: messageMetadata.isViewOnce || false,
        isForwarded: messageMetadata.isForwarded || false,
        forwardingScore: messageMetadata.forwardingScore || 0,
        
        // Version for future migrations
        version: '2.0'
      };
      
      return {
        path: mediaPath,
        metadata: mediaMetadata
      };
    } catch (error) {
      console.error('❌ Error saving media:', error);
      return null;
    }
  }

  static saveJSON(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error(`❌ Error saving JSON to ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Enhanced message grouping with richer metadata
   */
  static groupMessagesByTimestamp(messages) {
    // Sort messages by timestamp
    const sortedMessages = messages.sort((a, b) => a.timestamp - b.timestamp);
    
    const groupedMessages = [];
    let currentGroup = null;
    
    for (const msg of sortedMessages) {
      // Extract group ID from the message ID (before @g.us)
      const groupId = msg.id.split('@g.us')[0];
      
      // Check if we should start a new group
      const shouldStartNewGroup = !currentGroup || 
        currentGroup.author !== msg.author ||
        currentGroup.groupId !== groupId ||
        (msg.timestamp - currentGroup.startTimestamp) > 300; // 5 minutes = 300 seconds
      
      if (shouldStartNewGroup) {
        // Create a new group with enhanced metadata
        currentGroup = {
          // Identifiers
          id: `${groupId}_${msg.author}_${msg.timestamp}`,
          groupId: groupId,
          author: msg.author,
          authorNumber: msg.author ? msg.author.split('@')[0] : null,
          
          // Timestamps
          startTimestamp: msg.timestamp,
          endTimestamp: msg.timestamp,
          startTime: new Date(msg.timestamp * 1000).toISOString(),
          endTime: new Date(msg.timestamp * 1000).toISOString(),
          
          // Collections
          messages: [],
          media: [],
          texts: [],
          links: [],
          mentions: [],
          
          // Statistics
          statistics: {
            totalMessages: 0,
            textMessages: 0,
            mediaMessages: 0,
            linkCount: 0,
            mentionCount: 0,
            mediaTypes: {
              image: 0,
              video: 0,
              audio: 0,
              document: 0,
              sticker: 0,
              voice: 0
            }
          }
        };
        groupedMessages.push(currentGroup);
      }
      
      // Update the end timestamp
      currentGroup.endTimestamp = msg.timestamp;
      currentGroup.endTime = new Date(msg.timestamp * 1000).toISOString();
      
      // Enhanced message data
      const enhancedMessage = {
        id: msg.id,
        timestamp: msg.timestamp,
        time: new Date(msg.timestamp * 1000).toISOString(),
        type: msg.type,
        caption: msg.caption || msg.body || '',
        mediaPath: msg.mediaPath,
        hasMedia: msg.hasMedia,
        author: msg.author
      };
      
      // Add message to the current group
      currentGroup.messages.push(enhancedMessage);
      currentGroup.statistics.totalMessages++;
      
      // Extract and aggregate links
      if (msg.body) {
        const linkRegex = /(https?:\/\/[^\s]+)/g;
        const links = msg.body.match(linkRegex) || [];
        links.forEach(link => {
          currentGroup.links.push({
            url: link,
            messageId: msg.id,
            timestamp: msg.timestamp
          });
        });
        currentGroup.statistics.linkCount += links.length;
      }
      
      // Extract mentions
      if (msg.body) {
        const mentionRegex = /@(\d{12})/g;
        let match;
        while ((match = mentionRegex.exec(msg.body)) !== null) {
          currentGroup.mentions.push({
            phoneNumber: match[1],
            messageId: msg.id,
            timestamp: msg.timestamp
          });
          currentGroup.statistics.mentionCount++;
        }
      }
      
      // Organize by type
      if (msg.hasMedia && msg.mediaPath) {
        currentGroup.media.push({
          type: msg.type,
          mediaPath: msg.mediaPath,
          caption: msg.caption || msg.body || '',
          timestamp: msg.timestamp,
          messageId: msg.id,
          fileSize: msg.fileSize || null,
          mimeType: msg.mimeType || null
        });
        currentGroup.statistics.mediaMessages++;
        
        // Count media types
        const mediaType = msg.type;
        if (mediaType === 'ptt') {
          currentGroup.statistics.mediaTypes.voice++;
        } else if (currentGroup.statistics.mediaTypes.hasOwnProperty(mediaType)) {
          currentGroup.statistics.mediaTypes[mediaType]++;
        }
      } else if (msg.body && !msg.hasMedia) {
        currentGroup.texts.push({
          text: msg.body,
          timestamp: msg.timestamp,
          messageId: msg.id,
          wordCount: msg.body.split(/\s+/).filter(w => w.length > 0).length
        });
        currentGroup.statistics.textMessages++;
      }
    }
    
    // Final processing for each group
    return groupedMessages.map(group => ({
      // Core identifiers
      id: group.id,
      groupId: group.groupId,
      author: group.author,
      authorNumber: group.authorNumber,
      
      // Time information
      startTimestamp: group.startTimestamp,
      endTimestamp: group.endTimestamp,
      startTime: group.startTime,
      endTime: group.endTime,
      duration: group.endTimestamp - group.startTimestamp,
      durationMinutes: Math.round((group.endTimestamp - group.startTimestamp) / 60),
      
      // Statistics
      messageCount: group.statistics.totalMessages,
      statistics: group.statistics,
      
      // Aggregated data
      media: group.media,
      texts: group.texts,
      links: group.links,
      mentions: group.mentions,
      allMessages: group.messages,
      
      // Analysis
      averageMessageInterval: group.messages.length > 1 
        ? Math.round((group.endTimestamp - group.startTimestamp) / (group.messages.length - 1))
        : 0,
      
      // Metadata
      createdAt: new Date().toISOString(),
      version: '2.0'
    }));
  }

  /**
   * Enhanced media index update with richer metadata
   */
  static updateMediaIndex(messageHistory, additionalMetadata = {}) {
    // Filter messages with enhanced metadata extraction
    const relevantMessages = messageHistory
      .filter(msg => msg.hasMedia || (msg.body && msg.body.trim() !== ''))
      .map(msg => ({
        // Core identifiers
        id: msg.id,
        messageId: msg.id,
        groupId: msg.groupId || msg.id.split('@g.us')[0],
        
        // Author information
        author: msg.author,
        authorNumber: msg.author ? msg.author.split('@')[0] : null,
        
        // Timestamps
        timestamp: msg.timestamp,
        createdAt: new Date(msg.timestamp * 1000).toISOString(),
        
        // Content
        caption: msg.body || '',
        type: msg.type || 'text',
        mediaPath: msg.mediaPath || null,
        hasMedia: msg.hasMedia || false,
        body: msg.body || '',
        
        // Media metadata
        mediaMetadata: msg.mediaMetadata || null,
        fileSize: msg.fileSize || null,
        mimeType: msg.mimeType || null,
        
        // Message metadata
        isForwarded: msg.isForwarded || false,
        forwardingScore: msg.forwardingScore || 0,
        isViewOnce: msg.isViewOnce || false,
        
        // Links and mentions
        linkCount: msg.linkCount || 0,
        mentionCount: msg.mentionCount || 0
      }));

    if (relevantMessages.length === 0) return;

    // Group messages with enhanced metadata
    const groupedMessages = this.groupMessagesByTimestamp(relevantMessages);
    
    // Create comprehensive media index
    const mediaIndex = {
      metadata: {
        totalGroups: groupedMessages.length,
        totalMessages: relevantMessages.length,
        totalMedia: relevantMessages.filter(m => m.hasMedia).length,
        generatedAt: new Date().toISOString(),
        version: '2.0',
        ...additionalMetadata
      },
      groups: groupedMessages,
      // Additional indices for quick lookups
      mediaByType: this.groupMediaByType(relevantMessages),
      messagesByAuthor: this.groupMessagesByAuthor(relevantMessages),
      timeline: this.createTimeline(relevantMessages)
    };

    const success = this.saveJSON('./media/media.json', mediaIndex);
    if (success) {
      console.log(`📦 Enhanced media.json updated:`);
      console.log(`   📊 Total groups: ${mediaIndex.metadata.totalGroups}`);
      console.log(`   📬 Total messages: ${mediaIndex.metadata.totalMessages}`);
      console.log(`   🎬 Total media: ${mediaIndex.metadata.totalMedia}`);
    }
  }

  /**
   * Group media by type for quick filtering
   */
  static groupMediaByType(messages) {
    const mediaMessages = messages.filter(m => m.hasMedia);
    const grouped = {};
    
    mediaMessages.forEach(msg => {
      const type = msg.type;
      if (!grouped[type]) {
        grouped[type] = {
          count: 0,
          totalSize: 0,
          messages: []
        };
      }
      
      grouped[type].count++;
      grouped[type].totalSize += msg.fileSize || 0;
      grouped[type].messages.push({
        id: msg.id,
        author: msg.author,
        timestamp: msg.timestamp,
        mediaPath: msg.mediaPath,
        fileSize: msg.fileSize
      });
    });
    
    return grouped;
  }

  /**
   * Group messages by author for analytics
   */
  static groupMessagesByAuthor(messages) {
    const grouped = {};
    
    messages.forEach(msg => {
      const author = msg.author;
      if (!grouped[author]) {
        grouped[author] = {
          totalMessages: 0,
          textMessages: 0,
          mediaMessages: 0,
          firstMessage: msg.timestamp,
          lastMessage: msg.timestamp,
          messages: []
        };
      }
      
      grouped[author].totalMessages++;
      if (msg.hasMedia) {
        grouped[author].mediaMessages++;
      } else {
        grouped[author].textMessages++;
      }
      
      // Update time range
      if (msg.timestamp < grouped[author].firstMessage) {
        grouped[author].firstMessage = msg.timestamp;
      }
      if (msg.timestamp > grouped[author].lastMessage) {
        grouped[author].lastMessage = msg.timestamp;
      }
      
      grouped[author].messages.push(msg.id);
    });
    
    // Calculate additional metrics
    Object.keys(grouped).forEach(author => {
      const data = grouped[author];
      data.averageMessagesPerDay = data.totalMessages / 
        Math.max(1, (data.lastMessage - data.firstMessage) / 86400);
      data.mediaPercentage = (data.mediaMessages / data.totalMessages * 100).toFixed(2);
    });
    
    return grouped;
  }

  /**
   * Create a timeline for visualization
   */
  static createTimeline(messages) {
    const timeline = {};
    
    messages.forEach(msg => {
      const date = new Date(msg.timestamp * 1000);
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
      const hourKey = date.getHours();
      
      if (!timeline[dateKey]) {
        timeline[dateKey] = {
          date: dateKey,
          totalMessages: 0,
          textMessages: 0,
          mediaMessages: 0,
          authors: new Set(),
          hourlyDistribution: Array(24).fill(0),
          mediaTypes: {}
        };
      }
      
      timeline[dateKey].totalMessages++;
      timeline[dateKey].authors.add(msg.author);
      timeline[dateKey].hourlyDistribution[hourKey]++;
      
      if (msg.hasMedia) {
        timeline[dateKey].mediaMessages++;
        const mediaType = msg.type;
        timeline[dateKey].mediaTypes[mediaType] = (timeline[dateKey].mediaTypes[mediaType] || 0) + 1;
      } else {
        timeline[dateKey].textMessages++;
      }
    });
    
    // Convert sets to counts
    Object.keys(timeline).forEach(date => {
      timeline[date].uniqueAuthors = timeline[date].authors.size;
      delete timeline[date].authors; // Remove the Set object
    });
    
    return timeline;
  }
}

module.exports = FileUtils;