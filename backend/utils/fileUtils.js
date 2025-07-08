const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const moment = require('moment');
const config = require('../config');

class FileUtils {
  static ensureDirectories() {
    Object.values(config.directories).forEach(dir => {
      fs.ensureDirSync(dir);
    });
    console.log('✅ All directories ensured');
  }

  static async saveMedia(mediaData, messageId) {
    try {
      const ext = mediaData.mimetype.split('/')[1] || 'bin';
      const filename = `media_${Date.now()}_${messageId}.${ext}`;
      const mediaPath = path.join('media', filename);
      const fullPath = path.join(__dirname, '..', mediaPath);

      fs.writeFileSync(fullPath, mediaData.data, { encoding: 'base64' });
      console.log(`✅ Media saved to: ${mediaPath}`);
      
      // Generate enhanced metadata for the saved media
      const mediaMetadata = await this.generateMediaMetadata(fullPath, mediaData, filename, messageId);
      
      return { path: mediaPath, metadata: mediaMetadata };
    } catch (error) {
      console.error('❌ Error saving media:', error);
      return null;
    }
  }

  static async generateMediaMetadata(filePath, mediaData, filename, messageId) {
    const stats = fs.statSync(filePath);
    const fileHash = await this.generateFileHash(filePath);
    
    return {
      // File system metadata
      filename: filename,
      originalFilename: mediaData.filename || filename,
      filepath: filePath,
      filesize: stats.size,
      filesizeHuman: this.humanFileSize(stats.size),
      fileHash: fileHash,
      
      // Media type information
      mimetype: mediaData.mimetype,
      mediaType: this.classifyMediaType(mediaData.mimetype),
      extension: path.extname(filename).toLowerCase(),
      
      // Timestamps
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
      uploadedAt: new Date().toISOString(),
      
      // WhatsApp specific
      messageId: messageId,
      mediaKey: mediaData.mediaKey || null,
      
      // Additional metadata based on media type
      dimensions: this.getMediaDimensions(mediaData),
      duration: mediaData.duration || null,
      thumbnail: mediaData.thumbnail || null,
      
      // Processing metadata
      isProcessed: true,
      processingVersion: '1.0',
      compressionRatio: mediaData.compressionRatio || null
    };
  }

  static classifyMediaType(mimetype) {
    if (!mimetype) return 'unknown';
    
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype.includes('pdf')) return 'pdf';
    if (mimetype.includes('document') || mimetype.includes('msword') || mimetype.includes('spreadsheet') || mimetype.includes('presentation')) return 'document';
    if (mimetype.includes('text/')) return 'text';
    if (mimetype.includes('zip') || mimetype.includes('rar') || mimetype.includes('7z')) return 'archive';
    
