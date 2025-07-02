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
    
    // CRITICAL DEBUG: Let's see what's happening with paths
    console.log('🔍 DEBUG: Current working directory:', process.cwd());
    console.log('🔍 DEBUG: __dirname:', __dirname);
    
    // Session persistence settings - Try different path approaches
    this.sessionPath = path.resolve('./.wwebjs_auth');  // Relative to working directory
    this.sessionDataPath = path.resolve('./session-data.json');
    
    // Alternative absolute paths (comment out one set or the other to test)
    // this.sessionPath = path.join(process.cwd(), '.wwebjs_auth');
    // this.sessionDataPath = path.join(process.cwd(), 'session-data.json');
    
    console.log('📂 DEBUG: Session paths:', {
      sessionPath: this.sessionPath,
      sessionDataPath: this.sessionDataPath,
      sessionPathExists: fs.existsSync(this.sessionPath),
      sessionDataExists: fs.existsSync(this.sessionDataPath)
    });
    
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
      } else {
        console.log('📂 No previous session data found - this is normal for first run');
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
      console.log('💾 Session data saved to:', this.sessionDataPath);
    } catch (error) {
      console.warn('⚠️ Could not save session data:', error.message);
    }
  }

  // ENHANCED DEBUG: Initialize method with extensive logging
  initialize() {
    console.log('🔄 Initializing WhatsApp client...');
    console.log('📂 Checking for existing WhatsApp session...');
    
    // Check current working directory
    console.log('📍 Current working directory:', process.cwd());
    
    // Check if session exists BEFORE creating client
    const sessionExists = fs.existsSync(this.sessionPath);
    console.log('📱 Session directory exists:', sessionExists);
    console.log('📱 Session path:', this.sessionPath);
    
    if (sessionExists) {
      console.log('🔍 Found existing session directory!');
      try {
        const sessionContents = fs.readdirSync(this.sessionPath, { withFileTypes: true });
        console.log('📁 Session directory contents:');
        sessionContents.forEach(item => {
          console.log(`   ${item.isDirectory() ? '📁' : '📄'} ${item.name}`);
        });
        
        // Check for the specific session folder that should contain Chrome data
        const sessionFolders = sessionContents.filter(item => 
          item.isDirectory() && item.name.startsWith('session')
        );
        
        if (sessionFolders.length > 0) {
          console.log('✅ Found session folders:', sessionFolders.map(f => f.name));
          
          // Check what's inside the session folder
          const sessionFolder = sessionFolders[0];
          const sessionFolderPath = path.join(this.sessionPath, sessionFolder.name);
          const sessionFolderContents = fs.readdirSync(sessionFolderPath);
          console.log(`📂 Contents of ${sessionFolder.name}:`, sessionFolderContents.slice(0, 10)); // First 10 items
          
          // Check for critical Chrome profile files
          const criticalFiles = ['Default', 'Local State', 'Preferences'];
          const foundFiles = criticalFiles.filter(file => 
            sessionFolderContents.includes(file)
          );
          console.log('🔍 Critical Chrome files found:', foundFiles);
          
          if (foundFiles.length === 0) {
            console.log('⚠️ WARNING: No critical Chrome profile files found - session may be corrupted');
          }
        } else {
          console.log('⚠️ WARNING: Session directory exists but no session folders found');
        }
      } catch (err) {
        console.warn('⚠️ Could not read session directory:', err.message);
      }
    } else {
      console.log('📂 No existing session directory found - first time setup');
    }
    
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

    // ENHANCED DEBUG: Create LocalAuth with extensive logging
    console.log('🔧 Creating LocalAuth strategy...');
    const clientId = 'whatsapp-monitor-session';
    
    console.log('📋 LocalAuth configuration:');
    console.log('   - clientId:', clientId);
    console.log('   - dataPath:', this.sessionPath);
    
    const authStrategy = new LocalAuth({
      clientId: clientId,
      dataPath: this.sessionPath
    });

    console.log('✅ LocalAuth strategy created');

    // MINIMAL Puppeteer configuration to avoid conflicts
    const puppeteerConfig = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
      // Remove ALL other args that might cause issues
    };

    console.log('🔧 Creating WhatsApp Client...');
    console.log('📋 Client configuration:');
    console.log('   - authStrategy: LocalAuth with clientId', clientId);
    console.log('   - puppeteer headless:', puppeteerConfig.headless);
    console.log('   - puppeteer args:', puppeteerConfig.args);

    this.client = new Client({
      authStrategy: authStrategy,
      puppeteer: puppeteerConfig,
      // Remove all other options that might interfere
    });

    console.log('✅ WhatsApp Client created');

    this.setupEventHandlers();
    
    // Initialize the client
    console.log('🚀 Starting WhatsApp client initialization...');
    console.log('⏳ Please wait - checking for existing session...');
    
    this.client.initialize();
  }

  setupEventHandlers() {
    // QR Code event - with enhanced logging
    this.client.on('qr', (qr) => {
      console.log('📱 QR Code received - This means session restoration FAILED');
      console.log('🔍 Reasons for QR code request:');
      console.log('   1. First time setup (expected)');
      console.log('   2. Session directory empty or corrupted');
      console.log('   3. WhatsApp session expired (rare)');
      console.log('   4. Chrome profile corrupted');
      
      // Check session directory again when QR is requested
      const sessionExists = fs.existsSync(this.sessionPath);
      console.log('📂 Session directory exists when QR requested:', sessionExists);
      
      if (sessionExists) {
        try {
          const contents = fs.readdirSync(this.sessionPath);
          console.log('📁 Session directory contents when QR requested:', contents);
        } catch (err) {
          console.log('❌ Cannot read session directory:', err.message);
        }
      }
      
      qrcode.toDataURL(qr, (err, url) => {
        if (err) {
          console.error('Error generating QR code:', err);
          return;
        }
        console.log('📱 QR Code generated successfully');
        this.io.emit('qr', url);
      });
    });

    // Loading screen - helps debug what's happening
    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading: ${percent}% - ${message}`);
      this.io.emit('loading_progress', { percent, message });
    });

    // Authentication events with enhanced logging
    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp client authenticated successfully!');
      console.log('💾 Session should now be saved to:', this.sessionPath);
      
      // Check if session was actually created
      setTimeout(() => {
        const sessionExists = fs.existsSync(this.sessionPath);
        console.log('📂 Session directory exists after authentication:', sessionExists);
        
        if (sessionExists) {
          try {
            const contents = fs.readdirSync(this.sessionPath);
            console.log('📁 Session directory contents after auth:', contents);
          } catch (err) {
            console.log('❌ Cannot read session after auth:', err.message);
          }
        }
      }, 2000); // Check after 2 seconds
      
      this.isAuthenticated = true;
      this.io.emit('authenticated');
    });

    // Ready event with enhanced logging
    this.client.on('ready', async () => {
      console.log('✅ WhatsApp client is ready!');
      this.isReady = true;
      
      // Final check of session directory
      const sessionExists = fs.existsSync(this.sessionPath);
      console.log('💾 Final session check - directory exists:', sessionExists);
      
      if (sessionExists) {
        try {
          const contents = fs.readdirSync(this.sessionPath, { withFileTypes: true });
          console.log('📁 Final session directory structure:');
          contents.forEach(item => {
            if (item.isDirectory()) {
              console.log(`   📁 ${item.name}/`);
              try {
                const subContents = fs.readdirSync(path.join(this.sessionPath, item.name));
                console.log(`      Files: ${subContents.length} items`);
              } catch (e) {
                console.log(`      Cannot read subdirectory: ${e.message}`);
              }
            } else {
              console.log(`   📄 ${item.name}`);
            }
          });
        } catch (err) {
          console.log('❌ Cannot read final session:', err.message);
        }
      } else {
        console.log('❌ CRITICAL: Session directory does not exist after ready!');
      }
      
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
      console.log('🔍 Possible reasons:');
      console.log('   1. Session files corrupted');
      console.log('   2. WhatsApp session expired');
      console.log('   3. Phone disconnected from internet');
      console.log('   4. Chrome profile corruption');
      
      // Check session state during auth failure
      const sessionExists = fs.existsSync(this.sessionPath);
      console.log('📂 Session exists during auth failure:', sessionExists);
      
      this.isAuthenticated = false;
      this.isReady = false;
      
      this.io.emit('auth_failure', msg);
    });

    // Enhanced disconnection handling
    this.client.on('disconnected', (reason) => {
      console.log('🔌 WhatsApp client disconnected:', reason);
      console.log('💾 Session directory exists after disconnect:', fs.existsSync(this.sessionPath));
      
      this.isAuthenticated = false;
      this.isReady = false;
      
      // Save current state before handling disconnection
      this.saveSessionData();
      
      // Only reset group selection if this was a manual logout
      if (reason === 'User logged out' || reason === 'LOGOUT') {
        console.log('🔓 Manual logout detected - clearing session data');
        this.selectedGroup = null;
        this.selectedUser = null;
        this.messageHistory = [];
        this.groupsCache = null;
      }
      
      this.io.emit('disconnected', reason);
    });

    // Message handling
    this.client.on('message', async (message) => {
      await this.handleIncomingMessage(message);
    });

    // Add connection state monitoring
    this.client.on('change_state', (state) => {
      console.log('📱 WhatsApp state changed:', state);
      this.io.emit('state_change', state);
    });

    // Add additional debug events
    this.client.on('group_join', (notification) => {
      console.log('👥 Group join event:', notification);
    });

    this.client.on('group_leave', (notification) => {
      console.log('👥 Group leave event:', notification);
    });
  }

  // Rest of your methods remain the same...
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
        return this.groupsCache;
      }
    }
    
    return await this.fetchGroupsOptimized();
  }

  isClientReady() {
    return this.isReady && this.isAuthenticated && this.client;
  }

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
    this.messageHistory.push(messageData);
    
    if (this.messageHistory.length > 1000) {
      this.messageHistory = this.messageHistory.slice(-1000);
    }
    
    const grouped = MessageUtils.groupMessages([messageData]);
    if (grouped.length > 0) {
      this.rssManager.updateFeed(grouped[0], this.messageHistory);
      this.io.emit('new_message', grouped[0]);
    }
    
    FileUtils.updateMediaIndex(this.messageHistory);
    this.saveSessionData();
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

    const newMessages = processedMessages.filter(
      msg => !this.messageHistory.some(existing => existing.id === msg.id)
    );
    
    this.messageHistory = MessageUtils.sortMessagesByTimestamp([...this.messageHistory, ...newMessages]);
    
    if (this.messageHistory.length > 1000) {
      this.messageHistory = this.messageHistory.slice(-1000);
    }
    
    FileUtils.updateMediaIndex(this.messageHistory);
    
    const filteredMessages = MessageUtils.filterMessagesByUser(processedMessages, this.selectedUser);
    const grouped = MessageUtils.groupMessages(filteredMessages.reverse());
    grouped.forEach(group => this.rssManager.updateFeed(group, this.messageHistory));
    
    this.saveSessionData();
    
    return grouped;
  }

  getMessages(grouped = true) {
    if (grouped) {
      return MessageUtils.groupMessages(this.messageHistory);
    }
    return this.messageHistory;
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
      workingDirectory: process.cwd()
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