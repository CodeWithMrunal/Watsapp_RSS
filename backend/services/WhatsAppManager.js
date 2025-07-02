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
    this.selectedGroup = null;
    this.selectedUser = null;
    this.messageHistory = [];
    this.groupsCache = null;
    this.groupsCacheTime = null;
    this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache
    
    // Session persistence settings
    this.sessionPath = path.join(__dirname, '../.wwebjs_auth');
    this.sessionDataPath = path.join(__dirname, '../session-data.json');
    this.autoReconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 5000; // 5 seconds
    
    // Initialize session data
    this.loadSessionData();
  }

  // Load saved session data
  loadSessionData() {
    try {
      if (fs.existsSync(this.sessionDataPath)) {
        const sessionData = JSON.parse(fs.readFileSync(this.sessionDataPath, 'utf8'));
        console.log('📂 Loading saved session data...');
        
        // Restore selected group and user
        this.selectedGroup = sessionData.selectedGroup || null;
        this.selectedUser = sessionData.selectedUser || null;
        this.groupsCache = sessionData.groupsCache || null;
        this.groupsCacheTime = sessionData.groupsCacheTime || null;
        
        // Restore message history if available
        if (sessionData.messageHistory && Array.isArray(sessionData.messageHistory)) {
          this.messageHistory = sessionData.messageHistory;
          console.log(`📋 Restored ${this.messageHistory.length} messages from previous session`);
        }
        
        console.log('✅ Session data loaded successfully');
        if (this.selectedGroup) {
          console.log(`🎯 Previously selected group: ${this.selectedGroup.name}`);
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not load session data:', error.message);
    }
  }

  // Save session data
  saveSessionData() {
    try {
      const sessionData = {
        selectedGroup: this.selectedGroup,
        selectedUser: this.selectedUser,
        groupsCache: this.groupsCache,
        groupsCacheTime: this.groupsCacheTime,
        messageHistory: this.messageHistory.slice(-100), // Keep last 100 messages
        timestamp: Date.now()
      };
      
      fs.writeFileSync(this.sessionDataPath, JSON.stringify(sessionData, null, 2));
      console.log('💾 Session data saved');
    } catch (error) {
      console.warn('⚠️ Could not save session data:', error.message);
    }
  }

  // Enhanced initialize method with better session handling
  initialize() {
    console.log('🔄 Initializing WhatsApp client...');
    
    // If client already exists, destroy it first
    if (this.client) {
      console.log('🗑️ Destroying existing client...');
      try {
        this.client.destroy();
      } catch (error) {
        console.warn('⚠️ Error destroying existing client:', error);
      }
    }

    // Reset connection state (but keep session data)
    this.isAuthenticated = false;
    this.isReady = false;
    this.autoReconnectAttempts = 0;

    // Create new client with enhanced LocalAuth settings
    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'whatsapp-monitor', // Unique client ID for session
        dataPath: this.sessionPath // Custom path for session data
      }),
      puppeteer: {
        ...config.whatsapp.puppeteer,
        args: [
          ...(config.whatsapp.puppeteer.args || []),
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--no-first-run',
          '--no-sandbox',
          '--no-zygote',
          '--single-process',
          '--disable-accelerated-2d-canvas',
          '--disable-web-security',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'
        ]
      },
      // Enhanced client settings for better session persistence
      takeoverOnConflict: true,
      takeoverTimeoutMs: 10000,
      qrMaxRetries: 5,
      restartOnAuthFail: true,
      // Add session-specific settings
      session: 'whatsapp-monitor-session'
    });

    this.setupEventHandlers();
    
    // Initialize the client
    this.client.initialize();
    console.log('✅ WhatsApp client initialization started');
    
    // Save session data periodically
    this.startPeriodicSave();
  }

  // Start periodic session data saving
  startPeriodicSave() {
    // Save session data every 5 minutes
    this.saveInterval = setInterval(() => {
      if (this.isReady) {
        this.saveSessionData();
      }
    }, 5 * 60 * 1000);
  }

  // Stop periodic saving
  stopPeriodicSave() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
  }

  setupEventHandlers() {
    // QR Code event
    this.client.on('qr', (qr) => {
      console.log('📱 QR Code received - Please scan to authenticate');
      qrcode.toDataURL(qr, (err, url) => {
        if (err) {
          console.error('Error generating QR code:', err);
          return;
        }
        this.io.emit('qr', url);
      });
    });

    // Authentication events
    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp client authenticated');
      this.isAuthenticated = true;
      this.autoReconnectAttempts = 0; // Reset reconnect attempts
      this.io.emit('authenticated');
    });

    // Ready event - most important for session persistence
    this.client.on('ready', async () => {
      console.log('✅ WhatsApp client is ready!');
      this.isReady = true;
      this.autoReconnectAttempts = 0;
      
      // Save session data immediately when ready
      this.saveSessionData();
      
      // Pre-fetch groups in background
      this.prefetchGroups();
      
      // If we had a previously selected group, try to restore it
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

    // Enhanced authentication failure handling
    this.client.on('auth_failure', (msg) => {
      console.error('❌ Authentication failed:', msg);
      this.isAuthenticated = false;
      this.isReady = false;
      
      // Try to auto-reconnect
      this.handleReconnection();
      
      this.io.emit('auth_failure', msg);
    });

    // Enhanced disconnection handling
    this.client.on('disconnected', (reason) => {
      console.log('🔌 WhatsApp client disconnected:', reason);
      this.isAuthenticated = false;
      this.isReady = false;
      
      // Save current state before handling disconnection
      this.saveSessionData();
      
      // Only reset group selection if this was a manual logout
      if (reason === 'User logged out' || reason === 'LOGOUT') {
        this.selectedGroup = null;
        this.selectedUser = null;
        this.messageHistory = [];
        this.groupsCache = null;
      }
      
      this.io.emit('disconnected', reason);
      
      // Try to auto-reconnect unless it was a manual logout
      if (reason !== 'User logged out' && reason !== 'LOGOUT') {
        this.handleReconnection();
      }
    });

    // Message handling
    this.client.on('message', async (message) => {
      await this.handleIncomingMessage(message);
    });

    // Loading states
    this.client.on('loading_screen', (percent, message) => {
      console.log('⏳ Loading:', percent, message);
      this.io.emit('loading_progress', { percent, message });
    });

    // Add connection state monitoring
    this.client.on('change_state', (state) => {
      console.log('📱 WhatsApp state changed:', state);
      this.io.emit('state_change', state);
    });
  }

  // Handle automatic reconnection
  handleReconnection() {
    if (this.autoReconnectAttempts < this.maxReconnectAttempts) {
      this.autoReconnectAttempts++;
      console.log(`🔄 Attempting to reconnect (${this.autoReconnectAttempts}/${this.maxReconnectAttempts}) in ${this.reconnectDelay/1000} seconds...`);
      
      setTimeout(() => {
        if (!this.isReady) {
          console.log('🔄 Reconnecting WhatsApp client...');
          this.initialize();
        }
      }, this.reconnectDelay);
      
      // Increase delay for next attempt
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000); // Max 30 seconds
    } else {
      console.log('❌ Max reconnection attempts reached. Manual intervention required.');
      this.io.emit('max_reconnect_reached');
    }
  }

  // Pre-fetch groups in background
  async prefetchGroups() {
    try {
      console.log('🔄 Pre-fetching groups in background...');
      const groups = await this.fetchGroupsOptimized();
      console.log(`✅ Pre-fetched ${groups.length} groups`);
      
      // Save groups to session data
      this.saveSessionData();
    } catch (error) {
      console.error('Error pre-fetching groups:', error);
    }
  }

  // Optimized group fetching with caching
  async fetchGroupsOptimized() {
    console.log('📋 Fetching groups...');
    
    const startTime = Date.now();
    const chats = await this.client.getChats();
    
    // Process only groups in parallel
    const groups = await Promise.all(
      chats
        .filter(chat => chat.isGroup)
        .map(async (group) => {
          try {
            return {
              id: group.id._serialized,
              name: group.name || 'Unnamed Group',
              participantCount: group.participants?.length || 0,
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
    
    // Cache the results
    this.groupsCache = validGroups;
    this.groupsCacheTime = Date.now();
    
    return validGroups;
  }

  async getGroups() {
    // Check if client is ready
    if (!this.isReady || !this.client) {
      throw new Error('WhatsApp client not ready. Please wait a moment and try again.');
    }
    
    // Return cached groups if available and fresh
    if (this.groupsCache && this.groupsCacheTime) {
      const cacheAge = Date.now() - this.groupsCacheTime;
      if (cacheAge < this.CACHE_DURATION) {
        console.log('📦 Returning cached groups');
        return this.groupsCache;
      }
    }
    
    // Fetch fresh groups
    return await this.fetchGroupsOptimized();
  }

  // Check if client is ready
  isClientReady() {
    return this.isReady && this.isAuthenticated && this.client;
  }

  // Enhanced message handling with session saving
  async handleIncomingMessage(message) {
    console.log('Received message:', message.body || `[${message.type}]`);
    
    if (!this.selectedGroup || !message.from.includes('@g.us')) return;
    if (message.from !== this.selectedGroup.id) return;
    if (this.selectedUser && message.author !== this.selectedUser) return;
    
    let mediaPath = null;

    // Handle media download
    if (message.hasMedia) {
      console.log(`📦 Message has media. Type: ${message.type}, From: ${message.author}`);
      mediaPath = await this.downloadMedia(message);
    }

    const messageData = MessageUtils.createMessageData(message, mediaPath);
    this.messageHistory.push(messageData);
    
    // Keep message history manageable (last 1000 messages)
    if (this.messageHistory.length > 1000) {
      this.messageHistory = this.messageHistory.slice(-1000);
    }
    
    // Group messages and update RSS
    const grouped = MessageUtils.groupMessages([messageData]);
    if (grouped.length > 0) {
      this.rssManager.updateFeed(grouped[0], this.messageHistory);
      this.io.emit('new_message', grouped[0]);
    }
    
    FileUtils.updateMediaIndex(this.messageHistory);
    
    // Save session data after receiving new messages
    this.saveSessionData();
  }

  // Enhanced media download with better error handling
  async downloadMedia(message) {
    try {
      console.log(`🎬 Starting media download for message ${message.id.id}`);
      console.log(`📊 Media info - Type: ${message.type}, Has Media: ${message.hasMedia}`);
      
      let media = null;
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts && !media) {
        try {
          attempts++;
          console.log(`📥 Download attempt ${attempts}/${maxAttempts}...`);
          
          if (message.type === 'video' && attempts > 1) {
            console.log('⏳ Waiting before retry...');
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

      console.log('✅ Media downloaded successfully:', {
        mimetype: media.mimetype,
        filename: media.filename,
        size: media.data.length
      });

      return FileUtils.saveMedia(media, message.id.id);
      
    } catch (err) {
      console.error('❌ Error downloading media:', err.message);
      return null;
    }
  }

  // Enhanced group selection with session persistence
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
    
    // Reset message history and RSS feed
    this.messageHistory = [];
    this.rssManager.reset();
    
    // Save session data immediately after selecting group
    this.saveSessionData();
    
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
    this.saveSessionData(); // Save after user selection
    return this.selectedUser;
  }

  // Enhanced history fetching
  async fetchHistory(limit = 50) {
    if (!this.selectedGroup || !this.client) {
      throw new Error('No group selected or client not ready');
    }
    
    const chat = await this.client.getChatById(this.selectedGroup.id);
    const messages = await chat.fetchMessages({ limit });
    
    const processedMessages = await Promise.all(
      messages.map(async (msg) => {
        const existing = this.messageHistory.find(m => m.id === msg.id._serialized);
        let mediaPath = existing?.mediaPath || null;

        if (existing) {
          console.log(`🔁 Message ${msg.id._serialized} already exists`);
        }

        if (msg.hasMedia && !mediaPath) {
          mediaPath = await this.downloadMedia(msg);
        }

        return MessageUtils.createMessageData(msg, mediaPath);
      })
    );

    // Ensure no duplicates
    const newMessages = processedMessages.filter(
      msg => !this.messageHistory.some(existing => existing.id === msg.id)
    );
    
    this.messageHistory = MessageUtils.sortMessagesByTimestamp([...this.messageHistory, ...newMessages]);
    
    // Keep history manageable
    if (this.messageHistory.length > 1000) {
      this.messageHistory = this.messageHistory.slice(-1000);
    }
    
    FileUtils.updateMediaIndex(this.messageHistory);
    
    // Filter by user if specified
    const filteredMessages = MessageUtils.filterMessagesByUser(processedMessages, this.selectedUser);
    
    // Group messages and update RSS
    const grouped = MessageUtils.groupMessages(filteredMessages.reverse());
    grouped.forEach(group => this.rssManager.updateFeed(group, this.messageHistory));
    
    // Save session data after fetching history
    this.saveSessionData();
    
    return grouped;
  }

  getMessages(grouped = true) {
    if (grouped) {
      return MessageUtils.groupMessages(this.messageHistory);
    }
    return this.messageHistory;
  }

  // Enhanced logout with proper cleanup
  async logout() {
    console.log('🔓 Logging out WhatsApp session...');
    
    try {
      // Stop periodic saving
      this.stopPeriodicSave();
      
      // Clear session data
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
      
      // Delete authentication folders
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
      
      // Reset all state
      this.isAuthenticated = false;
      this.isReady = false;
      this.selectedGroup = null;
      this.selectedUser = null;
      this.messageHistory = [];
      this.groupsCache = null;
      this.client = null;
      
      // Reset RSS manager
      if (this.rssManager) {
        this.rssManager.reset();
      }
      
      this.io.emit('disconnected', 'User logged out');
      console.log('✅ Logout completed successfully');
      
    } catch (error) {
      console.error('❌ Error during logout:', error);
      
      // Force reset state
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

  // Enhanced status with session info
  getStatus() {
    const sessionExists = fs.existsSync(this.sessionPath);
    const sessionDataExists = fs.existsSync(this.sessionDataPath);
    
    return {
      authenticated: this.isAuthenticated,
      ready: this.isReady,
      selectedGroup: this.selectedGroup?.name || null,
      selectedUser: this.selectedUser || null,
      cachedGroups: this.groupsCache?.length || 0,
      sessionExists,
      sessionDataExists,
      autoReconnectAttempts: this.autoReconnectAttempts,
      messageHistoryCount: this.messageHistory.length
    };
  }

  // Enhanced cleanup method
  async cleanup() {
    console.log('🧹 Cleaning up WhatsApp manager...');
    
    this.stopPeriodicSave();
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

  // Getters for accessing private properties
  get messageHistory() {
    return this._messageHistory || [];
  }

  set messageHistory(value) {
    this._messageHistory = value;
  }
}

module.exports = WhatsAppManager;