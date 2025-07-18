// backend/services/WhatsAppDatabaseSync.js
const DatabaseService = require('./DatabaseService');
const { sequelize } = require('../models');
const path = require('path');

class WhatsAppDatabaseSync {
  /**
   * Update WhatsAppManager to save messages to database with multi-group support
   */
  static enhanceWhatsAppManager(whatsAppManager) {
    // Store original methods
    const originalHandleIncomingMessage = whatsAppManager.handleIncomingMessage.bind(whatsAppManager);
    const originalFetchHistory = whatsAppManager.fetchHistory.bind(whatsAppManager);
    const originalFetchHistoryForGroup = whatsAppManager.fetchHistoryForGroup.bind(whatsAppManager);
    const originalSelectGroup = whatsAppManager.selectGroup.bind(whatsAppManager);
    const originalAddGroupToMonitor = whatsAppManager.addGroupToMonitor.bind(whatsAppManager);

    // Override handleIncomingMessage for multi-group support
    whatsAppManager.handleIncomingMessage = async function(message) {
      console.log('📥 Processing incoming message with database sync...');
      
      // Call original method first
      await originalHandleIncomingMessage(message);
      
      // Get group ID from message
      const groupId = message.from;
      
      // Check if this group is being monitored or is the selected group
      if ((!this.activeMonitoring.has(groupId) && (!this.selectedGroup || groupId !== this.selectedGroup.id))) {
        return;
      }
      
      try {
        // Find the message in the appropriate history
        let messageData;
        if (this.messageHistories.has(groupId)) {
          const groupHistory = this.messageHistories.get(groupId);
          messageData = groupHistory[groupHistory.length - 1];
        } else if (this.selectedGroup && groupId === this.selectedGroup.id) {
          messageData = this.messageHistory[this.messageHistory.length - 1];
        }
        
        if (!messageData) return;
        
        // Ensure media path is properly set
        if (messageData.hasMedia && messageData.mediaPath && typeof messageData.mediaPath === 'string') {
          console.log(`📸 Message has media at: ${messageData.mediaPath}`);
          if (!messageData.mediaMetadata) {
            messageData.mediaMetadata = {
              path: messageData.mediaPath,
              filename: path.basename(messageData.mediaPath),
              savedAt: new Date().toISOString()
            };
          }
        }
        
        // Save to database
        await DatabaseService.saveMessage(messageData, groupId);
        console.log('💾 Message saved to database');
        
        // Create a message group for this message
        const messageGroup = {
          id: `${groupId}_${messageData.author}_${messageData.timestamp}`,
          groupId: groupId,
          author: messageData.author,
          messages: [messageData],
          timestamp: messageData.timestamp,
          startTimestamp: messageData.timestamp,
          endTimestamp: messageData.timestamp,
          messageCount: 1,
          statistics: {
            mediaMessages: messageData.hasMedia ? 1 : 0,
            textMessages: messageData.hasMedia ? 0 : 1,
            mediaCount: messageData.hasMedia ? 1 : 0,
            textCount: messageData.hasMedia ? 0 : 1,
            linkCount: messageData.links ? messageData.links.length : 0,
            mentionCount: messageData.mentions ? messageData.mentions.length : 0
          }
        };
        
        // Save the message group
        await DatabaseService.saveMessageGroup(messageGroup);
        console.log('📦 Message group created for real-time message');
        
        // Regenerate RSS feed from database for this specific group
        await this.rssManager.generateFromDatabase(groupId, {
          limit: 100,
          isSelectedGroup: this.selectedGroup && groupId === this.selectedGroup.id
        });
        
      } catch (error) {
        if (error.name !== 'SequelizeUniqueConstraintError') {
          console.error('❌ Error saving message to database:', error);
        } else {
          console.log('ℹ️ Message already exists in database, skipping...');
        }
      }
    };

    // Override fetchHistoryForGroup for multi-group support
    whatsAppManager.fetchHistoryForGroup = async function(groupId, limit = 50) {
      console.log(`📋 Fetching history for group ${groupId} with database sync...`);
      
      // First ensure group exists in database
      const groupData = this.monitoredGroups.get(groupId);
      if (groupData) {
        await DatabaseService.upsertGroup({
          id: groupId,
          name: groupData.name,
          participantCount: groupData.participants?.length || 0
        });
      }
      
      // Call original method
      const result = await originalFetchHistoryForGroup(groupId, limit);
      
      // Sync all messages to database
      const history = this.messageHistories.get(groupId) || [];
      if (history.length > 0) {
        console.log(`💾 Syncing ${history.length} messages to database for group ${groupId}...`);
        
        const syncResult = await DatabaseService.batchSaveMessages(history, groupId);
        console.log(`✅ Database sync complete: ${syncResult.successful} messages saved`);
        
        // Save message groups
        if (result.messages) {
          for (const group of result.messages) {
            try {
              if (group.messages && group.messages.length > 0) {
                const enrichedGroup = {
                  ...group,
                  groupId: groupId,
                  startTimestamp: group.messages[0].timestamp,
                  endTimestamp: group.messages[group.messages.length - 1].timestamp,
                  messageCount: group.messages.length
                };
                await DatabaseService.saveMessageGroup(enrichedGroup);
              }
            } catch (error) {
              console.error('Error saving message group:', error);
            }
          }
        }
        
        // Generate RSS feed from database
        console.log(`📰 Generating RSS feed from database for group ${groupId}...`);
        await this.rssManager.generateFromDatabase(groupId, {
          limit: 50
        });
      }
      
      return result;
    };

    // Override fetchHistory to sync with database (legacy support)
    whatsAppManager.fetchHistory = async function(limit = 50) {
      console.log('📋 Fetching history with database sync...');
      
      if (!this.selectedGroup) {
        throw new Error('No group selected');
      }
      
      // Delegate to fetchHistoryForGroup
      return await this.fetchHistoryForGroup(this.selectedGroup.id, limit);
    };

    // Override addGroupToMonitor to create group in database
    whatsAppManager.addGroupToMonitor = async function(groupId) {
      const result = await originalAddGroupToMonitor(groupId);
      
      // Save group to database
      if (result) {
        await DatabaseService.upsertGroup({
          id: result.id,
          name: result.name,
          participantCount: result.participants?.length || 0
        });
      }
      
      return result;
    };

    // Override selectGroup to ensure it exists in database
    whatsAppManager.selectGroup = async function(groupId) {
      const result = await originalSelectGroup(groupId);
      
      // Save group to database
      if (result) {
        await DatabaseService.upsertGroup({
          id: result.id,
          name: result.name,
          participantCount: result.participants?.length || 0
        });
      }
      
      return result;
    };

    // Add new method to get messages from database for a specific group
    whatsAppManager.getMessagesFromDatabase = async function(options = {}) {
      const { groupId } = options;
      
      if (!groupId && !this.selectedGroup) {
        throw new Error('No group specified or selected');
      }
      
      const targetGroupId = groupId || this.selectedGroup.id;
      
      return await DatabaseService.getMessagesForRSS(targetGroupId, options);
    };

    // Add new method to get statistics from database for multiple groups
    whatsAppManager.getStatisticsFromDatabase = async function(groupId = null, startDate = null, endDate = null) {
      if (groupId) {
        return await DatabaseService.getGroupStatistics(groupId, startDate, endDate);
      }
      
      // Get statistics for all monitored groups
      const allStats = {};
      for (const [gId, groupData] of this.monitoredGroups) {
        allStats[gId] = await DatabaseService.getGroupStatistics(gId, startDate, endDate);
      }
      
      return allStats;
    };

    // Add method to manually regenerate RSS from database for a specific group
    whatsAppManager.regenerateRSSFromDatabase = async function(options = {}) {
      const { groupId } = options;
      
      if (!groupId && !this.selectedGroup) {
        throw new Error('No group specified or selected');
      }
      
      const targetGroupId = groupId || this.selectedGroup.id;
      
      console.log(`🔄 Manually regenerating RSS feed from database for group ${targetGroupId}...`);
      
      await this.rssManager.generateFromDatabase(targetGroupId, {
        limit: options.limit || 50,
        authorId: options.authorId,
        startDate: options.startDate,
        endDate: options.endDate,
        isSelectedGroup: this.selectedGroup && targetGroupId === this.selectedGroup.id
      });
      
      console.log('✅ RSS feed regenerated from database');
    };

    // Add method to regenerate combined RSS feed
    whatsAppManager.regenerateCombinedRSS = async function(options = {}) {
      console.log('🔄 Regenerating combined RSS feed...');
      
      const monitoredGroupIds = Array.from(this.activeMonitoring);
      
      if (monitoredGroupIds.length === 0) {
        console.log('⚠️ No groups are being monitored');
        return;
      }
      
      await this.rssManager.generateCombinedFeed(monitoredGroupIds, options);
      
      console.log('✅ Combined RSS feed regenerated');
    };

    console.log('✅ WhatsApp Manager enhanced with multi-group database sync and RSS generation');
  }

