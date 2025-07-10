// backend/services/DatabaseService.js
const { 
  Group, 
  Author, 
  Message, 
  Media, 
  Link, 
  Mention, 
  Reaction, 
  MessageGroup,
  ConversationSummary,
  sequelize 
} = require('../models');
const path = require('path');
const { Op } = require('sequelize');

class DatabaseService {
  /**
   * Save or update a group
   */
  static async upsertGroup(groupData) {
    try {
      const [group, created] = await Group.upsert({
        id: groupData.id,
        name: groupData.name,
        participant_count: groupData.participantCount || 0,
        is_archived: groupData.isArchived || false,
        is_muted: groupData.isMuted || false,
        last_activity: new Date(),
        metadata: groupData
      }, {
        returning: true
      });

      console.log(`${created ? 'Created' : 'Updated'} group: ${group.name}`);
      return group;
    } catch (error) {
      console.error('Error upserting group:', error);
      throw error;
    }
  }

  /**
   * Save or update an author
   */
  static async upsertAuthor(authorData) {
    try {
      const phoneNumber = authorData.id?.split('@')[0] || null;
      
      const [author, created] = await Author.upsert({
        id: authorData.id,
        phone_number: phoneNumber,
        push_name: authorData.pushName || authorData.name,
        is_business_account: authorData.isBusinessAccount || false,
        profile_pic_url: authorData.profilePicUrl,
        last_seen: new Date(),
        metadata: authorData
      }, {
        returning: true
      });

      if (!created) {
        // Update counters will be handled separately
        await author.update({ last_seen: new Date() });
      }

      return author;
    } catch (error) {
      console.error('Error upserting author:', error);
      throw error;
    }
  }