    return 'other';
  }

  static getMediaDimensions(mediaData) {
    // This would need proper image/video processing libraries in production
    // For now, return placeholder data if available
    if (mediaData.width && mediaData.height) {
      return {
        width: mediaData.width,
        height: mediaData.height,
        aspectRatio: (mediaData.width / mediaData.height).toFixed(2)
      };
    }
    return null;
  }

  static humanFileSize(bytes) {
    const thresh = 1024;
    if (Math.abs(bytes) < thresh) {
      return bytes + ' B';
    }
    const units = ['KB', 'MB', 'GB', 'TB'];
    let u = -1;
    do {
      bytes /= thresh;
      ++u;
    } while (Math.abs(bytes) >= thresh && u < units.length - 1);
    return bytes.toFixed(1) + ' ' + units[u];
  }

  static async generateFileHash(filepath) {
    const fileBuffer = fs.readFileSync(filepath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex').substring(0, 16);
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
    const sortedMessages = messages.sort((a, b) => a.timestamp - b.timestamp);
    
    const groupedMessages = [];
    let currentGroup = null;
    
    for (const msg of sortedMessages) {
      const groupId = msg.id.split('@g.us')[0];
      
      const shouldStartNewGroup = !currentGroup || 
        currentGroup.author !== msg.author ||
        currentGroup.groupId !== groupId ||
        (msg.timestamp - currentGroup.startTimestamp) > 300; // 5 minutes = 300 seconds
      
      if (shouldStartNewGroup) {
        currentGroup = {
          id: msg.id,
          author: msg.author,
          groupId: groupId,
          startTimestamp: msg.timestamp,
          endTimestamp: msg.timestamp,
          messages: [],
          media: [],
          texts: [],
          metadata: {
            totalMessages: 0,
            mediaCount: 0,
            textCount: 0,
            totalSize: 0,
            mediaTypes: {},
            urlCount: 0,
            emojiCount: 0,
            languages: new Set(),
            sentiment: { positive: 0, negative: 0, neutral: 0 }
          }
        };
        groupedMessages.push(currentGroup);
      }
      
      currentGroup.endTimestamp = msg.timestamp;
      
      // Add message to the current group
      const messageData = {
        id: msg.id,
        timestamp: msg.timestamp,
        type: msg.type,
        caption: msg.caption || msg.body || '',
        mediaPath: msg.mediaPath,
        metadata: msg.metadata || {}
      };
      
      currentGroup.messages.push(messageData);
      currentGroup.metadata.totalMessages++;
      
      // Update group metadata
      if (msg.metadata) {
        // Aggregate URL count
        currentGroup.metadata.urlCount += msg.metadata.urlCount || 0;
        
        // Aggregate emoji count
        currentGroup.metadata.emojiCount += msg.metadata.emojiCount || 0;
        
        // Aggregate languages
        if (msg.metadata.language) {
          currentGroup.metadata.languages.add(msg.metadata.language);
        }
        
        // Aggregate sentiment
        if (msg.metadata.sentiment) {
          currentGroup.metadata.sentiment[msg.metadata.sentiment]++;
        }
      }
      
      // Organize by type
      if (msg.hasMedia && msg.mediaPath) {
        const mediaData = {
          type: msg.type,
          mediaPath: msg.mediaPath,
          caption: msg.caption || msg.body || '',
          timestamp: msg.timestamp,
          filesize: msg.metadata?.mediaMetadata?.filesize || 0,
          mimetype: msg.metadata?.mediaMetadata?.mimetype || '',
          dimensions: msg.metadata?.mediaMetadata?.dimensions || null,
          duration: msg.metadata?.mediaMetadata?.duration || null
        };
        
        currentGroup.media.push(mediaData);
        currentGroup.metadata.mediaCount++;
        
        // Track media types
        const mediaType = msg.type || 'unknown';
        currentGroup.metadata.mediaTypes[mediaType] = (currentGroup.metadata.mediaTypes[mediaType] || 0) + 1;
        
        // Add to total size
        currentGroup.metadata.totalSize += mediaData.filesize;
        
      } else if (msg.body && !msg.hasMedia) {
        currentGroup.texts.push({
          text: msg.body,
          timestamp: msg.timestamp,
          wordCount: msg.metadata?.wordCount || 0,
          sentiment: msg.metadata?.sentiment || 'neutral',
          language: msg.metadata?.language || 'unknown'
        });
        currentGroup.metadata.textCount++;
      }
    }
    
    // Format the grouped messages for JSON output with enhanced metadata
    return groupedMessages.map(group => ({
      id: `${group.groupId}_${group.author}_${group.startTimestamp}`,
      groupHash: this.generateGroupHash(group),
      author: group.author,
      groupId: group.groupId,
      startTimestamp: group.startTimestamp,
      endTimestamp: group.endTimestamp,
      duration: group.endTimestamp - group.startTimestamp,
      durationHuman: this.humanizeDuration(group.endTimestamp - group.startTimestamp),
      
      // Timestamps in different formats
      timestamps: {
        start: {
          unix: group.startTimestamp,
          iso: new Date(group.startTimestamp * 1000).toISOString(),
          local: moment(group.startTimestamp * 1000).format('YYYY-MM-DD HH:mm:ss'),
          relative: moment(group.startTimestamp * 1000).fromNow()
        },
        end: {
          unix: group.endTimestamp,
          iso: new Date(group.endTimestamp * 1000).toISOString(),
          local: moment(group.endTimestamp * 1000).format('YYYY-MM-DD HH:mm:ss'),
          relative: moment(group.endTimestamp * 1000).fromNow()
        }
      },
      
      // Statistics
      statistics: {
        messageCount: group.messages.length,
        mediaCount: group.metadata.mediaCount,
        textCount: group.metadata.textCount,
        totalSize: group.metadata.totalSize,
        totalSizeHuman: this.humanFileSize(group.metadata.totalSize),
        averageMessageInterval: group.messages.length > 1 ? 
          Math.round((group.endTimestamp - group.startTimestamp) / (group.messages.length - 1)) : 0,
        messagesPerMinute: group.duration > 0 ? 
          (group.messages.length / (group.duration / 60)).toFixed(2) : 0
      },
      
      // Content analysis
      contentAnalysis: {
        mediaTypes: group.metadata.mediaTypes,
        languages: Array.from(group.metadata.languages),
        totalUrls: group.metadata.urlCount,
        totalEmojis: group.metadata.emojiCount,
        sentiment: {
          distribution: group.metadata.sentiment,
          dominant: this.getDominantSentiment(group.metadata.sentiment)
        }
      },
      
      // Detailed data
      media: group.media,
      texts: group.texts,
      allMessages: group.messages,
      
      // Metadata
      metadata: {
        version: '1.0',
        processedAt: new Date().toISOString(),
        processingTime: Date.now() - (group.startTimestamp * 1000)
      }
    }));
  }

  static generateGroupHash(group) {
    const content = `${group.groupId || 'unknown'}-${group.author}-${group.startTimestamp || group.timestamp}-${group.messages?.length || 0}`;
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  static humanizeDuration(seconds) {
    if (seconds < 60) return `${seconds} seconds`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
    return `${Math.floor(seconds / 86400)} days`;
  }

  static getDominantSentiment(sentiment) {
    const entries = Object.entries(sentiment);
    if (entries.length === 0) return 'neutral';
    
    return entries.reduce((a, b) => a[1] > b[1] ? a : b)[0];
  }

  static updateMediaIndex(messageHistory) {
    const relevantMessages = messageHistory
      .filter(msg => msg.hasMedia || (msg.body && msg.body.trim() !== ''))
      .map(msg => ({
        id: msg.id,
        author: msg.author,
        timestamp: msg.timestamp,
        caption: msg.body || '',
        type: msg.type || 'text',
        mediaPath: msg.mediaPath || null,
        hasMedia: msg.hasMedia || false,
        body: msg.body || '',
        metadata: msg.metadata || {}
      }));

    if (relevantMessages.length === 0) return;

    // Group messages by the 5-minute rule with enhanced metadata
    const groupedMessages = this.groupMessagesByTimestamp(relevantMessages);
    
    // Create enhanced media index
    const mediaIndex = {
      version: '2.0',
      lastUpdated: new Date().toISOString(),
      totalGroups: groupedMessages.length,
      totalMessages: relevantMessages.length,
      totalMedia: relevantMessages.filter(m => m.hasMedia).length,
      
      // Global statistics
      globalStats: {
        authors: [...new Set(relevantMessages.map(m => m.author))],
        dateRange: {
          start: new Date(Math.min(...relevantMessages.map(m => m.timestamp)) * 1000).toISOString(),
          end: new Date(Math.max(...relevantMessages.map(m => m.timestamp)) * 1000).toISOString()
        },
        mediaTypes: this.aggregateMediaTypes(relevantMessages),
        totalSize: this.calculateTotalSize(relevantMessages),
        languages: this.aggregateLanguages(relevantMessages),
        topKeywords: this.aggregateKeywords(relevantMessages),
        hourlyDistribution: this.calculateHourlyDistribution(relevantMessages),
        dailyDistribution: this.calculateDailyDistribution(relevantMessages)
      },
      
      // Grouped messages with full metadata
      groups: groupedMessages
    };

    const success = this.saveJSON('./media/media.json', mediaIndex);
    if (success) {
      console.log(`📦 Enhanced media.json updated:`);
      console.log(`   - ${mediaIndex.totalGroups} grouped entries`);
      console.log(`   - ${mediaIndex.totalMessages} total messages`);
      console.log(`   - ${mediaIndex.totalMedia} media files`);
      console.log(`   - ${mediaIndex.globalStats.authors.length} unique authors`);
    }
    
    return mediaIndex;
  }

  static aggregateMediaTypes(messages) {
    const types = {};
    messages.filter(m => m.hasMedia).forEach(msg => {
      const type = msg.type || 'unknown';
      types[type] = (types[type] || 0) + 1;
    });
    return types;
  }

  static calculateTotalSize(messages) {
    return messages.reduce((total, msg) => {
      if (msg.metadata?.mediaMetadata?.filesize) {
        return total + msg.metadata.mediaMetadata.filesize;
      }
      return total;
    }, 0);
  }

  static aggregateLanguages(messages) {
    const languages = {};
    messages.forEach(msg => {
      if (msg.metadata?.language) {
        languages[msg.metadata.language] = (languages[msg.metadata.language] || 0) + 1;
      }
    });
    return languages;
  }

  static aggregateKeywords(messages) {
    const keywordMap = {};
    messages.forEach(msg => {
      if (msg.metadata?.keywords) {
        msg.metadata.keywords.forEach(kw => {
          keywordMap[kw.word] = (keywordMap[kw.word] || 0) + kw.frequency;
        });
      }
    });
    
    return Object.entries(keywordMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, freq]) => ({ word, frequency: freq }));
  }

  static calculateHourlyDistribution(messages) {
    const hours = new Array(24).fill(0);
    messages.forEach(msg => {
      const hour = new Date(msg.timestamp * 1000).getHours();
      hours[hour]++;
    });
    return hours.map((count, hour) => ({ hour, count, percentage: ((count / messages.length) * 100).toFixed(2) }));
  }

  static calculateDailyDistribution(messages) {
    const days = {};
    messages.forEach(msg => {
      const date = moment(msg.timestamp * 1000).format('YYYY-MM-DD');
      days[date] = (days[date] || 0) + 1;
    });
    
    return Object.entries(days)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({
        date,
        count,
        dayOfWeek: moment(date).format('dddd')
      }));
  }
}

module.exports = FileUtils;