  /**
   * Migrate existing JSON data to database
   */
  static async migrateExistingData() {
    console.log('🔄 Starting migration of existing data to database...');
    
    const fs = require('fs-extra');
    const path = require('path');
    
    try {
      // Migrate messages.json
      const messagesPath = path.join(__dirname, '../../rss/messages.json');
      if (fs.existsSync(messagesPath)) {
        const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
        console.log(`📋 Found ${messages.length} message groups to migrate`);
        
        // Extract unique groups and authors
        const groups = new Map();
        const authors = new Map();
        
        for (const messageGroup of messages) {
          // Extract group info
          if (messageGroup.messages && messageGroup.messages.length > 0) {
            const firstMsg = messageGroup.messages[0];
            const groupId = firstMsg.from?.split('@')[0] || 'unknown';
            
            if (!groups.has(groupId)) {
              groups.set(groupId, {
                id: firstMsg.from || groupId,
                name: firstMsg.groupName || 'Unknown Group'
              });
            }
            
            // Extract author info
            if (!authors.has(messageGroup.author)) {
              authors.set(messageGroup.author, {
                id: messageGroup.author,
                name: messageGroup.author
              });
            }
          }
        }
        
        // Create groups
        for (const [id, groupData] of groups) {
          await DatabaseService.upsertGroup(groupData);
        }
        
        // Create authors
        for (const [id, authorData] of authors) {
          await DatabaseService.upsertAuthor(authorData);
        }
        
        // Migrate messages
        let migratedCount = 0;
        for (const messageGroup of messages) {
          if (messageGroup.messages) {
            for (const msg of messageGroup.messages) {
              try {
                const groupId = msg.from || 'unknown';
                await DatabaseService.saveMessage(msg, groupId);
                migratedCount++;
              } catch (error) {
                console.error(`Error migrating message ${msg.id}:`, error.message);
              }
            }
          }
        }
        
        console.log(`✅ Migrated ${migratedCount} messages`);
      }
      
      // Migrate media.json
      const mediaPath = path.join(__dirname, '../../media/media.json');
      if (fs.existsSync(mediaPath)) {
        const mediaData = JSON.parse(fs.readFileSync(mediaPath, 'utf8'));
        console.log(`📷 Found media index to process`);
        
        // Media is already associated with messages, so no additional migration needed
        console.log('✅ Media metadata will be migrated with messages');
      }
      
      console.log('✅ Migration complete!');
      
    } catch (error) {
      console.error('❌ Migration error:', error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  static async initializeDatabase() {
    try {
      console.log('🔄 Checking database connection...');
      await sequelize.authenticate();
      console.log('✅ Database connection established');
      
      // Sync all models (creates tables if they don't exist)
      console.log('🔄 Syncing database models...');
      await sequelize.sync({ alter: true }); // Use alter: true to update existing tables
      console.log('✅ Database models synchronized');
      
    } catch (error) {
      console.error('❌ Database initialization error:', error);
      throw error;
    }
  }
}

module.exports = WhatsAppDatabaseSync;