const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const FileUtils = require('../utils/fileUtils');
const MessageUtils = require('../utils/messageUtils');

class WhatsAppManager {
  constructor(io, rssManager) {
    this.client = null;
    this.io = io;
    this.rssManager = rssManager;
    this.isAuthenticated = false;
    this.isReady = false;
    
    // Multi-group monitoring
    this.monitoredGroups = new Map(); // Map<groupId, groupData>
    this.messageHistories = new Map(); // Map<groupId, messages[]>
    this.activeMonitoring = new Set(); // Set of groupIds being monitored
    
    // Legacy single group support (for backward compatibility)
    this.selectedGroup = null;
    this.selectedUser = null;
    this.messageHistory = [];
    
    this.groupsCache = null;
    this.groupsCacheTime = null;
    this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache
    
    console.log('🔍 DEBUG: Current working directory:', process.cwd());
    console.log('🔍 DEBUG: __dirname:', __dirname);
    
    this.sessionPath = path.resolve('./.wwebjs_auth');
    this.sessionDataPath = path.resolve('./session-data.json');
    
    console.log('📂 DEBUG: Session paths:', {
      sessionPath: this.sessionPath,
      sessionDataPath: this.sessionDataPath,
      sessionPathExists: fs.existsSync(this.sessionPath),
      sessionDataExists: fs.existsSync(this.sessionDataPath)
    });
    
    this.loadSessionData();
  }

  // Enhanced session data loading with multi-group support
  loadSessionData() {
    try {
      if (fs.existsSync(this.sessionDataPath)) {
        const sessionData = JSON.parse(fs.readFileSync(this.sessionDataPath, 'utf8'));
        console.log('📂 Loading saved session data...');
        
        // Restore monitored groups
        if (sessionData.monitoredGroups) {
          sessionData.monitoredGroups.forEach(group => {
            this.monitoredGroups.set(group.id, group);
            this.activeMonitoring.add(group.id);
          });
          console.log(`📊 Restored ${this.monitoredGroups.size} monitored groups`);
        }
        
        // Restore message histories
        if (sessionData.messageHistories) {
          Object.entries(sessionData.messageHistories).forEach(([groupId, messages]) => {
            this.messageHistories.set(groupId, messages);
          });
        }
        
        // Legacy support
        this.selectedGroup = sessionData.selectedGroup || null;
        this.selectedUser = sessionData.selectedUser || null;
        this.groupsCache = sessionData.groupsCache || null;
        this.groupsCacheTime = sessionData.groupsCacheTime || null;
        
        // Restore legacy message history
        if (sessionData.messageHistory && Array.isArray(sessionData.messageHistory)) {
          this.messageHistory = sessionData.messageHistory;
        }
        
        console.log('✅ Session data loaded successfully');
      } else {
        console.log('📂 No previous session data found - this is normal for first run');
      }
    } catch (error) {
      console.warn('⚠️ Could not load session data:', error.message);
    }
  }

  // Enhanced session data saving with multi-group support
  saveSessionData() {
    try {
      // Convert Maps to serializable format
      const monitoredGroupsArray = Array.from(this.monitoredGroups.values());
      const messageHistoriesObj = {};
      
      this.messageHistories.forEach((messages, groupId) => {
        // Keep last 100 messages per group
        messageHistoriesObj[groupId] = messages.slice(-100);
      });
      
      const sessionData = {
        monitoredGroups: monitoredGroupsArray,
        messageHistories: messageHistoriesObj,
        activeMonitoring: Array.from(this.activeMonitoring),
        // Legacy support
        selectedGroup: this.selectedGroup,
        selectedUser: this.selectedUser,
        groupsCache: this.groupsCache,
        groupsCacheTime: this.groupsCacheTime,
        messageHistory: this.messageHistory.slice(-100),
        timestamp: Date.now()
      };
      
      fs.writeFileSync(this.sessionDataPath, JSON.stringify(sessionData, null, 2));
      console.log('💾 Session data saved to:', this.sessionDataPath);
    } catch (error) {
      console.warn('⚠️ Could not save session data:', error.message);
    }
  }

  // Multi-group methods
  
  async addGroupToMonitor(groupId) {
    if (!this.isReady || !this.client) {
      throw new Error('WhatsApp not ready');
    }
    
    if (this.activeMonitoring.has(groupId)) {
      console.log(`ℹ️ Group ${groupId} is already being monitored`);
      return this.monitoredGroups.get(groupId);
    }
    
    try {
      const chat = await this.client.getChatById(groupId);
      const groupData = {
        id: groupId,
        name: chat.name,
        participants: chat.participants,
        addedAt: new Date().toISOString()
      };
      
      this.monitoredGroups.set(groupId, groupData);
      this.activeMonitoring.add(groupId);
      
      if (!this.messageHistories.has(groupId)) {
        this.messageHistories.set(groupId, []);
      }
      
      console.log(`✅ Added group to monitoring: ${groupData.name}`);
      this.saveSessionData();
      
      // Emit event for real-time updates
      this.io.emit('group_added', groupData);
      
      return groupData;
    } catch (error) {
      console.error(`❌ Error adding group ${groupId} to monitor:`, error);
      throw error;
    }
  }

