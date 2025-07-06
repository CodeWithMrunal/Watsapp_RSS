const fs = require('fs-extra');
const path = require('path');
const mongoose = require('mongoose');
const dbConnection = require('../connection');
const Message = require('../models/Message');
const Media = require('../models/Media');
const { Group, Author, Link } = require('../models/Group');
const Analytics = require('../models/Analytics');

class JSONToMongoDBMigrator {
  constructor() {
    this.stats = {
      messages: { processed: 0, success: 0, failed: 0 },
      media: { processed: 0, success: 0, failed: 0 },
      groups: { processed: 0, success: 0, failed: 0 },
      authors: { processed: 0, success: 0, failed: 0 },
      links: { processed: 0, success: 0, failed: 0 }
    };
    this.errors = [];
    this.batchSize = 100;
  }

  async connect() {
    try {
      await dbConnection.connect();
      console.log('✅ Connected to MongoDB for migration');
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error);
      return false;
    }
  }

  async migrate(options = {}) {
    const {
      messagesPath = './messages.json',
      mediaPath = './media/media.json',
      clearExisting = false,
      generateAnalytics = true
    } = options;

    console.log('\n🚀 Starting JSON to MongoDB migration...\n');

    // Connect to database
    if (!await this.connect()) {
      return false;
    }

    // Clear existing data if requested
    if (clearExisting) {
      await this.clearExistingData();
    }

    // Check if files exist
    const messagesExist = await fs.pathExists(messagesPath);
    const mediaExist = await fs.pathExists(mediaPath);

    if (!messagesExist && !mediaExist) {
      console.error('❌ No JSON files found to migrate');
      return false;
    }

    // Migrate messages
    if (messagesExist) {
      console.log('\n📨 Migrating messages...');
      await this.migrateMessages(messagesPath);
    }

    // Migrate media
    if (mediaExist) {
      console.log('\n🎬 Migrating media...');
      await this.migrateMedia(mediaPath);
    }

    // Extract and save authors
    console.log('\n👥 Extracting authors...');
    await this.extractAuthors();

    // Extract and save links
    console.log('\n🔗 Extracting links...');
    await this.extractLinks();

    // Generate analytics if requested
    if (generateAnalytics) {
      console.log('\n📊 Generating analytics...');
      await this.generateAnalytics();
    }

    // Print summary
    this.printSummary();

    return true;
  }

  async clearExistingData() {
    console.log('\n🗑️  Clearing existing data...');
    
    try {
      await Message.deleteMany({});
      await Media.deleteMany({});
      await Group.deleteMany({});
      await Author.deleteMany({});
      await Link.deleteMany({});
      await Analytics.deleteMany({});
      
      console.log('✅ Existing data cleared');
    } catch (error) {
      console.error('❌ Error clearing data:', error);
      throw error;
    }
  }

  async migrateMessages(messagesPath) {
    try {
      const messagesData = await fs.readJSON(messagesPath);
      const messages = Array.isArray(messagesData) ? messagesData : messagesData.messages || [];
      
      console.log(`📊 Found ${messages.length} messages to migrate`);

      // Process in batches
      for (let i = 0; i < messages.length; i += this.batchSize) {
        const batch = messages.slice(i, i + this.batchSize);
        await this.processmessageBatch(batch);
        
        // Progress update
        const progress = Math.min(i + this.batchSize, messages.length);
        process.stdout.write(`\r   Progress: ${progress}/${messages.length} messages`);
      }
      
      console.log('\n✅ Messages migration completed');
    } catch (error) {
      console.error('\n❌ Error migrating messages:', error);
      this.errors.push({ type: 'messages', error: error.message });
    }
  }

  async processmessageBatch(batch) {
    const operations = [];
    
    for (const msg of batch) {
      this.stats.messages.processed++;
      
      try {
        // Transform message to match new schema
        const messageDoc = this.transformMessage(msg);
        
        operations.push({
          updateOne: {
            filter: { id: messageDoc.id },
            update: { $set: messageDoc },
            upsert: true
          }
        });
        
        this.stats.messages.success++;
      } catch (error) {
        this.stats.messages.failed++;
        this.errors.push({ 
          type: 'message', 
          id: msg.id, 
          error: error.message 
        });
      }
    }
    
    if (operations.length > 0) {
      try {
        await Message.bulkWrite(operations);
      } catch (error) {
        console.error('\n❌ Batch operation failed:', error);
      }
    }
  }

  transformMessage(msg) {
    // Handle both old and new message formats
    const messageId = msg.messageId || msg.id;
    const groupId = msg.groupId || (msg.id && msg.id.includes('@g.us') ? msg.id.split('@g.us')[0] : null);
    
    return {
      id: msg.id,
      messageId: messageId,
      groupId: groupId,
      conversationId: msg.conversationId || msg.from,
      
      // Content
      body: msg.body || '',
      originalBody: msg.originalBody || msg.body || '',
      contentHash: msg.contentHash,
      
      // Author
      author: msg.author || 'unknown',
      authorNumber: msg.authorNumber || (msg.author ? msg.author.split('@')[0] : null),
      
      // Timestamps
      timestamp: msg.timestamp,
      createdAt: msg.createdAt || new Date(msg.timestamp * 1000),
      receivedAt: msg.receivedAt || new Date(),
      
      // Type and media
      type: msg.type || 'chat',
      hasMedia: msg.hasMedia || false,
      mediaPath: msg.mediaPath,
      mediaType: msg.mediaType,
      
      // Communication metadata
      from: msg.from || msg.author,
      to: msg.to,
      broadcast: msg.broadcast || false,
      isForwarded: msg.isForwarded || false,
      forwardingScore: msg.forwardingScore || 0,
      isStatus: msg.isStatus || false,
      isStarred: msg.isStarred || false,
      
      // Entities
      links: msg.links || [],
      linkCount: msg.linkCount || (msg.links ? msg.links.length : 0),
      mentions: msg.mentions || [],
      mentionCount: msg.mentionCount || (msg.mentions ? msg.mentions.length : 0),
      
      // Analysis
      analysis: msg.analysis || {},
      
      // Reply context
      hasQuotedMsg: msg.hasQuotedMsg || false,
      quotedMsgId: msg.quotedMsgId,
      
      // Additional metadata
      deviceType: msg.deviceType || 'unknown',
      isGif: msg.isGif || false,
      isEphemeral: msg.isEphemeral || false,
      isViewOnce: msg.isViewOnce || false,
      
      // Processing
      processed: true,
      processedAt: msg.processedAt || new Date(),
      version: msg.version || '2.0'
    };
  }

  async migrateMedia(mediaPath) {
    try {
      const mediaData = await fs.readJSON(mediaPath);
      let mediaItems = [];
      
      // Handle different media.json formats
      if (mediaData.groups) {
        // New format with groups
        mediaItems = mediaData.groups.flatMap(group => 
          group.media.map(m => ({
            ...m,
            groupId: group.groupId,
            author: group.author
          }))
        );
      } else if (Array.isArray(mediaData)) {
        // Old format - direct array
        mediaItems = mediaData;
      }
      
      console.log(`📊 Found ${mediaItems.length} media items to migrate`);
      
      // Process in batches
      for (let i = 0; i < mediaItems.length; i += this.batchSize) {
        const batch = mediaItems.slice(i, i + this.batchSize);
        await this.processMediaBatch(batch);
        
        // Progress update
        const progress = Math.min(i + this.batchSize, mediaItems.length);
        process.stdout.write(`\r   Progress: ${progress}/${mediaItems.length} media items`);
      }
      
      console.log('\n✅ Media migration completed');
    } catch (error) {
      console.error('\n❌ Error migrating media:', error);
      this.errors.push({ type: 'media', error: error.message });
    }
  }

  async processMediaBatch(batch) {
    const operations = [];
    
    for (const media of batch) {
      this.stats.media.processed++;
      
      try {
        const mediaDoc = await this.transformMedia(media);
        
        operations.push({
          updateOne: {
            filter: { id: mediaDoc.id },
            update: { $set: mediaDoc },
            upsert: true
          }
        });
        
        this.stats.media.success++;
      } catch (error) {
        this.stats.media.failed++;
        this.errors.push({ 
          type: 'media', 
          id: media.id || media.messageId, 
          error: error.message 
        });
      }
    }
    
    if (operations.length > 0) {
      try {
        await Media.bulkWrite(operations);
      } catch (error) {
        console.error('\n❌ Media batch operation failed:', error);
      }
    }
  }

  async transformMedia(media) {
    // Generate ID if not present
    const id = media.id || `${media.messageId}_${media.timestamp || Date.now()}`;
    
    // Get file stats if path exists
    let fileStats = null;
    if (media.mediaPath || media.path) {
      try {
        const filePath = path.join(__dirname, '../..', media.mediaPath || media.path);
        fileStats = await fs.stat(filePath);
      } catch (error) {
        // File might not exist
      }
    }
    
    return {
      id: id,
      messageId: media.messageId,
      filename: media.filename || path.basename(media.mediaPath || media.path || ''),
      originalFilename: media.originalFilename,
      path: media.mediaPath || media.path,
      fullPath: media.fullPath,
      
      // File properties
      mimetype: media.mimetype || this.guessMimeType(media.type),
      mediaType: media.type || media.mediaType || 'document',
      extension: media.extension || path.extname(media.mediaPath || '').slice(1),
      fileHash: media.fileHash,
      
      // Size
      fileSize: media.fileSize || (fileStats ? fileStats.size : 0),
      fileSizeKB: media.fileSizeKB || (fileStats ? Math.round(fileStats.size / 1024) : 0),
      fileSizeMB: media.fileSizeMB || (fileStats ? Math.round(fileStats.size / 1048576 * 100) / 100 : 0),
      
      // Dimensions
      dimensions: media.dimensions || {},
      
      // Context
      author: media.author,
      authorNumber: media.authorNumber,
      groupId: media.groupId,
      caption: media.caption || '',
      
      // Timestamps
      messageTimestamp: media.timestamp || media.messageTimestamp,
      savedAt: media.savedAt || new Date(),
      fileCreated: fileStats ? fileStats.birthtime : null,
      fileModified: fileStats ? fileStats.mtime : null,
      
      // Processing
      processed: true,
      thumbnailGenerated: media.thumbnailGenerated || false,
      thumbnailPath: media.thumbnailPath,
      
      // Additional
      isViewOnce: media.isViewOnce || false,
      isForwarded: media.isForwarded || false,
      forwardingScore: media.forwardingScore || 0,
      
      version: media.version || '2.0'
    };
  }

  guessMimeType(mediaType) {
    const mimeTypes = {
      'image': 'image/jpeg',
      'video': 'video/mp4',
      'audio': 'audio/mpeg',
      'document': 'application/octet-stream',
      'sticker': 'image/webp',
      'ptt': 'audio/ogg'
    };
    return mimeTypes[mediaType] || 'application/octet-stream';
  }

  async extractAuthors() {
    try {
      const authors = await Message.distinct('author');
      console.log(`📊 Found ${authors.length} unique authors`);
      
      for (const authorId of authors) {
        this.stats.authors.processed++;
        
        try {
          // Get author statistics
          const messages = await Message.find({ author: authorId });
          const phoneNumber = authorId.split('@')[0];
          
          const authorDoc = {
            id: authorId,
            phoneNumber: phoneNumber,
            totalMessages: messages.length,
            textMessages: messages.filter(m => !m.hasMedia).length,
            mediaMessages: messages.filter(m => m.hasMedia).length,
            firstMessageTimestamp: Math.min(...messages.map(m => m.timestamp)),
            lastMessageTimestamp: Math.max(...messages.map(m => m.timestamp)),
            groups: [...new Set(messages.map(m => m.groupId))]
          };
          
          await Author.findOneAndUpdate(
            { id: authorId },
            { $set: authorDoc },
            { upsert: true }
          );
          
          this.stats.authors.success++;
        } catch (error) {
          this.stats.authors.failed++;
          this.errors.push({ 
            type: 'author', 
            id: authorId, 
            error: error.message 
          });
        }
      }
      
      console.log('✅ Authors extraction completed');
    } catch (error) {
      console.error('❌ Error extracting authors:', error);
      this.errors.push({ type: 'authors', error: error.message });
    }
  }

  async extractLinks() {
    try {
      const messagesWithLinks = await Message.find({ linkCount: { $gt: 0 } });
      let totalLinks = 0;
      
      for (const message of messagesWithLinks) {
        if (!message.links || message.links.length === 0) continue;
        
        for (const link of message.links) {
          this.stats.links.processed++;
          totalLinks++;
          
          try {
            const linkDoc = {
              url: link.url,
              type: link.type || 'general',
              platform: link.platform || 'unknown',
              domain: this.extractDomain(link.url),
              messageId: message.id,
              groupId: message.groupId,
              author: message.author,
              authorNumber: message.authorNumber,
              messageTimestamp: message.timestamp,
              extractedAt: link.extractedAt || new Date()
            };
            
            await Link.findOneAndUpdate(
              { url: link.url, messageId: message.id },
              { $set: linkDoc },
              { upsert: true }
            );
            
            this.stats.links.success++;
          } catch (error) {
            this.stats.links.failed++;
            this.errors.push({ 
              type: 'link', 
              url: link.url, 
              error: error.message 
            });
          }
        }
      }
      
      console.log(`✅ Links extraction completed (${totalLinks} links)`);
    } catch (error) {
      console.error('❌ Error extracting links:', error);
      this.errors.push({ type: 'links', error: error.message });
    }
  }

  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return 'invalid';
    }
  }

  async generateAnalytics() {
    try {
      // Get all unique group IDs
      const groupIds = await Message.distinct('groupId');
      
      for (const groupId of groupIds) {
        // Get date range for the group
        const dateRange = await Message.aggregate([
          { $match: { groupId } },
          {
            $group: {
              _id: null,
              minDate: { $min: '$timestamp' },
              maxDate: { $max: '$timestamp' }
            }
          }
        ]);
        
        if (!dateRange[0]) continue;
        
        const startDate = new Date(dateRange[0].minDate * 1000);
        const endDate = new Date(dateRange[0].maxDate * 1000);
        
        // Generate daily analytics
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
          await Analytics.generateDailyAnalytics(groupId, currentDate);
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }
      
      console.log('✅ Analytics generation completed');
    } catch (error) {
      console.error('❌ Error generating analytics:', error);
      this.errors.push({ type: 'analytics', error: error.message });
    }
  }

  printSummary() {
    console.log('\n\n📊 Migration Summary:');
    console.log('====================');
    
    Object.entries(this.stats).forEach(([type, stats]) => {
      console.log(`\n${type.toUpperCase()}:`);
      console.log(`  Processed: ${stats.processed}`);
      console.log(`  Success: ${stats.success}`);
      console.log(`  Failed: ${stats.failed}`);
    });
    
    if (this.errors.length > 0) {
      console.log('\n\n❌ Errors encountered:');
      console.log('=====================');
      this.errors.slice(0, 10).forEach(error => {
        console.log(`- ${error.type}: ${error.error}`);
      });
      
      if (this.errors.length > 10) {
        console.log(`... and ${this.errors.length - 10} more errors`);
      }
    }
    
    console.log('\n✅ Migration completed!');
  }
}

// CLI usage
if (require.main === module) {
  const migrator = new JSONToMongoDBMigrator();
  
  const options = {
    messagesPath: process.argv[2] || './messages.json',
    mediaPath: process.argv[3] || './media/media.json',
    clearExisting: process.argv.includes('--clear'),
    generateAnalytics: !process.argv.includes('--no-analytics')
  };
  
  console.log('Migration options:', options);
  
  migrator.migrate(options)
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = JSONToMongoDBMigrator;