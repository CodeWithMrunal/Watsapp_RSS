// services/WhatsAppManager.js - Enhanced with database integration
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const FileUtils = require('../utils/fileUtils');
const MessageUtils = require('../utils/messageUtils');

class WhatsAppManager {
  constructor(io, rssManager, databaseService) {
    this.client = null;
    this.io = io;
    this.rssManager = rssManager;
    this.db = databaseService;
    this.isAuthenticated = false;
    this.isReady = false;
    this.selectedGroup = null;
    this.selectedUser = null;
    this.messageHistory = []; // Keep for backward compatibility
    this.groupsCache = null;
    this.groupsCacheTime = null;
    this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache
    
    // Session persistence settings
    this.sessionPath = path.resolve('./.wwebjs_auth');
    this.sessionDataPath = path.resolve('./session-data.json');
    
    // Initialize session data
    this.loadSessionData();
  }

  // Load saved session data
  async loadSessionData() {
    try {
      if (fs.existsSync(this.sessionDataPath)) {
        const sessionData = JSON.parse(fs.readFileSync(this.sessionDataPath, 'utf8'));
        console.log('📂 Loading saved session data...');
        
        this.selectedGroup = sessionData.selectedGroup || null;
        this.selectedUser = sessionData.selectedUser || null;
        this.groupsCache = sessionData.groupsCache || null;
        this.groupsCacheTime = sessionData.groupsCacheTime || null;
        
        console.log('✅ Session data loaded successfully');
        if (this.selectedGroup) {
          console.log(`🎯 Previously selected group: ${this.selectedGroup.name}`);
        }
      } else {
        console.log('📂 No previous session data found');
      }
    } catch (error) {
      console.warn('⚠️ Could not load session data:', error.message);
    }
  }

  // Save session data to both file and database
  async saveSessionData() {
    try {
      const sessionData = {
        selectedGroup: this.selectedGroup,
        selectedUser: this.selectedUser,
        groupsCache: this.groupsCache,
        groupsCacheTime: this.groupsCacheTime,
        timestamp: Date.now()
      };
      
      // Save to file (for backward compatibility)
      fs.writeFileSync(this.sessionDataPath, JSON.stringify(sessionData, null, 2));
      
      // Save to database
      if (this.db && this.db.isConnected) {
        await this.saveSessionToDatabase(sessionData);
      }
      
      console.log('💾 Session data saved');
    } catch (error) {
      console.warn('⚠️ Could not save session data:', error.message);
    }
  }

  // Save session to database
  async saveSessionToDatabase(sessionData) {
    try {
      const sessionRecord = {
        session_id: 'main_session',
        selected_group_id: this.selectedGroup?.id || null,
        selected_user_id: this.selectedUser || null,
        is_authenticated: this.isAuthenticated,
        is_ready: this.isReady,
        session_data: JSON.stringify(sessionData),
        last_activity: new Date()
      };

      // Check if session exists
      const existingSession = await this.db.findMany('whatsapp_sessions', 
        { session_id: 'main_session' });

      if (existingSession.length > 0) {
        await this.db.update('whatsapp_sessions', existingSession[0].id, sessionRecord);
      } else {
        await this.db.create('whatsapp_sessions', sessionRecord);
      }
    } catch (error) {
      console.warn('⚠️ Could not save session to database:', error.message);
    }
  }

  // Initialize WhatsApp client
  initialize() {
    console.log('🔄 Initializing WhatsApp client...');
    
    if (this.client) {
      console.log('🗑️ Destroying existing client...');
      try {
        this.client.destroy();
      } catch (error) {
        console.warn('⚠️ Error destroying existing client:', error);
      }
    }

    this.isAuthenticated = false;
    this.isReady = false;

    const authStrategy = new LocalAuth({
      clientId: 'whatsapp-monitor-session',
      dataPath: this.sessionPath
    });

    const puppeteerConfig = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    };

    this.client = new Client({
      authStrategy: authStrategy,
      puppeteer: puppeteerConfig,
    });