  /**
   * Save a message with all related data
   */
// Update the saveMessage method in DatabaseService.js:

static async saveMessage(messageData, groupId) {
  const transaction = await sequelize.transaction();
  
  try {
    // Ensure author exists
    const author = await this.upsertAuthor(messageData.authorDetails || { 
      id: messageData.author,
      name: messageData.author 
    });

    // Check if message already exists
    const existingMessage = await Message.findByPk(messageData.id, { transaction });
    
    if (existingMessage) {
      console.log(`ℹ️ Message ${messageData.id} already exists`);
      
      // Check if media needs to be saved
      if (messageData.hasMedia && !await Media.findOne({ where: { message_id: messageData.id }, transaction })) {
        console.log('📸 Adding missing media record...');
        
        // Handle both new format (mediaMetadata object) and old format (mediaPath string)
        if (messageData.mediaMetadata || messageData.mediaPath) {
          const mediaData = messageData.mediaMetadata || {
            path: messageData.mediaPath,
            filename: messageData.mediaPath ? path.basename(messageData.mediaPath) : 'unknown',
            fileSize: 0,
            mimetype: this.getMimeTypeFromPath(messageData.mediaPath)
          };
          
          await Media.create({
            message_id: existingMessage.id,
            file_path: mediaData.path || messageData.mediaPath,
            filename: mediaData.filename || path.basename(messageData.mediaPath || ''),
            original_filename: mediaData.originalFilename,
            file_size: mediaData.fileSize || 0,
            file_hash: mediaData.fileHash,
            mimetype: mediaData.mimetype || this.getMimeTypeFromPath(messageData.mediaPath),
            media_type: messageData.type,
            width: mediaData.dimensions?.width,
            height: mediaData.dimensions?.height,
            duration: mediaData.duration,
            thumbnail_path: mediaData.thumbnail,
            is_voice_note: messageData.type === 'ptt' || mediaData.isVoiceNote || false,
            saved_at: mediaData.savedAt || new Date(),
            metadata: mediaData
          }, { transaction });
          
          console.log('✅ Media record created for existing message');
        }
      }
      
      await transaction.commit();
      return existingMessage;
    }

    // Create new message using upsert to handle duplicates
    const [message, created] = await Message.upsert({
      id: messageData.id,
      message_id: messageData.messageId || messageData.id,
      group_id: groupId,
      author_id: author.id,
      timestamp: messageData.timestamp,
      message_date: new Date(messageData.timestamp * 1000),
      type: messageData.type,
      body: messageData.body,
      original_body: messageData.originalBody,
      caption: messageData.caption,
      has_media: messageData.hasMedia,
      is_forwarded: messageData.isForwarded,
      is_starred: messageData.isStarred,
      is_deleted: messageData.isDeleted,
      is_ephemeral: messageData.isEphemeral,
      is_status: messageData.isStatus,
      is_broadcast: messageData.isBroadcast,
      from_jid: messageData.from,
      to_jid: messageData.to,
      word_count: messageData.wordCount || 0,
      char_count: messageData.charCount || 0,
      detected_language: messageData.detectedLanguage,
      device_type: messageData.deviceType,
      quoted_message_id: messageData.quotedMessage?.id,
      quoted_message_data: messageData.quotedMessage,
      raw_data: messageData._raw || {}
    }, { 
      transaction,
      returning: true 
    });

    // Only process related data if this is a new message
    if (created || !await Media.findOne({ where: { message_id: message.id }, transaction })) {
      // Save media if exists
      if (messageData.hasMedia && (messageData.mediaMetadata || messageData.mediaPath)) {
        console.log('📸 Saving media for message...');
        
        // Handle both new format (mediaMetadata object) and old format (mediaPath string)
        const mediaData = messageData.mediaMetadata || {
          path: messageData.mediaPath,
          filename: messageData.mediaPath ? path.basename(messageData.mediaPath) : 'unknown',
          fileSize: 0,
          mimetype: this.getMimeTypeFromPath(messageData.mediaPath)
        };

        await Media.create({
          message_id: message.id,
          file_path: mediaData.path || messageData.mediaPath,
          filename: mediaData.filename || path.basename(messageData.mediaPath || ''),
          original_filename: mediaData.originalFilename,
          file_size: mediaData.fileSize || 0,
          file_hash: mediaData.fileHash,
          mimetype: mediaData.mimetype || this.getMimeTypeFromPath(messageData.mediaPath),
          media_type: messageData.type,
          width: mediaData.dimensions?.width,
          height: mediaData.dimensions?.height,
          duration: mediaData.duration,
          thumbnail_path: mediaData.thumbnail,
          is_voice_note: messageData.type === 'ptt' || mediaData.isVoiceNote || false,
          saved_at: mediaData.savedAt || new Date(),
          metadata: mediaData
        }, { transaction });
        
        console.log('✅ Media saved successfully');
      }
      
      // Save links
      if (messageData.links && messageData.links.length > 0) {
        console.log(`🔗 Saving ${messageData.links.length} links...`);
        const linkPromises = messageData.links.map((link, index) => {
          const domain = this.extractDomain(link);
          const linkType = this.categorizeLinkType(link);
          
          return Link.create({
            message_id: message.id,
            url: link,
            domain: domain,
            link_type: linkType,
            position: index
          }, { transaction });
        });
        
        await Promise.all(linkPromises);
        console.log('✅ Links saved successfully');
      }
      
      // Save mentions
      if (messageData.mentions && messageData.mentions.length > 0) {
        const mentionPromises = messageData.mentions.map((mention, index) => {
          return Mention.create({
            message_id: message.id,
            mentioned_user_id: mention,
            position: index
          }, { transaction });
        });
        
        await Promise.all(mentionPromises);
      }
      
      // Save reactions
      if (messageData.reactions && messageData.reactions.length > 0) {
        const reactionPromises = messageData.reactions.map(reaction => {
          return Reaction.create({
            message_id: message.id,
            emoji: reaction.emoji,
            sender_id: reaction.sender || 'unknown',
            reaction_count: reaction.count || 1
          }, { transaction });
        });
        
        await Promise.all(reactionPromises);
      }
    }

    // Update author counters
    const updateData = {
      message_count: sequelize.literal('message_count + 1')
    };
    
    if (messageData.hasMedia) {
      updateData.media_count = sequelize.literal('media_count + 1');
    }
    
    await Author.update(updateData, {
      where: { id: author.id },
      transaction
    });

    // Update group last activity
    await Group.update(
      { last_activity: new Date() },
      { where: { id: groupId }, transaction }
    );

    await transaction.commit();
    console.log(`✅ Saved message ${message.id} with all related data`);
    
    return message;
  } catch (error) {
    await transaction.rollback();
    console.error('Error saving message:', error);
    throw error;
  }
}

// Add helper method to guess MIME type from file path
static getMimeTypeFromPath(filePath) {
  if (!filePath) return 'application/octet-stream';
  
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}
  /**
   * Save a message group
   */
// Update the saveMessageGroup method in DatabaseService.js to handle timestamps better:

static async saveMessageGroup(groupData) {
  try {
    // Extract timestamps properly
    let startTimestamp, endTimestamp;
    
    if (groupData.messages && groupData.messages.length > 0) {
      // Get timestamps from actual messages
      const timestamps = groupData.messages.map(m => m.timestamp || 0);
      startTimestamp = Math.min(...timestamps);
      endTimestamp = Math.max(...timestamps);
    } else {
      // Use provided timestamps or defaults
      startTimestamp = groupData.startTimestamp || groupData.timestamp || Date.now() / 1000;
      endTimestamp = groupData.endTimestamp || groupData.timestamp || Date.now() / 1000;
    }

    // Create or update the message group
    const [messageGroup, created] = await MessageGroup.upsert({
      id: groupData.id,
      group_id: groupData.groupId,
      author_id: groupData.author,
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
      start_date: new Date(startTimestamp * 1000),
      end_date: new Date(endTimestamp * 1000),
      duration: endTimestamp - startTimestamp,
      message_count: groupData.messageCount || groupData.messages?.length || 0,
      media_count: groupData.statistics?.mediaCount || groupData.statistics?.mediaMessages || 0,
      text_count: groupData.statistics?.textCount || groupData.statistics?.textMessages || 0,
      link_count: groupData.statistics?.linkCount || 0,
      mention_count: groupData.statistics?.mentionCount || 0,
      total_media_size: groupData.totalMediaSize || 0,
      average_message_length: groupData.averageMessageLength || 0,
      statistics: groupData.statistics || {}
    }, {
      returning: true
    });

    console.log(`${created ? '✅ Created' : '✅ Updated'} message group ${messageGroup.id}`);
    console.log(`   Timestamp range: ${new Date(startTimestamp * 1000).toISOString()} - ${new Date(endTimestamp * 1000).toISOString()}`);
    console.log(`   Message count: ${messageGroup.message_count}`);
    
    return messageGroup;
  } catch (error) {
    console.error('Error saving message group:', error);
    throw error;
  }
}