  removeGroupFromMonitor(groupId) {
    if (!this.activeMonitoring.has(groupId)) {
      console.log(`ℹ️ Group ${groupId} is not being monitored`);
      return false;
    }
    
    const groupData = this.monitoredGroups.get(groupId);
    this.monitoredGroups.delete(groupId);
    this.activeMonitoring.delete(groupId);
    
    console.log(`✅ Removed group from monitoring: ${groupData?.name || groupId}`);
    this.saveSessionData();
    
    // Emit event for real-time updates
    this.io.emit('group_removed', { groupId, name: groupData?.name });
    
    return true;
  }

  getMonitoredGroups() {
    return Array.from(this.monitoredGroups.values());
  }

  isGroupMonitored(groupId) {
    return this.activeMonitoring.has(groupId);
  }

  // Enhanced message handling for multi-group
  async handleIncomingMessage(message) {
    console.log('Received message:', message.body || `[${message.type}]`);
    
    // Check if message is from a group
    if (!message.from.includes('@g.us')) return;
    
    const groupId = message.from;
    
    // Check if this group is being monitored
    if (!this.activeMonitoring.has(groupId)) {
      // Also check legacy single group monitoring
      if (!this.selectedGroup || groupId !== this.selectedGroup.id) {
        return;
      }
    }
    
    // Handle user filtering for legacy mode
    if (this.selectedGroup && groupId === this.selectedGroup.id && 
        this.selectedUser && message.author !== this.selectedUser) {
      return;
    }
    
    let mediaMetadata = null;
    if (message.hasMedia) {
      console.log(`📦 Message has media. Type: ${message.type}, From: ${message.author}, Group: ${groupId}`);
      mediaMetadata = await this.downloadMedia(message);
    }

    // Create message data with enhanced metadata
    const messageData = MessageUtils.createMessageData(message, mediaMetadata);
    
    // Add group information
    const groupData = this.monitoredGroups.get(groupId) || this.selectedGroup;
    messageData.groupName = groupData?.name || 'Unknown Group';
    messageData.groupId = groupId;
    
    // Store in appropriate message history
    if (this.messageHistories.has(groupId)) {
      const history = this.messageHistories.get(groupId);
      history.push(messageData);
      
      if (history.length > 1000) {
        this.messageHistories.set(groupId, history.slice(-1000));
      }
    }
    
    // Legacy support - also add to main message history if it's the selected group
    if (this.selectedGroup && groupId === this.selectedGroup.id) {
      this.messageHistory.push(messageData);
      if (this.messageHistory.length > 1000) {
        this.messageHistory = this.messageHistory.slice(-1000);
      }
    }
    
    // Group messages and emit
    const grouped = MessageUtils.groupMessages([messageData]);
    if (grouped.length > 0) {
      // Update RSS for this specific group
      if (this.messageHistories.has(groupId)) {
        const groupHistory = this.messageHistories.get(groupId);
        this.rssManager.updateFeed(grouped[0], groupHistory, groupId);
      }
      
      // Emit with group information
      this.io.emit('new_message', {
        groupId,
        groupName: messageData.groupName,
        messageGroup: grouped[0]
      });
    }
    
    FileUtils.updateMediaIndex(this.messageHistory);
    this.saveSessionData();
  }

  // Fetch history for multiple groups
  async fetchHistoryForGroup(groupId, limit = 50) {
    if (!this.isReady || !this.client) {
      throw new Error('WhatsApp not ready');
    }
    
    const chat = await this.client.getChatById(groupId);
    const messages = await chat.fetchMessages({ limit });
    
    const processedMessages = await Promise.all(
      messages.map(async (msg) => {
        let mediaMetadata = null;
        
        if (msg.hasMedia) {
          mediaMetadata = await this.downloadMedia(msg);
        }

        const messageData = MessageUtils.createMessageData(msg, mediaMetadata);
        const groupData = this.monitoredGroups.get(groupId);
        messageData.groupName = groupData?.name || chat.name;
        messageData.groupId = groupId;
        
        return messageData;
      })
    );

    // Update message history for this group
    let history = this.messageHistories.get(groupId) || [];
    const existingIds = new Set(history.map(m => m.id));
    
    const newMessages = processedMessages.filter(msg => !existingIds.has(msg.id));
    history = MessageUtils.sortMessagesByTimestamp([...history, ...newMessages]);
    
    if (history.length > 1000) {
      history = history.slice(-1000);
    }
    
    this.messageHistories.set(groupId, history);
    
    FileUtils.updateMediaIndex(history);
    this.saveSessionData();
    
    // Group and return messages
    const grouped = MessageUtils.groupMessages(processedMessages.reverse());
    
    // Update RSS for this group
    grouped.forEach(group => this.rssManager.updateFeed(group, history, groupId));
    
    return {
      groupId,
      groupName: this.monitoredGroups.get(groupId)?.name,
      messages: grouped
    };
  }

