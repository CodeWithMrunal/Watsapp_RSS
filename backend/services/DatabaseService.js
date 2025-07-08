const { sequelize, initializeModels, syncDatabase } = require('../database/index');
const { Op } = require('sequelize');
const fs = require('fs-extra');
const path = require('path');

class DatabaseService {
  constructor() {
    this.models = null;
    this.isInitialized = false;
  }

async initialize(forceSync = false) {
  try {
    console.log('🔄 Initializing database service...');
    
    // Check if already initialized
    if (this.isInitialized && !forceSync) {
      console.log('✅ Database service already initialized');
      return true;
    }
    
    // Initialize models
    this.models = initializeModels();
    
    // Only sync if forced or tables don't exist
    try {
      // Check if tables exist
      await this.models.Author.findOne({ limit: 1 });
      console.log('✅ Database tables already exist');
    } catch (error) {
      // Tables don't exist, create them
      console.log('📊 Creating database tables...');
      await syncDatabase(false);
    }
    
    this.isInitialized = true;
    console.log('✅ Database service initialized');
    
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    throw error;
  }
}

  // Author operations
  async findOrCreateAuthor(authorData) {
    const [author, created] = await this.models.Author.findOrCreate({
      where: { whatsapp_id: authorData.whatsapp_id },
      defaults: {
        name: authorData.name || authorData.whatsapp_id,
        is_admin: authorData.is_admin || false,
        metadata: authorData.metadata || {}
      }
    });

    if (!created) {
      // Update last seen and increment counts if needed
      await author.update({
        last_seen: new Date(),
        message_count: sequelize.literal('message_count + 1')
      });
    }

    return author;
  }