  /**
   * Save conversation summary
   */
  static async saveConversationSummary(summaryData, groupId) {
    try {
      const summary = await ConversationSummary.create({
        conversation_id: summaryData.conversationId,
        group_id: groupId,
        start_time: summaryData.startTime,
        end_time: summaryData.endTime,
        duration: summaryData.duration,
        message_count: summaryData.messageCount,
        participant_count: summaryData.participantCount,
        dominant_language: summaryData.dominantLanguage,
        is_media_heavy: summaryData.mediaHeavy,
        average_messages_per_day: summaryData.averageMessagesPerDay,
        peak_hours: summaryData.mostActiveHours || [],
        statistics: summaryData.statistics
      });

      console.log(`✅ Saved conversation summary ${summary.conversation_id}`);
      return summary;
    } catch (error) {
      console.error('Error saving conversation summary:', error);
      throw error;
    }
  }

  /**
   * Batch save messages
   */
  static async batchSaveMessages(messages, groupId) {
    console.log(`📦 Batch saving ${messages.length} messages...`);
    
    const results = {
      successful: 0,
      failed: 0,
      errors: []
    };

    for (const messageData of messages) {
      try {
        await this.saveMessage(messageData, groupId);
        results.successful++;
      } catch (error) {
        // Don't count duplicates as failures
    if (error.name === 'SequelizeUniqueConstraintError') {
      console.log(`ℹ️ Message ${messageData.id} already exists, skipping...`);
      results.successful++; // Count as successful since it's already there
    } else {
      results.failed++;
      results.errors.push({
        messageId: messageData.id,
        error: error.message
      });
    }
      }
    }

    console.log(`✅ Batch save complete: ${results.successful} successful, ${results.failed} failed`);
    return results;
  }