  // Get messages for a specific group
  getMessagesForGroup(groupId, grouped = true) {
    const history = this.messageHistories.get(groupId) || [];
    if (grouped) {
      return MessageUtils.groupMessages(history);
    }
    return history;
  }

  // Get statistics for all monitored groups
  getMultiGroupStatistics() {
    const statistics = {};
    
    this.monitoredGroups.forEach((groupData, groupId) => {
      const history = this.messageHistories.get(groupId) || [];
      if (history.length > 0) {
        statistics[groupId] = {
          groupName: groupData.name,
          stats: MessageUtils.generateStatistics(history),
          summary: MessageUtils.generateConversationSummary(history)
        };
      }
    });
    
    return statistics;
  }

  // Initialize method remains mostly the same
  initialize() {
    console.log('🔄 Initializing WhatsApp client...');
    console.log('📂 Checking for existing WhatsApp session...');
    
    const sessionExists = fs.existsSync(this.sessionPath);
    console.log('📱 Session directory exists:', sessionExists);
    
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

    const clientId = 'whatsapp-monitor-session';
    
    const authStrategy = new LocalAuth({
      clientId: clientId,
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

  // Event handlers setup (mostly unchanged, just enhanced ready event)
  setupEventHandlers() {
    this.client.on('qr', (qr) => {
      console.log('📱 QR Code received');
      qrcode.toDataURL(qr, (err, url) => {
        if (err) {
          console.error('Error generating QR code:', err);
          return;
        }
        console.log('📱 QR Code generated successfully');
        this.io.emit('qr', url);
      });
    });

    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading: ${percent}% - ${message}`);
      this.io.emit('loading_progress', { percent, message });
    });

    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp client authenticated successfully!');
      this.isAuthenticated = true;
      this.io.emit('authenticated');
    });

    this.client.on('ready', async () => {
      console.log('✅ WhatsApp client is ready!');
      this.isReady = true;
      
      this.saveSessionData();
      this.prefetchGroups();
      
      // Restore monitored groups
      if (this.monitoredGroups.size > 0) {
        console.log(`🔄 Restoring ${this.monitoredGroups.size} monitored groups...`);
        for (const [groupId, groupData] of this.monitoredGroups) {
          try {
            const chat = await this.client.getChatById(groupId);
            if (chat) {
              console.log(`✅ Restored monitoring for: ${groupData.name}`);
            }
          } catch (error) {
            console.warn(`⚠️ Could not restore group ${groupData.name}: ${error.message}`);
            this.removeGroupFromMonitor(groupId);
          }
        }
      }
      
      // Legacy support - restore single selected group
      if (this.selectedGroup && this.selectedGroup.id) {
        console.log(`🔄 Attempting to restore previous group: ${this.selectedGroup.name}`);
        try {
          const chat = await this.client.getChatById(this.selectedGroup.id);
          if (chat) {
            console.log(`✅ Successfully restored group: ${this.selectedGroup.name}`);
            this.io.emit('group_restored', this.selectedGroup);
          }
        } catch (error) {
          console.warn(`⚠️ Could not restore previous group: ${error.message}`);
          this.selectedGroup = null;
        }
      }
      
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
        console.log('🔓 Manual logout detected - clearing session data');
        this.monitoredGroups.clear();
        this.messageHistories.clear();
        this.activeMonitoring.clear();
        this.selectedGroup = null;
        this.selectedUser = null;
        this.messageHistory = [];
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

  // Rest of the methods remain mostly the same...
  async prefetchGroups() {
    try {
      console.log('🔄 Pre-fetching groups in background...');
      const groups = await this.fetchGroupsOptimized();
      console.log(`✅ Pre-fetched ${groups.length} groups`);
      this.saveSessionData();
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
            const isMonitored = this.activeMonitoring.has(group.id._serialized);
            return {
              id: group.id._serialized,
              name: group.name || 'Unnamed Group',
              participantCount: group.participants?.length || 0,
              lastMessage: group.lastMessage?.body?.substring(0, 50) || '',
              timestamp: group.timestamp || 0,
              isArchived: group.archived || false,
              isMuted: group.isMuted || false,
              isMonitored: isMonitored
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
    
    if (this.groupsCache && this.groupsCacheTime) {
      const cacheAge = Date.now() - this.groupsCacheTime;
      if (cacheAge < this.CACHE_DURATION) {
        console.log('📦 Returning cached groups');
        // Update monitored status
        this.groupsCache.forEach(group => {
          group.isMonitored = this.activeMonitoring.has(group.id);
        });
        return this.groupsCache;
      }
    }
    
    return await this.fetchGroupsOptimized();
  }

  isClientReady() {
    return this.isReady && this.isAuthenticated && this.client;
  }

  // Legacy methods for backward compatibility
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
    
    this.messageHistory = [];
    this.rssManager.reset();
    this.saveSessionData();
    
    console.log(`✅ Selected group: ${this.selectedGroup.name}`);
    
    return this.selectedGroup;
  }

  async fetchHistory(limit = 50) {
    if (!this.selectedGroup || !this.client) {
      throw new Error('No group selected or client not ready');
    }
    
    // Delegate to fetchHistoryForGroup and return in the expected format
    const result = await this.fetchHistoryForGroup(this.selectedGroup.id, limit);
    
    // Return just the messages array for backward compatibility
    return result.messages || result;
  }

  getMessages(grouped = true) {
    if (grouped) {
      return MessageUtils.groupMessages(this.messageHistory);
    }
    return this.messageHistory;
  }

  // Rest of the methods remain the same...
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

      return FileUtils.saveMedia(media, message.id.id, {
        type: message.type,
        author: message.author,
        timestamp: message.timestamp,
        caption: message.caption || message.body,
        groupId: message.from
      });
      
    } catch (err) {
      console.error('❌ Error downloading media:', err.message);
      return null;
    }
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

  getEnhancedStatistics() {
    if (this.messageHistory.length === 0) {
      return null;
    }
    
    const stats = MessageUtils.generateStatistics(this.messageHistory);
    const summary = MessageUtils.generateConversationSummary(this.messageHistory);
    
    return {
      summary,
      statistics: stats,
      currentGroup: this.selectedGroup,
      currentUser: this.selectedUser,
      generatedAt: new Date().toISOString()
    };
  }

  async logout() {
    console.log('🔓 Logging out WhatsApp session...');
    
    try {
      try {
        if (fs.existsSync(this.sessionDataPath)) {
          fs.unlinkSync(this.sessionDataPath);
          console.log('🗑️ Session data file deleted');
        }
      } catch (error) {
        console.warn('⚠️ Could not delete session data:', error);
      }
      
      if (this.client) {
        await this.client.logout();
        console.log('✅ WhatsApp client logged out');
      }
      
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
      
      this.isAuthenticated = false;
      this.isReady = false;
      this.monitoredGroups.clear();
      this.messageHistories.clear();
      this.activeMonitoring.clear();
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
      
      this.isAuthenticated = false;
      this.isReady = false;
      this.monitoredGroups.clear();
      this.messageHistories.clear();
      this.activeMonitoring.clear();
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
    
    // Get enhanced statistics if available
    let statistics = null;
    if (this.messageHistory.length > 0) {
      statistics = {
        totalMessages: this.messageHistory.length,
        mediaMessages: this.messageHistory.filter(m => m.hasMedia).length,
        textMessages: this.messageHistory.filter(m => !m.hasMedia && m.body).length,
        uniqueAuthors: [...new Set(this.messageHistory.map(m => m.author))].length,
        dateRange: {
          start: new Date(this.messageHistory[0].timestamp * 1000).toISOString(),
          end: new Date(this.messageHistory[this.messageHistory.length - 1].timestamp * 1000).toISOString()
        }
      };
    }
    
    // Multi-group statistics
    const multiGroupStats = {
      monitoredGroupsCount: this.monitoredGroups.size,
      totalMessagesAllGroups: 0,
      totalMediaAllGroups: 0
    };
    
    this.messageHistories.forEach((history) => {
      multiGroupStats.totalMessagesAllGroups += history.length;
      multiGroupStats.totalMediaAllGroups += history.filter(m => m.hasMedia).length;
    });
    
    return {
      authenticated: this.isAuthenticated,
      ready: this.isReady,
      selectedGroup: this.selectedGroup?.name || null,
      selectedUser: this.selectedUser || null,
      monitoredGroups: this.getMonitoredGroups(),
      cachedGroups: this.groupsCache?.length || 0,
      sessionExists,
      sessionDataExists,
      sessionFileCount,
      sessionFolders,
      sessionPath: this.sessionPath,
      messageHistoryCount: this.messageHistory.length,
      workingDirectory: process.cwd(),
      statistics,
      multiGroupStats
    };
  }

  async cleanup() {
    console.log('🧹 Cleaning up WhatsApp manager...');
    this.saveSessionData();
    
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