    this.setupEventHandlers();
    this.client.initialize();
  }

  setupEventHandlers() {
    this.client.on('qr', (qr) => {
      console.log('📱 QR Code received');
      qrcode.toDataURL(qr, (err, url) => {
        if (err) {
          console.error('Error generating QR code:', err);
          return;
        }
        this.io.emit('qr', url);
      });
    });

    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading: ${percent}% - ${message}`);
      this.io.emit('loading_progress', { percent, message });
    });

    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp client authenticated!');
      this.isAuthenticated = true;
      this.io.emit('authenticated');
    });

    this.client.on('ready', async () => {
      console.log('✅ WhatsApp client is ready!');
      this.isReady = true;
      
      await this.saveSessionData();
      await this.prefetchGroups();
      await this.restorePreviousState();
      
      this.io.emit('ready');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ Authentication failed:', msg);
      this.isAuthenticated = false;
      this.isReady = false;
      this.io.emit('auth_failure', msg);
    });

    this.client.on('disconnected', (reason) => {
      console.log('🔌 WhatsApp client disconnected:', reason);
      this.isAuthenticated = false;
      this.isReady = false;
      
      this.saveSessionData();
      
      if (reason === 'User logged out' || reason === 'LOGOUT') {
        this.selectedGroup = null;
        this.selectedUser = null;
        this.groupsCache = null;
      }
      
      this.io.emit('disconnected', reason);
    });

    this.client.on('message', async (message) => {
      await this.handleIncomingMessage(message);
    });

    this.client.on('change_state', (state) => {
      console.log('📱 WhatsApp state changed:', state);
      this.io.emit('state_change', state);
    });
  }

  // Enhanced message handling with database storage
  async handleIncomingMessage(message) {
    console.log('Received message:', message.body || `[${message.type}]`);
    
    if (!this.selectedGroup || !message.from.includes('@g.us')) return;
    if (message.from !== this.selectedGroup.id) return;
    if (this.selectedUser && message.author !== this.selectedUser) return;
    
    let mediaPath = null;

    if (message.hasMedia) {
      console.log(`📦 Message has media. Type: ${message.type}, From: ${message.author}`);
      mediaPath = await this.downloadMedia(message);
    }

    const messageData = MessageUtils.createMessageData(message, mediaPath);
    
    // Store in database
    try {
      await this.storeMessageInDatabase(messageData);
      
      // Create message group for RSS
      const messageGroup = {
        id: `group_${messageData.id}_${Date.now()}`,
        groupId: this.selectedGroup.id,
        author: message.author || 'Unknown',
        userId: message.author,
        timestamp: messageData.timestamp,
        messages: [messageData],
        type: 'group'
      };
      
      // Update RSS feed from database
      await this.rssManager.updateFeed(messageGroup, this.selectedGroup.id);
      
      // Emit to clients
      this.io.emit('new_message', messageGroup);
      
      console.log('✅ Message processed and stored in database');
    } catch (error) {
      console.error('❌ Error processing message:', error);
      
      // Fallback to in-memory storage
      this.messageHistory.push(messageData);
      if (this.messageHistory.length > 1000) {
        this.messageHistory = this.messageHistory.slice(-1000);
      }
    }
    
    FileUtils.updateMediaIndex([messageData]);
    await this.saveSessionData();
  }

  // Store message in database
  async storeMessageInDatabase(messageData) {
    if (!this.db || !this.db.isConnected) {
      throw new Error('Database not connected');
    }

    try {
      // Store the user if not exists
      if (messageData.author && messageData.userId) {
        await this.rssManager.upsertUser(messageData.userId, {
          name: messageData.author,
          pushName: messageData.author
        });
      }

      // Store the message
      await this.rssManager.storeMessage(messageData, this.selectedGroup.id);
      
      console.log(`💾 Message stored in database: ${messageData.id}`);
    } catch (error) {
      console.error('❌ Error storing message in database:', error);
      throw error;
    }
  }

  async downloadMedia(message) {
    try {
      console.log(`🎬 Starting media download for message ${message.id.id}`);
      
      let media = null;
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts && !media) {
        try {
          attempts++;
          console.log(`📥 Download attempt ${attempts}/${maxAttempts}...`);
          
          if (message.type === 'video' && attempts > 1) {
            await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
          }
          
          const downloadPromise = message.downloadMedia();
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Download timeout')), 60000)
          );
          
          media = await Promise.race([downloadPromise, timeoutPromise]);
          
        } catch (downloadError) {
          console.warn(`⚠️ Download attempt ${attempts} failed:`, downloadError.message);
          if (attempts === maxAttempts) {
            throw downloadError;
          }
        }
      }

      if (!media?.data) {
        console.error('❌ Media download failed - no data received');
        return null;
      }

      return FileUtils.saveMedia(media, message.id.id);
      
    } catch (err) {
      console.error('❌ Error downloading media:', err.message);
      return null;
    }
  }

  async prefetchGroups() {
    try {
      console.log('🔄 Pre-fetching groups...');
      const groups = await this.fetchGroupsOptimized();
      console.log(`✅ Pre-fetched ${groups.length} groups`);
      
      // Store groups in database
      if (this.db && this.db.isConnected) {
        for (const group of groups) {
          await this.rssManager.storeGroup(group);
          
          // Store group memberships if available
          if (group.participants) {
            for (const participant of group.participants) {
              await this.rssManager.upsertUser(participant.id._serialized, {
                name: participant.pushname || participant.id.user,
                pushName: participant.pushname
              });
              
              await this.rssManager.storeGroupMembership(
                group.id, 
                participant.id._serialized, 
                participant.isAdmin
              );
            }
          }
        }
      }
      
      await this.saveSessionData();
    } catch (error) {
      console.error('Error pre-fetching groups:', error);
    }
  }

  async fetchGroupsOptimized() {
    console.log('📋 Fetching groups...');
    const startTime = Date.now();
    const chats = await this.client.getChats();
    
    const groups = await Promise.all(
      chats
        .filter(chat => chat.isGroup)
        .map(async (group) => {
          try {
            return {
              id: group.id._serialized,
              name: group.name || 'Unnamed Group',
              participantCount: group.participants?.length || 0,
              participants: group.participants || [],
              lastMessage: group.lastMessage?.body?.substring(0, 50) || '',
              timestamp: group.timestamp || 0,
              isArchived: group.archived || false,
              isMuted: group.isMuted || false
            };
          } catch (error) {
            console.warn(`Error processing group ${group.name}:`, error);
            return null;
          }
        })
    );

    const validGroups = groups.filter(g => g !== null);
    const fetchTime = Date.now() - startTime;
    console.log(`✅ Fetched ${validGroups.length} groups in ${fetchTime}ms`);
    
    this.groupsCache = validGroups;
    this.groupsCacheTime = Date.now();
    
    return validGroups;
  }

  async getGroups() {
    if (!this.isReady || !this.client) {
      throw new Error('WhatsApp client not ready. Please wait a moment and try again.');
    }
    
    // Try to get from database first
    if (this.db && this.db.isConnected) {
      try {
        const dbGroups = await this.db.findMany('groups', {}, { 
          orderBy: 'updated_at DESC',
          limit: 100 
        });
        
        if (dbGroups.length > 0) {
          console.log(`📦 Returning ${dbGroups.length} groups from database`);
          return dbGroups;
        }
      } catch (error) {
        console.warn('⚠️ Could not fetch groups from database:', error.message);
      }
    }
    
    // Fallback to cache or fetch from WhatsApp
    if (this.groupsCache && this.groupsCacheTime) {
      const cacheAge = Date.now() - this.groupsCacheTime;
      if (cacheAge < this.CACHE_DURATION) {
        console.log('📦 Returning cached groups');
        return this.groupsCache;
      }
    }
    
    return await this.fetchGroupsOptimized();
  }

  isClientReady() {
    return this.isReady && this.isAuthenticated && this.client;
  }

  async selectGroup(groupId) {
    if (!this.isReady || !this.client) {
      throw new Error('WhatsApp not ready');
    }
    
    const chat = await this.client.getChatById(groupId);
    this.selectedGroup = {
      id: groupId,
      name: chat.name,
      participants: chat.participants
    };
    
    // Clear in-memory history (we'll use database)
    this.messageHistory = [];
    
    // Reset RSS manager
    this.rssManager.reset();
    
    // Store group selection in database
    await this.saveSessionData();
    
    console.log(`✅ Selected group: ${this.selectedGroup.name}`);
    
    return this.selectedGroup;
  }

  getGroupParticipants() {
    if (!this.selectedGroup) {
      throw new Error('No group selected');
    }
    
    return this.selectedGroup.participants.map(p => ({
      id: p.id._serialized,
      name: p.pushname || p.id.user,
      isAdmin: p.isAdmin
    }));
  }

  selectUser(userId) {
    this.selectedUser = userId === 'all' ? null : userId;
    this.saveSessionData();
    return this.selectedUser;
  }

  async fetchHistory(limit = 50) {
    if (!this.selectedGroup || !this.client) {
      throw new Error('No group selected or client not ready');
    }
    
    const chat = await this.client.getChatById(this.selectedGroup.id);
    const messages = await chat.fetchMessages({ limit });
    
    const processedMessages = await Promise.all(
      messages.map(async (msg) => {
        let mediaPath = null;

        if (msg.hasMedia) {
          mediaPath = await this.downloadMedia(msg);
        }

        const messageData = MessageUtils.createMessageData(msg, mediaPath);
        
        // Store in database
        try {
          await this.storeMessageInDatabase(messageData);
        } catch (error) {
          console.warn(`⚠️ Could not store message ${messageData.id} in database:`, error.message);
          // Add to in-memory as fallback
          this.messageHistory.push(messageData);
        }

        return messageData;
      })
    );

    // Keep some in memory for backward compatibility
    this.messageHistory = [...this.messageHistory, ...processedMessages]
      .slice(-1000); // Keep last 1000
    
    FileUtils.updateMediaIndex(processedMessages);
    
    // Generate message groups for RSS
    const filteredMessages = MessageUtils.filterMessagesByUser(processedMessages, this.selectedUser);
    const grouped = MessageUtils.groupMessages(filteredMessages.reverse());
    
    // Update RSS feed for each group
    for (const group of grouped) {
      try {
        await this.rssManager.updateFeed(group, this.selectedGroup.id);
      } catch (error) {
        console.warn('⚠️ Could not update RSS feed:', error.message);
      }
    }
    
    await this.saveSessionData();
    
    return grouped;
  }

  // Get messages from database with fallback to memory
  async getMessages(grouped = true, limit = 50) {
    try {
      if (this.db && this.db.isConnected && this.selectedGroup) {
        // Get from database
        const dbMessages = await this.db.findMany('messages', 
          { group_id: this.selectedGroup.id }, 
          { 
            orderBy: 'timestamp DESC',
            limit: limit 
          }
        );
        
        if (dbMessages.length > 0) {
          console.log(`📦 Retrieved ${dbMessages.length} messages from database`);
          
          if (grouped) {
            return MessageUtils.groupMessages(dbMessages);
          }
          return dbMessages;
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not get messages from database:', error.message);
    }
    
    // Fallback to in-memory
    if (grouped) {
      return MessageUtils.groupMessages(this.messageHistory);
    }
    return this.messageHistory;
  }

  // Get message statistics
  async getMessageStatistics(timeRange = '24h') {
    try {
      if (this.db && this.db.isConnected) {
        return await this.rssManager.getMessageStats(
          this.selectedGroup?.id, 
          timeRange
        );
      }
    } catch (error) {
      console.warn('⚠️ Could not get message statistics:', error.message);
    }
    
    // Fallback to in-memory calculation
    const now = Date.now();
    const timeRanges = {
      '1h': 3600000,
      '24h': 86400000,
      '7d': 604800000,
      '30d': 2592000000
    };
    
    const timeLimit = now - (timeRanges[timeRange] || timeRanges['24h']);
    const recentMessages = this.messageHistory.filter(m => m.timestamp >= timeLimit);
    
    return {
      totalMessages: recentMessages.length,
      mediaMessages: recentMessages.filter(m => m.hasMedia).length,
      uniqueUsers: [...new Set(recentMessages.map(m => m.userId))].length,
      mediaTypes: recentMessages.reduce((acc, m) => {
        if (m.hasMedia && m.mediaType) {
          acc[m.mediaType] = (acc[m.mediaType] || 0) + 1;
        }
        return acc;
      }, {})
    };
  }

  // Search messages
  async searchMessages(query, limit = 50) {
    try {
      if (this.db && this.db.isConnected) {
        return await this.rssManager.searchMessages(
          query, 
          this.selectedGroup?.id, 
          limit
        );
      }
    } catch (error) {
      console.warn('⚠️ Could not search messages in database:', error.message);
    }
    
    // Fallback to in-memory search
    const searchTerm = query.toLowerCase();
    return this.messageHistory
      .filter(m => 
        (m.body && m.body.toLowerCase().includes(searchTerm)) ||
        (m.caption && m.caption.toLowerCase().includes(searchTerm))
      )
      .slice(0, limit);
  }

  async restorePreviousState() {
    if (this.selectedGroup && this.selectedGroup.id) {
      console.log(`🔄 Attempting to restore group: ${this.selectedGroup.name}`);
      try {
        const chat = await this.client.getChatById(this.selectedGroup.id);
        if (chat) {
          console.log(`✅ Group restored successfully: ${this.selectedGroup.name}`);
          this.io.emit('group_restored', this.selectedGroup);
          
          // Regenerate RSS feed from database
          try {
            await this.rssManager.generateRSSFromDatabase(this.selectedGroup.id);
          } catch (error) {
            console.warn('⚠️ Could not regenerate RSS feed:', error.message);
          }
        }
      } catch (error) {
        console.warn(`⚠️ Could not restore group: ${error.message}`);
        this.selectedGroup = null;
      }
    }
  }

  async logout() {
    console.log('🔓 Logging out WhatsApp session...');
    
    try {
      // Save final state
      await this.saveSessionData();
      
      // Logout from WhatsApp
      if (this.client) {
        await this.client.logout();
        console.log('✅ WhatsApp client logged out');
      }
      
      // Clean up session files
      const authFolders = ['.wwebjs_auth', '.wwebjs_cache'];
      
      for (const folder of authFolders) {
        try {
          if (fs.existsSync(folder)) {
            await fs.remove(folder);
            console.log(`🗑️ Deleted ${folder} folder`);
          }
        } catch (error) {
          console.warn(`⚠️ Could not delete ${folder}:`, error);
        }
      }
      
      // Remove session data file
      try {
        if (fs.existsSync(this.sessionDataPath)) {
          fs.unlinkSync(this.sessionDataPath);
          console.log('🗑️ Session data file deleted');
        }
      } catch (error) {
        console.warn('⚠️ Could not delete session data file:', error);
      }
      
      // Reset state
      this.isAuthenticated = false;
      this.isReady = false;
      this.selectedGroup = null;
      this.selectedUser = null;
      this.messageHistory = [];
      this.groupsCache = null;
      this.client = null;
      
      if (this.rssManager) {
        this.rssManager.reset();
      }
      
      this.io.emit('disconnected', 'User logged out');
      console.log('✅ Logout completed successfully');
      
    } catch (error) {
      console.error('❌ Error during logout:', error);
      
      // Force reset even if logout failed
      this.isAuthenticated = false;
      this.isReady = false;
      this.selectedGroup = null;
      this.selectedUser = null;
      this.messageHistory = [];
      this.client = null;
      
      this.io.emit('disconnected', 'Logout error but state reset');
      throw error;
    }
  }

  getStatus() {
    const sessionExists = fs.existsSync(this.sessionPath);
    const sessionDataExists = fs.existsSync(this.sessionDataPath);
    
    let sessionFileCount = 0;
    let sessionFolders = [];
    
    if (sessionExists) {
      try {
        const contents = fs.readdirSync(this.sessionPath, { withFileTypes: true });
        sessionFileCount = contents.length;
        sessionFolders = contents
          .filter(item => item.isDirectory())
          .map(item => item.name);
      } catch (err) {
        console.warn('Could not count session files:', err.message);
      }
    }
    
    return {
      authenticated: this.isAuthenticated,
      ready: this.isReady,
      selectedGroup: this.selectedGroup?.name || null,
      selectedUser: this.selectedUser || null,
      cachedGroups: this.groupsCache?.length || 0,
      sessionExists,
      sessionDataExists,
      sessionFileCount,
      sessionFolders,
      sessionPath: this.sessionPath,
      messageHistoryCount: this.messageHistory.length,
      workingDirectory: process.cwd(),
      databaseConnected: this.db?.isConnected || false,
      databaseType: this.db?.dbType || 'none'
    };
  }

  async cleanup() {
    console.log('🧹 Cleaning up WhatsApp manager...');
    await this.saveSessionData();
    
    if (this.client) {
      try {
        await this.client.destroy();
        console.log('✅ WhatsApp client destroyed');
      } catch (error) {
        console.warn('⚠️ Error destroying client:', error);
      }
    }
  }

  get messageHistory() {
    return this._messageHistory || [];
  }

  set messageHistory(value) {
    this._messageHistory = value;
  }
}

module.exports = WhatsAppManager;