  /**
   * Get messages for RSS generation
   */
  static async getMessagesForRSS(groupId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      authorId = null,
      startDate = null,
      endDate = null,
      hasMedia = null
    } = options;

    const whereConditions = { group_id: groupId };
    
    if (authorId) whereConditions.author_id = authorId;
    if (hasMedia !== null) whereConditions.has_media = hasMedia;
    if (startDate || endDate) {
      whereConditions.message_date = {};
      if (startDate) whereConditions.message_date[Op.gte] = startDate;
      if (endDate) whereConditions.message_date[Op.lte] = endDate;
    }

    const messages = await Message.findAll({
      where: whereConditions,
      include: [
        {
          model: Author,
          attributes: ['id', 'push_name', 'phone_number']
        },
        {
          model: Media,
          required: false
        },
        {
          model: Link,
          required: false
        },
        {
          model: Mention,
          required: false
        },
        {
          model: Reaction,
          required: false
        }
      ],
      order: [['timestamp', 'DESC']],
      limit,
      offset
    });

    return messages;
  }

  /**
   * Get message groups for RSS
   */
// Replace the getMessageGroupsForRSS method in DatabaseService.js with this fixed version:

static async getMessageGroupsForRSS(groupId, options = {}) {
  const {
    limit = 20,
    offset = 0,
    authorId = null,
    startDate = null,
    endDate = null
  } = options;

  const whereConditions = { group_id: groupId };
  
  if (authorId) whereConditions.author_id = authorId;
  if (startDate || endDate) {
    whereConditions.start_date = {};
    if (startDate) whereConditions.start_date[Op.gte] = startDate;
    if (endDate) whereConditions.start_date[Op.lte] = endDate;
  }

  // First, get the message groups
  const messageGroups = await MessageGroup.findAll({
    where: whereConditions,
    include: [
      {
        model: Author,
        attributes: ['id', 'push_name', 'phone_number']
      }
    ],
    order: [['start_timestamp', 'DESC']],
    limit,
    offset
  });

  // For each message group, get the actual messages
  const enrichedGroups = await Promise.all(
    messageGroups.map(async (group) => {
      // Fetch messages that belong to this group's time range and author
      const messages = await Message.findAll({
        where: {
          group_id: groupId,
          author_id: group.author_id,
          timestamp: {
            [Op.between]: [group.start_timestamp, group.end_timestamp]
          }
        },
        include: [
          {
            model: Media,
            as: 'Media',
            required: false,
            attributes: ['file_path', 'filename', 'file_size', 'mimetype', 'media_type']
          },
          {
            model: Link,
            as: 'Links',
            required: false,
            attributes: ['url', 'domain', 'link_type']
          }
        ],
        order: [['timestamp', 'DESC']]
      });

      // Convert to plain object and add messages
      const groupData = group.toJSON();
      groupData.messages = messages.map(m => m.toJSON());
      
      return groupData;
    })
  );

  return enrichedGroups;
}

  /**
   * Get statistics for a group
   */
  static async getGroupStatistics(groupId, startDate = null, endDate = null) {
    const whereConditions = { group_id: groupId };
    
    if (startDate || endDate) {
      whereConditions.message_date = {};
      if (startDate) whereConditions.message_date[Op.gte] = startDate;
      if (endDate) whereConditions.message_date[Op.lte] = endDate;
    }

    const [
      totalMessages,
      mediaMessages,
      uniqueAuthors,
      linkCount,
      mentionCount,
      messagesByType,
      messagesByAuthor,
      messagesByHour,
      mediaStats
    ] = await Promise.all([
      // Total messages
      Message.count({ where: whereConditions }),
      
      // Media messages
      Message.count({ where: { ...whereConditions, has_media: true } }),
      
      // Unique authors
      Message.count({
        where: whereConditions,
        distinct: true,
        col: 'author_id'
      }),
      
      // Total links
      Link.count({
        include: [{
          model: Message,
          where: whereConditions,
          attributes: []
        }]
      }),
      
      // Total mentions
      Mention.count({
        include: [{
          model: Message,
          where: whereConditions,
          attributes: []
        }]
      }),
      
      // Messages by type
      Message.findAll({
        where: whereConditions,
        attributes: [
          'type',
          [sequelize.fn('COUNT', sequelize.col('type')), 'count']
        ],
        group: ['type']
      }),
      
      // Messages by author (top 10)
      Message.findAll({
        where: whereConditions,
        attributes: [
          'author_id',
          [sequelize.fn('COUNT', sequelize.col('Message.id')), 'count']
        ],
        include: [{
          model: Author,
          attributes: ['push_name', 'phone_number']
        }],
        group: ['Message.author_id', 'Author.id'],
        order: [[sequelize.literal('count'), 'DESC']],
        limit: 10
      }),
      
      // Messages by hour
      Message.findAll({
        where: whereConditions,
        attributes: [
          [sequelize.fn('EXTRACT', sequelize.literal('HOUR FROM message_date')), 'hour'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: [sequelize.literal('hour')],
        order: [[sequelize.literal('hour'), 'ASC']]
      }),
      
      // Media statistics
      Media.findAll({
        attributes: [
          'media_type',
          [sequelize.fn('COUNT', sequelize.col('media_type')), 'count'],
          [sequelize.fn('SUM', sequelize.col('file_size')), 'total_size']
        ],
        include: [{
          model: Message,
          where: whereConditions,
          attributes: []
        }],
        group: ['media_type']
      })
    ]);

    return {
      overview: {
        totalMessages,
        mediaMessages,
        textMessages: totalMessages - mediaMessages,
        uniqueAuthors,
        linkCount,
        mentionCount
      },
      messagesByType: messagesByType.map(m => m.toJSON()),
      topAuthors: messagesByAuthor.map(m => ({
        authorId: m.author_id,
        name: m.Author?.push_name || m.Author?.phone_number || m.author_id,
        messageCount: parseInt(m.dataValues.count)
      })),
      hourlyDistribution: messagesByHour.map(m => ({
        hour: parseInt(m.dataValues.hour),
        count: parseInt(m.dataValues.count)
      })),
      mediaStatistics: mediaStats.map(m => ({
        type: m.media_type,
        count: parseInt(m.dataValues.count),
        totalSize: parseInt(m.dataValues.total_size) || 0
      }))
    };
  }

  /**
   * Clean up old data
   */
  static async cleanupOldData(daysToKeep = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const transaction = await sequelize.transaction();
    
    try {
      // Delete old messages and cascade will handle related data
      const deletedCount = await Message.destroy({
        where: {
          message_date: { [Op.lt]: cutoffDate }
        },
        transaction
      });

      // Delete orphaned media files
      const orphanedMedia = await Media.findAll({
        include: [{
          model: Message,
          required: false,
          where: { id: null }
        }],
        transaction
      });

      for (const media of orphanedMedia) {
        // You might want to delete actual files here
        await media.destroy({ transaction });
      }

      await transaction.commit();
      console.log(`🧹 Cleaned up ${deletedCount} messages older than ${daysToKeep} days`);
      
      return deletedCount;
    } catch (error) {
      await transaction.rollback();
      console.error('Error cleaning up old data:', error);
      throw error;
    }
  }

  /**
   * Helper methods
   */
  static extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return null;
    }
  }

  static categorizeLinkType(url) {
    const categories = {
      'google-drive': ['drive.google.com'],
      'youtube': ['youtube.com', 'youtu.be'],
      'social-media': ['facebook.com', 'instagram.com', 'twitter.com', 'x.com'],
      'whatsapp': ['wa.me', 'whatsapp.com'],
      'file-sharing': ['dropbox.com', 'mega.nz', 'mediafire.com']
    };

    const domain = this.extractDomain(url);
    if (!domain) return 'other';

    for (const [category, domains] of Object.entries(categories)) {
      if (domains.some(d => domain.includes(d))) {
        return category;
      }
    }

    return 'other';
  }
}

module.exports = DatabaseService;