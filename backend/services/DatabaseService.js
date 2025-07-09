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
  static async saveMessage(messageData, groupId) {
    const transaction = await sequelize.transaction();
    
    try {
      // Ensure author exists
      const author = await this.upsertAuthor(messageData.authorDetails || { 
        id: messageData.author,
        name: messageData.author 
      });

      // Create the message - use upsert instead of create
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
  word_count: messageData.wordCount,
  char_count: messageData.charCount,
  detected_language: messageData.detectedLanguage,
  device_type: messageData.deviceType,
  quoted_message_id: messageData.quotedMessage?.id,
  quoted_message_data: messageData.quotedMessage,
  raw_data: messageData._raw
}, { 
  transaction,
  returning: true 
});
// Only process related data if this is a new message
if (created) {
      // Save media if exists
      if (messageData.hasMedia && messageData.mediaMetadata) {
        await Media.create({
          message_id: message.id,
          file_path: messageData.mediaMetadata.path || messageData.mediaPath,
          filename: messageData.mediaMetadata.filename,
          original_filename: messageData.mediaMetadata.originalFilename,
          file_size: messageData.mediaMetadata.fileSize,
          file_hash: messageData.mediaMetadata.fileHash,
          mimetype: messageData.mediaMetadata.mimetype,
          media_type: messageData.type,
          width: messageData.mediaMetadata.dimensions?.width,
          height: messageData.mediaMetadata.dimensions?.height,
          duration: messageData.mediaMetadata.duration,
          thumbnail_path: messageData.mediaMetadata.thumbnail,
          is_voice_note: messageData.mediaMetadata.isVoiceNote || false,
          saved_at: messageData.mediaMetadata.savedAt || new Date(),
          metadata: messageData.mediaMetadata
        }, { transaction });
      }

      // Save links
      if (messageData.links && messageData.links.length > 0) {
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

  /**
   * Save a message group
   */
    static async saveMessageGroup(groupData) {
    try {
        // Map the field names correctly
        const messageGroup = await MessageGroup.create({
        id: groupData.id,
        group_id: groupData.groupId,
        author_id: groupData.author,
        // Use 'timestamp' field from the first message if start/end timestamps aren't available
        start_timestamp: groupData.startTimestamp || groupData.timestamp || (groupData.messages && groupData.messages[0]?.timestamp),
        end_timestamp: groupData.endTimestamp || groupData.timestamp || (groupData.messages && groupData.messages[groupData.messages.length - 1]?.timestamp),
        start_date: groupData.startDate || groupData.startTime || new Date((groupData.startTimestamp || groupData.timestamp) * 1000),
        end_date: groupData.endDate || groupData.endTime || new Date((groupData.endTimestamp || groupData.timestamp) * 1000),
        duration: groupData.duration || 0,
        message_count: groupData.messageCount || groupData.messages?.length || 0,
        media_count: groupData.statistics?.mediaCount || groupData.statistics?.mediaMessages || 0,
        text_count: groupData.statistics?.textCount || groupData.statistics?.textMessages || 0,
        link_count: groupData.statistics?.linkCount || 0,
        mention_count: groupData.statistics?.mentionCount || 0,
        total_media_size: groupData.totalMediaSize || 0,
        average_message_length: groupData.averageMessageLength || 0,
        statistics: groupData.statistics || {}
        });

        console.log(`✅ Saved message group ${messageGroup.id}`);
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
        const messages = await Message.findAll({
          where: {
            group_id: groupId,
            author_id: group.author_id,
            timestamp: {
              [Op.between]: [group.start_timestamp, group.end_timestamp]
            }
          },
          include: [Media, Link],
          order: [['timestamp', 'ASC']]
        });

        return {
          ...group.toJSON(),
          messages: messages.map(m => m.toJSON())
        };
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