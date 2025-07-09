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
  static calculateFileHash(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Get file size in bytes
   */
  static getFileSize(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return stats.size;
    } catch (error) {
      console.error('Error getting file size:', error);
      return 0;
    }
  }

  /**
   * Extract media metadata based on type
   */
  static extractMediaMetadata(mediaData, messageData) {
    const metadata = {
      dimensions: null,
      duration: null,
      thumbnail: null,
      fileFormat: null,
      compressionInfo: null
    };

    // Extract file format from mimetype
    if (mediaData.mimetype) {
      metadata.fileFormat = {
        mimetype: mediaData.mimetype,
        extension: mediaData.mimetype.split('/')[1] || 'unknown'
      };
    }

    // For images, we could extract dimensions (would need additional libraries like sharp)
    if (messageData.type === 'image') {
      // Placeholder for image dimensions
      metadata.dimensions = {
        width: null,
        height: null,
        aspectRatio: null
      };
    }

    // For videos, we could extract duration and thumbnail (would need ffmpeg)
    if (messageData.type === 'video') {
      metadata.duration = null; // Would need ffprobe
      metadata.thumbnail = null; // Would need ffmpeg
    }

    // For audio/voice notes
    if (messageData.type === 'audio' || messageData.type === 'ptt') {
      metadata.duration = null; // Would need audio processing library
      metadata.isVoiceNote = messageData.type === 'ptt';
    }

    return metadata;
  }

  static saveMedia(mediaData, messageId, messageData = {}) {
    try {
      const ext = mediaData.mimetype.split('/')[1] || 'bin';
      const timestamp = Date.now();
      const filename = `media_${timestamp}_${messageId}.${ext}`;
      const mediaPath = path.join('media', filename);
      const fullPath = path.join(__dirname, '..', mediaPath);

      // Calculate hash before saving
      const fileHash = this.calculateFileHash(mediaData.data);

      // Save the file
      fs.writeFileSync(fullPath, mediaData.data, { encoding: 'base64' });
      console.log(`✅ Media saved to: ${mediaPath}`);
      
      // Get file size after saving
      const fileSize = this.getFileSize(fullPath);

      // Extract additional metadata
      const mediaMetadata = this.extractMediaMetadata(mediaData, messageData);

      // Return enriched metadata
      return {
        path: mediaPath,
        filename: filename,
        originalFilename: mediaData.filename || null,
        fileSize: fileSize,
        fileHash: fileHash,
        mimetype: mediaData.mimetype,
        savedAt: new Date(timestamp).toISOString(),
        ...mediaMetadata
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
          id: `${groupId}_${msg.author}_${msg.timestamp}`,
          author: msg.author,
          authorDetails: msg.authorDetails || {},
          groupId: groupId,
          groupName: msg.groupName || null,
          startTimestamp: msg.timestamp,
          endTimestamp: msg.timestamp,
          startDate: new Date(msg.timestamp * 1000).toISOString(),
          endDate: new Date(msg.timestamp * 1000).toISOString(),
          messages: [],
          media: [],
          texts: [],
          links: [],
          mentions: [],
          reactions: [],
          statistics: {
            totalMessages: 0,
            textMessages: 0,
            mediaMessages: 0,
            linkCount: 0,
            mentionCount: 0,
            reactionCount: 0,
            mediaByType: {}
          }
        };
        groupedMessages.push(currentGroup);
      }
      
      // Update the end timestamp
      currentGroup.endTimestamp = msg.timestamp;
      currentGroup.endDate = new Date(msg.timestamp * 1000).toISOString();
      
      // Update statistics
      currentGroup.statistics.totalMessages++;
      
      // Add message to the current group with full metadata
      const enrichedMessage = {
        id: msg.id,
        timestamp: msg.timestamp,
        date: new Date(msg.timestamp * 1000).toISOString(),
        type: msg.type,
        caption: msg.caption || msg.body || '',
        mediaPath: msg.mediaPath,
        mediaMetadata: msg.mediaMetadata || null,
        hasMedia: msg.hasMedia,
        isForwarded: msg.isForwarded || false,
        isStarred: msg.isStarred || false,
        isDeleted: msg.isDeleted || false,
        quotedMessage: msg.quotedMessage || null,
        mentions: msg.mentions || [],
        links: msg.links || [],
        reactions: msg.reactions || []
      };
      
      currentGroup.messages.push(enrichedMessage);
      
      // Organize by type with enhanced categorization
      if (msg.hasMedia && msg.mediaPath) {
        currentGroup.statistics.mediaMessages++;
        currentGroup.statistics.mediaByType[msg.type] = (currentGroup.statistics.mediaByType[msg.type] || 0) + 1;
        
        currentGroup.media.push({
          type: msg.type,
          mediaPath: msg.mediaPath,
          mediaMetadata: msg.mediaMetadata || {},
          caption: msg.caption || msg.body || '',
          timestamp: msg.timestamp,
          date: new Date(msg.timestamp * 1000).toISOString(),
          fileSize: msg.mediaMetadata?.fileSize || 0,
          fileHash: msg.mediaMetadata?.fileHash || null,
          mimetype: msg.mediaMetadata?.mimetype || null
        });
      } else if (msg.body && !msg.hasMedia) {
        currentGroup.statistics.textMessages++;
        
        currentGroup.texts.push({
          text: msg.body,
          timestamp: msg.timestamp,
          date: new Date(msg.timestamp * 1000).toISOString(),
          wordCount: msg.body.split(/\s+/).length,
          charCount: msg.body.length,
          language: msg.detectedLanguage || null
        });
      }
      
      // Extract and categorize links
      if (msg.links && msg.links.length > 0) {
        currentGroup.statistics.linkCount += msg.links.length;
        currentGroup.links.push(...msg.links.map(link => ({
          url: link,
          timestamp: msg.timestamp,
          date: new Date(msg.timestamp * 1000).toISOString(),
          domain: this.extractDomain(link),
          type: this.categorizeLink(link)
        })));
      }
      
      // Track mentions
      if (msg.mentions && msg.mentions.length > 0) {
        currentGroup.statistics.mentionCount += msg.mentions.length;
        currentGroup.mentions.push(...msg.mentions.map(mention => ({
          userId: mention,
          timestamp: msg.timestamp,
          date: new Date(msg.timestamp * 1000).toISOString()
        })));
      }
      
      // Track reactions
      if (msg.reactions && msg.reactions.length > 0) {
        currentGroup.statistics.reactionCount += msg.reactions.length;
        currentGroup.reactions.push(...msg.reactions);
      }
    }
    
    // Calculate additional statistics for each group
    return groupedMessages.map(group => ({
      ...group,
      duration: group.endTimestamp - group.startTimestamp,
      durationFormatted: this.formatDuration(group.endTimestamp - group.startTimestamp),
      messageCount: group.messages.length,
      uniqueParticipants: [...new Set(group.mentions.map(m => m.userId))].length,
      averageMessageLength: group.texts.length > 0 
        ? Math.round(group.texts.reduce((sum, t) => sum + t.charCount, 0) / group.texts.length)
        : 0,
      totalMediaSize: group.media.reduce((sum, m) => sum + (m.fileSize || 0), 0),
      formattedMediaSize: this.formatFileSize(group.media.reduce((sum, m) => sum + (m.fileSize || 0), 0))
    }));
  }

  /**
   * Extract domain from URL
   */
  static extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return 'invalid-url';
    }
  }

  /**
   * Categorize link type
   */
  static categorizeLink(url) {
    if (url.includes('drive.google.com')) return 'google-drive';
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('facebook.com') || url.includes('fb.com')) return 'facebook';
    if (url.includes('instagram.com')) return 'instagram';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
    if (url.includes('linkedin.com')) return 'linkedin';
    if (url.includes('github.com')) return 'github';
    if (url.includes('wa.me') || url.includes('whatsapp.com')) return 'whatsapp';
    return 'other';
  }

  /**
   * Format duration in human-readable format
   */
  static formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  /**
   * Format file size in human-readable format
   */
  static formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  static updateMediaIndex(messageHistory) {
    // Filter messages with enhanced metadata
    const relevantMessages = messageHistory
      .filter(msg => msg.hasMedia || (msg.body && msg.body.trim() !== ''))
      .map(msg => ({
        id: msg.id,
        author: msg.author,
        authorDetails: msg.authorDetails || {},
        timestamp: msg.timestamp,
        date: new Date(msg.timestamp * 1000).toISOString(),
        caption: msg.body || '',
        type: msg.type || 'text',
        mediaPath: msg.mediaPath || null,
        mediaMetadata: msg.mediaMetadata || null,
        hasMedia: msg.hasMedia || false,
        body: msg.body || '',
        isForwarded: msg.isForwarded || false,
        isStarred: msg.isStarred || false,
        quotedMessage: msg.quotedMessage || null,
        mentions: msg.mentions || [],
        links: msg.links || [],
        reactions: msg.reactions || [],
        groupId: msg.from ? msg.from.split('@')[0] : null,
        groupName: msg.groupName || null
      }));

    if (relevantMessages.length === 0) return;

    // Group messages by the 5-minute rule with enhanced metadata
    const groupedMessages = this.groupMessagesByTimestamp(relevantMessages);

    // Add index metadata
    const indexedData = {
      version: '2.0',
      generatedAt: new Date().toISOString(),
      totalGroups: groupedMessages.length,
      totalMessages: relevantMessages.length,
      dateRange: {
        start: relevantMessages.length > 0 ? new Date(relevantMessages[0].timestamp * 1000).toISOString() : null,
        end: relevantMessages.length > 0 ? new Date(relevantMessages[relevantMessages.length - 1].timestamp * 1000).toISOString() : null
      },
      statistics: {
        totalMediaFiles: relevantMessages.filter(m => m.hasMedia).length,
        totalTextMessages: relevantMessages.filter(m => !m.hasMedia && m.body).length,
        mediaByType: {},
        totalFileSize: 0,
        uniqueAuthors: [...new Set(relevantMessages.map(m => m.author))].length
      },
      groups: groupedMessages
    };

    // Calculate aggregated statistics
    relevantMessages.forEach(msg => {
      if (msg.hasMedia && msg.type) {
        indexedData.statistics.mediaByType[msg.type] = (indexedData.statistics.mediaByType[msg.type] || 0) + 1;
        if (msg.mediaMetadata?.fileSize) {
          indexedData.statistics.totalFileSize += msg.mediaMetadata.fileSize;
        }
      }
    });

    indexedData.statistics.formattedTotalSize = this.formatFileSize(indexedData.statistics.totalFileSize);

    const success = this.saveJSON('./media/media.json', indexedData);
    if (success) {
      console.log(`📦 media.json updated with enhanced metadata`);
      console.log(`   📊 Total groups: ${indexedData.totalGroups}`);
      console.log(`   📬 Total messages: ${indexedData.totalMessages}`);
      console.log(`   👥 Unique authors: ${indexedData.statistics.uniqueAuthors}`);
      console.log(`   💾 Total media size: ${indexedData.statistics.formattedTotalSize}`);
    }
  }
}

module.exports = FileUtils;