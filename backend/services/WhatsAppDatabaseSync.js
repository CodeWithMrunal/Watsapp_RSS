// backend/services/WhatsAppDatabaseSync.js
const DatabaseService = require('./DatabaseService');
const { sequelize } = require('../models');

class WhatsAppDatabaseSync {
  /**
   * Update WhatsAppManager to save messages to database
   */
  static enhanceWhatsAppManager(whatsAppManager) {
    // Store original methods
    const originalHandleIncomingMessage = whatsAppManager.handleIncomingMessage.bind(whatsAppManager);
    const originalFetchHistory = whatsAppManager.fetchHistory.bind(whatsAppManager);
    const originalSelectGroup = whatsAppManager.selectGroup.bind(whatsAppManager);

    // Override handleIncomingMessage to save to database
    whatsAppManager.handleIncomingMessage = async function(message) {
      console.log('📥 Processing incoming message with database sync...');
      
      // Call original method first
      await originalHandleIncomingMessage(message);
      
      // Save to database if we have a selected group
      if (this.selectedGroup && message.from.includes('@g.us')) {
        try {
          // Find the message in history (it was just added)
          const messageData = this.messageHistory[this.messageHistory.length - 1];
          
          // Save to database
          await DatabaseService.saveMessage(messageData, this.selectedGroup.id);
          console.log('💾 Message saved to database');
        } catch (error) {
          console.error('❌ Error saving message to database:', error);
        }
      }
    };

    // Override fetchHistory to sync with database
    whatsAppManager.fetchHistory = async function(limit = 50) {
      console.log('📋 Fetching history with database sync...');
      
      // First ensure group exists in database
      if (this.selectedGroup) {
        await DatabaseService.upsertGroup({
          id: this.selectedGroup.id,
          name: this.selectedGroup.name,
          participantCount: this.selectedGroup.participants?.length || 0
        });
      }
      
      // Call original method
      const result = await originalFetchHistory(limit);
      
      // Sync all messages to database
      if (this.messageHistory.length > 0 && this.selectedGroup) {
        console.log(`💾 Syncing ${this.messageHistory.length} messages to database...`);
        
        const syncResult = await DatabaseService.batchSaveMessages(
          this.messageHistory,
          this.selectedGroup.id
        );
        
        console.log(`✅ Database sync complete: ${syncResult.successful} messages saved`);
        
        // Save message groups
        const grouped = result;
        for (const group of grouped) {
          try {
            await DatabaseService.saveMessageGroup({
              ...group,
              groupId: this.selectedGroup.id
            });
          } catch (error) {
            console.error('Error saving message group:', error);
          }
        }
        
        // Generate and save conversation summary
        try {
          const summary = require('../utils/messageUtils').generateConversationSummary(this.messageHistory);
          await DatabaseService.saveConversationSummary(summary, this.selectedGroup.id);
        } catch (error) {
          console.error('Error saving conversation summary:', error);
        }
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

    // Add new method to get messages from database
    whatsAppManager.getMessagesFromDatabase = async function(options = {}) {
      if (!this.selectedGroup) {
        throw new Error('No group selected');
      }
      
      return await DatabaseService.getMessagesForRSS(this.selectedGroup.id, options);
    };

    // Add new method to get statistics from database
    whatsAppManager.getStatisticsFromDatabase = async function(startDate = null, endDate = null) {
      if (!this.selectedGroup) {
        throw new Error('No group selected');
      }
      
      return await DatabaseService.getGroupStatistics(this.selectedGroup.id, startDate, endDate);
    };

    console.log('✅ WhatsApp Manager enhanced with database sync');
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

// Update your server.js or main application file to use this:
/*
// In your server initialization:
const WhatsAppDatabaseSync = require('./services/WhatsAppDatabaseSync');

// Initialize database
await WhatsAppDatabaseSync.initializeDatabase();

// Enhance WhatsApp manager with database sync
WhatsAppDatabaseSync.enhanceWhatsAppManager(whatsAppManager);

// Optionally migrate existing data
await WhatsAppDatabaseSync.migrateExistingData();
*/