  // Media operations
async saveMedia(mediaData) {
  try {
    // console.log('📊 saveMedia called with:', {
    //   hasFileHash: !!mediaData?.fileHash,
    //   hasFilepath: !!mediaData?.filepath,
    //   mediaDataKeys: mediaData ? Object.keys(mediaData) : 'undefined',
    //   mediaData: mediaData
    // });

    // Validate mediaData
    if (!mediaData || typeof mediaData !== 'object') {
      console.error('❌ Invalid mediaData provided to saveMedia');
      return null;
    }

    // Generate file hash if not provided
    let fileHash = mediaData.fileHash || mediaData.file_hash;
    
    if (!fileHash && mediaData.filepath) {
      const crypto = require('crypto');
      const fs = require('fs');
      
      try {
        const fullPath = mediaData.filepath.startsWith('/') ? 
          mediaData.filepath : 
          path.join(__dirname, '..', mediaData.filepath);
          
        if (fs.existsSync(fullPath)) {
          const fileBuffer = fs.readFileSync(fullPath);
          const hashSum = crypto.createHash('sha256');
          hashSum.update(fileBuffer);
          fileHash = hashSum.digest('hex').substring(0, 16);
        } else {
          console.warn(`File not found: ${fullPath}`);
          fileHash = crypto.randomBytes(16).toString('hex').substring(0, 16);
        }
      } catch (error) {
        console.warn('Could not generate file hash:', error.message);
        fileHash = crypto.randomBytes(16).toString('hex').substring(0, 16);
      }
    } else if (!fileHash) {
      // No filepath and no hash - generate random
      const crypto = require('crypto');
      fileHash = crypto.randomBytes(16).toString('hex').substring(0, 16);
    }

    console.log(`✅ Using file hash: ${fileHash}`);

    const [media, created] = await this.models.Media.findOrCreate({
      where: { file_hash: fileHash },
      defaults: {
        filename: mediaData.filename || 'unknown',
        original_filename: mediaData.originalFilename || mediaData.original_filename || mediaData.filename,
        filepath: mediaData.filepath || mediaData.path || '',
        filesize: mediaData.filesize || 0,
        filesize_human: mediaData.filesizeHuman || mediaData.filesize_human || this.humanFileSize(mediaData.filesize || 0),
        mimetype: mediaData.mimetype || 'application/octet-stream',
        media_type: mediaData.mediaType || mediaData.media_type || 'other',
        extension: mediaData.extension || '.bin',
        width: mediaData.dimensions?.width || mediaData.width,
        height: mediaData.dimensions?.height || mediaData.height,
        aspect_ratio: mediaData.dimensions?.aspectRatio || mediaData.aspect_ratio,
        duration: mediaData.duration,
        thumbnail_path: mediaData.thumbnail || mediaData.thumbnail_path,
        whatsapp_media_key: mediaData.mediaKey || mediaData.whatsapp_media_key,
        caption: mediaData.caption,
        compression_ratio: mediaData.compressionRatio || mediaData.compression_ratio,
        file_created_at: mediaData.createdAt || mediaData.created_at,
        file_modified_at: mediaData.modifiedAt || mediaData.modified_at,
        uploaded_at: mediaData.uploadedAt || mediaData.uploaded_at || new Date(),
        processing_version: mediaData.processingVersion || mediaData.processing_version || '1.0',
        metadata: mediaData.metadata || {}
      }
    });

    if (created) {
      console.log(`✅ Created new media record with hash: ${fileHash}`);
    } else {
      console.log(`✅ Found existing media record with hash: ${fileHash}`);
    }

    return media;
  } catch (error) {
    console.error('❌ Error saving media:', error);
    throw error;
  }
}

// Helper method to generate human-readable file size
humanFileSize(bytes) {
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

  // Message Group operations
  async createMessageGroup(groupData) {
    const transaction = await sequelize.transaction();
    
    try {
      // Find or create author
      const author = await this.findOrCreateAuthor({
        whatsapp_id: groupData.author,
        name: groupData.author
      });

      // Create message group
      const messageGroup = await this.models.MessageGroup.create({
        group_hash: groupData.groupHash,
        whatsapp_group_id: groupData.groupId,
        author_id: author.id,
        start_timestamp: groupData.startTimestamp,
        end_timestamp: groupData.endTimestamp,
        duration_seconds: groupData.duration,
        message_count: groupData.statistics?.messageCount || 0,
        media_count: groupData.statistics?.mediaCount || 0,
        text_count: groupData.statistics?.textCount || 0,
        total_characters: groupData.statistics?.totalCharacters || 0,
        total_words: groupData.statistics?.totalWords || 0,
        total_size_bytes: groupData.statistics?.totalSize || 0,
        messages_per_minute: parseFloat(groupData.statistics?.messagesPerMinute) || 0,
        dominant_sentiment: groupData.contentAnalysis?.sentiment?.dominant || 'neutral',
        languages: groupData.contentAnalysis?.languages || [],
        media_types: groupData.contentAnalysis?.mediaTypes || {},
        url_count: groupData.contentAnalysis?.totalUrls || 0,
        emoji_count: groupData.contentAnalysis?.totalEmojis || 0,
        sentiment_scores: groupData.contentAnalysis?.sentiment?.distribution || {},
        metadata: groupData.metadata || {}
      }, { transaction });

      // Create group statistics
      if (groupData.statistics || groupData.contentAnalysis) {
        await this.models.GroupStatistic.create({
          message_group_id: messageGroup.id,
          hourly_distribution: groupData.hourlyDistribution || [],
          daily_distribution: groupData.dailyDistribution || [],
          top_keywords: groupData.contentAnalysis?.keywords || [],
          top_urls: groupData.contentAnalysis?.urls || [],
          language_distribution: groupData.contentAnalysis?.languages || {},
          media_size_distribution: groupData.mediaSizeDistribution || {},
          metadata: {}
        }, { transaction });
      }

      await transaction.commit();
      return messageGroup;
    } catch (error) {
      await transaction.rollback();
      console.error('Error creating message group:', error);
      throw error;
    }
  }

  // Message operations
  async saveMessage(messageData, messageGroupId = null) {
    const transaction = await sequelize.transaction();
    
    try {
          // Check if message already exists
    const existingMessage = await this.models.Message.findOne({
      where: { 
        whatsapp_id: messageData.id 
      },
      transaction
    });

    if (existingMessage) {
      console.log(`📋 Message already exists: ${messageData.id}`);
      await transaction.commit();
      return existingMessage;
    }

    // Generate message hash if not provided
    if (!messageData.messageHash) {
      const crypto = require('crypto');
      const content = `${messageData.id}-${messageData.author}-${messageData.timestamp}-${messageData.body || ''}`;
      messageData.messageHash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    }
      // Find or create author
      const author = await this.findOrCreateAuthor({
        whatsapp_id: messageData.author,
        name: messageData.author
      });

    // Save media if present
    let media = null;
    if (messageData.hasMedia) {
      console.log('📷 Message has media, processing...');
      
      // Check different possible locations for media metadata
      const mediaMetadata = messageData.metadata?.mediaMetadata || 
                           messageData.mediaMetadata ||
                           (messageData.mediaPath ? {
                             filepath: messageData.mediaPath,
                             filename: path.basename(messageData.mediaPath),
                             mimetype: messageData.mimetype || 'application/octet-stream',
                             mediaType: messageData.type
                           } : null);
      
      if (mediaMetadata) {
        console.log('📊 Media metadata found:', {
          hasFilepath: !!mediaMetadata.filepath,
          hasFileHash: !!mediaMetadata.fileHash,
          keys: Object.keys(mediaMetadata)
        });
        
        media = await this.saveMedia(mediaMetadata);
      } else {
        console.warn('⚠️ No media metadata found for media message');
      }
    }

      // Create message
      const message = await this.models.Message.create({
        whatsapp_id: messageData.id,
        message_hash: messageData.messageHash,
        author_id: author.id,
        message_group_id: messageGroupId,
        body: messageData.body,
        original_body: messageData.originalBody,
        type: messageData.type,
        has_media: messageData.hasMedia,
        media_id: media?.id,
        timestamp: messageData.timestamp,
        datetime: new Date(messageData.timestamp * 1000),
        day_of_week: messageData.metadata?.dayOfWeek,
        time_of_day: messageData.metadata?.timeOfDay,
        message_length: messageData.metadata?.messageLength || 0,
        word_count: messageData.metadata?.wordCount || 0,
        line_count: messageData.metadata?.lineCount || 0,
        has_emojis: messageData.metadata?.hasEmojis || false,
        emoji_count: messageData.metadata?.emojiCount || 0,
        emojis: messageData.metadata?.emojis || [],
        sentiment: messageData.metadata?.sentiment || 'neutral',
        language: messageData.metadata?.language || 'unknown',
        is_forwarded: messageData.metadata?.isForwarded || false,
        is_reply: messageData.metadata?.isReply || false,
        reply_to_id: messageData.metadata?.replyToId,
        url_count: messageData.metadata?.urlCount || 0,
        mention_count: messageData.metadata?.mentionCount || 0,
        hashtag_count: messageData.metadata?.hashtagCount || 0,
        from_jid: messageData.from,
        to_jid: messageData.to,
        is_status: messageData.metadata?.isStatus || false,
        is_starred: messageData.metadata?.isStarred || false,
        is_gif: messageData.metadata?.isGif || false,
        device_type: messageData.metadata?.deviceType,
        location: messageData.metadata?.location,
        duration: messageData.metadata?.duration,
        processing_version: messageData.metadata?.processingVersion || '1.0',
        metadata: messageData.metadata || {}
      }, { transaction });

      // Handle URLs
      if (messageData.metadata?.urls && messageData.metadata.urls.length > 0) {
        for (const urlData of messageData.metadata.urls) {
          const [url] = await this.models.Url.findOrCreate({
            where: { url: urlData.url },
            defaults: {
              domain: urlData.domain,
              url_type: urlData.type
            },
            transaction
          });

          await this.models.MessageUrl.create({
            message_id: message.id,
            url_id: url.id
          }, { transaction });

          await url.increment('occurrence_count', { transaction });
          await url.update({ last_seen: new Date() }, { transaction });
        }
      }

      // Handle Keywords
      if (messageData.metadata?.keywords && messageData.metadata.keywords.length > 0) {
        for (const keywordData of messageData.metadata.keywords) {
          const [keyword] = await this.models.Keyword.findOrCreate({
            where: { word: keywordData.word },
            defaults: { frequency: 0 },
            transaction
          });

          await this.models.MessageKeyword.create({
            message_id: message.id,
            keyword_id: keyword.id,
            frequency_in_message: keywordData.frequency
          }, { transaction });

          await keyword.increment('frequency', { 
            by: keywordData.frequency,
            transaction 
          });
          await keyword.update({ last_seen: new Date() }, { transaction });
        }
      }

      await transaction.commit();
      return message;
    } catch (error) {
      await transaction.rollback();
      console.error('Error saving message:', error);
      throw error;
    }
  }

  // Batch operations
  async saveMessageGroup(groupData) {
    const transaction = await sequelize.transaction();
    
    try {
      // Create the message group first
      const messageGroup = await this.createMessageGroup(groupData);

      // Save all messages in the group
      for (const messageData of groupData.allMessages) {
        await this.saveMessage(messageData, messageGroup.id);
      }

      await transaction.commit();
      console.log(`✅ Saved message group with ${groupData.allMessages.length} messages`);
      return messageGroup;
    } catch (error) {
      await transaction.rollback();
      console.error('Error saving message group:', error);
      throw error;
    }
  }

  // Migration from JSON
  async migrateFromJSON() {
    console.log('🔄 Starting migration from JSON files...');
    
    try {
      // Migrate from media.json
      const mediaJsonPath = path.join(__dirname, '../media/media.json');
      if (fs.existsSync(mediaJsonPath)) {
        const mediaIndex = JSON.parse(fs.readFileSync(mediaJsonPath, 'utf8'));
        console.log(`📁 Found ${mediaIndex.groups?.length || 0} groups to migrate`);

        for (const group of mediaIndex.groups || []) {
          try {
            // Check if group already exists
            const existingGroup = await this.models.MessageGroup.findOne({
              where: { group_hash: group.groupHash }
            });

            if (!existingGroup) {
              await this.saveMessageGroup(group);
              console.log(`✅ Migrated group: ${group.id}`);
            } else {
              console.log(`⏭️ Skipping existing group: ${group.id}`);
            }
          } catch (error) {
            console.error(`❌ Error migrating group ${group.id}:`, error.message);
          }
        }
      }

      // Migrate from messages.json
      const messagesJsonPath = path.join(__dirname, '../rss/messages.json');
      if (fs.existsSync(messagesJsonPath)) {
        const messages = JSON.parse(fs.readFileSync(messagesJsonPath, 'utf8'));
        console.log(`📁 Found ${messages.length} individual messages to check`);

        // Messages might already be migrated as part of groups
        // This is a fallback for any orphaned messages
        for (const messageData of messages) {
          try {
            const existingMessage = await this.models.Message.findOne({
              where: { whatsapp_id: messageData.id }
            });

            if (!existingMessage) {
              await this.saveMessage(messageData);
              console.log(`✅ Migrated orphaned message: ${messageData.id}`);
            }
          } catch (error) {
            console.error(`❌ Error migrating message ${messageData.id}:`, error.message);
          }
        }
      }

      console.log('✅ Migration completed');
      return true;
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  // Query operations for RSS
  async getMessagesForRSS(options = {}) {
    const {
      limit = 50,
      offset = 0,
      authorId = null,
      groupId = null,
      startDate = null,
      endDate = null,
      mediaOnly = false
    } = options;

    const where = {};
    const include = [
      {
        model: this.models.Author,
        as: 'author',
        attributes: ['id', 'whatsapp_id', 'name']
      },
      {
        model: this.models.Media,
        as: 'media',
        required: mediaOnly
      },
      {
        model: this.models.Url,
        as: 'urls',
        through: { attributes: [] }
      }
    ];

    if (authorId) where.author_id = authorId;
    if (groupId) where.message_group_id = groupId;
    if (mediaOnly) where.has_media = true;
    
    if (startDate || endDate) {
      where.datetime = {};
      if (startDate) where.datetime[Op.gte] = startDate;
      if (endDate) where.datetime[Op.lte] = endDate;
    }

    const messages = await this.models.Message.findAll({
      where,
      include,
      order: [['timestamp', 'DESC']],
      limit,
      offset
    });

    return messages;
  }

  async getMessageGroups(options = {}) {
    const {
      limit = 20,
      offset = 0,
      authorId = null,
      startDate = null,
      endDate = null
    } = options;

    const where = {};
    const include = [
      {
        model: this.models.Author,
        as: 'author'
      },
      {
        model: this.models.Message,
        as: 'messages',
        include: [
          {
            model: this.models.Media,
            as: 'media'
          }
        ]
      },
      {
        model: this.models.GroupStatistic,
        as: 'statistics'
      }
    ];

    if (authorId) where.author_id = authorId;
    
    if (startDate || endDate) {
      where.start_timestamp = {};
      if (startDate) where.start_timestamp[Op.gte] = Math.floor(startDate.getTime() / 1000);
      if (endDate) where.start_timestamp[Op.lte] = Math.floor(endDate.getTime() / 1000);
    }

    const groups = await this.models.MessageGroup.findAll({
      where,
      include,
      order: [['start_timestamp', 'DESC']],
      limit,
      offset
    });

    return groups;
  }

  // Statistics
  async getGlobalStatistics() {
    const stats = {
      totalMessages: await this.models.Message.count(),
      totalMedia: await this.models.Media.count(),
      totalAuthors: await this.models.Author.count(),
      totalGroups: await this.models.MessageGroup.count(),
      totalUrls: await this.models.Url.count(),
      totalKeywords: await this.models.Keyword.count(),
      
      mediaByType: await this.models.Media.findAll({
        attributes: [
          'media_type',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('SUM', sequelize.col('filesize')), 'total_size']
        ],
        group: ['media_type']
      }),
      
      topAuthors: await this.models.Author.findAll({
        attributes: ['id', 'name', 'message_count'],
        order: [['message_count', 'DESC']],
        limit: 10
      }),
      
      topKeywords: await this.models.Keyword.findAll({
        attributes: ['word', 'frequency'],
        order: [['frequency', 'DESC']],
        limit: 20
      }),
      
      languageDistribution: await this.models.Message.findAll({
        attributes: [
          'language',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: ['language']
      }),
      
      sentimentDistribution: await this.models.Message.findAll({
        attributes: [
          'sentiment',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: ['sentiment']
      })
    };

    return stats;
  }
}

module.exports = DatabaseService;