const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const FileUtils = require('../utils/fileUtils');
const MessageUtils = require('../utils/messageUtils');

// Add MongoDB imports
const dbConnection = require('../database/connection');
const Message = require('../database/models/Message');
const Media = require('../database/models/Media');
const { Group, Author, Link } = require('../database/models/Group');
const Analytics = require('../database/models/Analytics');

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
    
    // MongoDB connection status
    this.dbConnected = false;
    
    // CRITICAL DEBUG: Let's see what's happening with paths
    console.log('🔍 DEBUG: Current working directory:', process.cwd());
    console.log('🔍 DEBUG: __dirname:', __dirname);
    
    // Session persistence settings - Try different path approaches
    this.sessionPath = path.resolve('./.wwebjs_auth');  // Relative to working directory
    this.sessionDataPath = path.resolve('./session-data.json');
    
    console.log('📂 DEBUG: Session paths:', {
      sessionPath: this.sessionPath,
      sessionDataPath: this.sessionDataPath,
      sessionPathExists: fs.existsSync(this.sessionPath),
      sessionDataExists: fs.existsSync(this.sessionDataPath)
    });
    
    // Initialize session data
    this.loadSessionData();
    
    // Initialize database connection
    this.initializeDatabase();
  }

  // NEW: Initialize database connection
  async initializeDatabase() {
    try {
      if (!this.dbConnected) {
        await dbConnection.connect();
        this.dbConnected = true;
        console.log('✅ MongoDB connected for WhatsApp Manager');
      }
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error);
      // Continue without database - fallback to JSON
    }
  }

  // Load saved session data (keep existing implementation)
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

  // Enhanced save session data with MongoDB sync
  async saveSessionData() {
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
      
      // Also save to MongoDB if connected
      if (this.dbConnected && this.selectedGroup) {
        await this.syncMessagesToDatabase();
      }
    } catch (error) {
      console.warn('⚠️ Could not save session data:', error.message);
    }
  }

  // NEW: Sync messages to MongoDB
  async syncMessagesToDatabase() {
    if (!this.dbConnected || this.messageHistory.length === 0) return;
    
    try {
      const operations = this.messageHistory.map(msg => ({
        updateOne: {
          filter: { id: msg.id },
          update: { $set: msg },
          upsert: true
        }
      }));
      
      if (operations.length > 0) {
        await Message.bulkWrite(operations);
        console.log(`📊 Synced ${operations.length} messages to MongoDB`);
      }
    } catch (error) {
      console.error('❌ Error syncing messages to database:', error);
    }
  }

  // NEW: Create message groups in MongoDB
async createMessageGroups() {
  if (!this.dbConnected || this.messageHistory.length === 0) return;
  
  try {
    // Group messages using MessageUtils
    const groupedMessages = MessageUtils.groupMessages(this.messageHistory);
    
    for (const group of groupedMessages) {
      if (this.selectedGroup && this.selectedGroup.id) {
        // Add groupId to all messages in the group
        group.messages = group.messages.map(msg => ({
          ...msg,
          groupId: msg.groupId || this.selectedGroup.id
        }));
      }
      // Create group metadata with proper structure
      const groupData = {
        id: group.id,
        groupId: this.selectedGroup?.id || group.groupId,
        author: group.author,
        authorNumber: group.author ? group.author.split('@')[0] : null,
        startTimestamp: group.timestamp,
        endTimestamp: group.timestamp,
        startTime: new Date(group.timestamp * 1000),
        endTime: new Date(group.timestamp * 1000),
        duration: 0,
        durationMinutes: 0,
        messageCount: group.messages.length,
        statistics: {
          totalMessages: group.messages.length,
          textMessages: group.messages.filter(m => !m.hasMedia).length,
          mediaMessages: group.messages.filter(m => m.hasMedia).length,
          linkCount: 0,
          mentionCount: 0,
          mediaTypes: {
            image: 0,
            video: 0,
            audio: 0,
            document: 0,
            sticker: 0,
            voice: 0
          }
        },
        messageIds: group.messages.map(m => m.id),
        mediaIds: [],
        linkIds: [],
        averageMessageInterval: 0,
        createdAt: new Date(),
        version: '2.0'
      };
      
      // Count media types
      group.messages.forEach(msg => {
        if (msg.hasMedia && msg.type) {
          const mediaType = msg.type === 'ptt' ? 'voice' : msg.type;
          if (groupData.statistics.mediaTypes.hasOwnProperty(mediaType)) {
            groupData.statistics.mediaTypes[mediaType]++;
          }
        }
      });
      // Save to MongoDB
      await Group.findOneAndUpdate(
        { id: groupData.id },
        { $set: groupData },
        { upsert: true }
      );
    }
    
    console.log(`📊 Created ${groupedMessages.length} message groups in MongoDB`);
  } catch (error) {
    console.error('❌ Error creating message groups:', error);
  }
}
  // Keep all existing initialization and setup methods...
  // (initialize, setupEventHandlers, etc. remain the same)

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
      await this.saveSessionData();
      
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
            
            // Load messages from database if available
            if (this.dbConnected) {
              await this.loadMessagesFromDatabase();
            }
          }
        } catch (error) {
          console.warn(`⚠️ Could not restore previous group: ${error.message}`);
          this.selectedGroup = null;
        }
      }
      
      // Generate daily analytics if database is connected
      if (this.dbConnected) {
        this.scheduleAnalytics();
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

  // NEW: Load messages from database
  async loadMessagesFromDatabase() {
    if (!this.dbConnected || !this.selectedGroup) return;
    
    try {
      const messages = await Message.findByGroup(this.selectedGroup.id, {
        limit: 100,
        sort: -1
      });
      
      if (messages.length > 0) {
        this.messageHistory = messages.map(msg => msg.toObject());
        console.log(`📊 Loaded ${messages.length} messages from MongoDB`);
      }
    } catch (error) {
      console.error('❌ Error loading messages from database:', error);
    }
  }

  // NEW: Schedule analytics generation
  scheduleAnalytics() {
    // Generate analytics daily at midnight
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const timeUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
      this.generateDailyAnalytics();
      // Schedule for every 24 hours
      setInterval(() => this.generateDailyAnalytics(), 24 * 60 * 60 * 1000);
    }, timeUntilMidnight);
    
    console.log(`📊 Analytics scheduled to run at midnight (in ${Math.round(timeUntilMidnight / 1000 / 60)} minutes)`);
  }

  // NEW: Generate daily analytics
  async generateDailyAnalytics() {
    if (!this.dbConnected || !this.selectedGroup) return;
    
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      await Analytics.generateDailyAnalytics(this.selectedGroup.id, yesterday);
      console.log(`📊 Generated daily analytics for ${yesterday.toDateString()}`);
    } catch (error) {
      console.error('❌ Error generating analytics:', error);
    }
  }

  // Rest of your methods remain mostly the same, but with MongoDB integration...
  
  async prefetchGroups() {
    try {
      console.log('🔄 Pre-fetching groups in background...');
      const groups = await this.fetchGroupsOptimized();
      console.log(`✅ Pre-fetched ${groups.length} groups`);
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

  // Enhanced handleIncomingMessage with MongoDB save
  async handleIncomingMessage(message) {
    console.log('Received message:', message.body || `[${message.type}]`);
    
    if (!this.selectedGroup || !message.from.includes('@g.us')) return;
    if (message.from !== this.selectedGroup.id) return;
    if (this.selectedUser && message.author !== this.selectedUser) return;
    
    let mediaPath = null;
    let mediaMetadata = null;

    if (message.hasMedia) {
      console.log(`📦 Message has media. Type: ${message.type}, From: ${message.author}`);
      const mediaResult = await this.downloadMedia(message);
      if (mediaResult) {
        mediaPath = mediaResult.path;
        mediaMetadata = mediaResult.metadata;
      }
    }

    const messageData = MessageUtils.createMessageData(message, mediaPath);
    this.messageHistory.push(messageData);
    
    if (this.messageHistory.length > 1000) {
      this.messageHistory = this.messageHistory.slice(-1000);
    }
    
    // Save to MongoDB if connected
    if (this.dbConnected) {
  try {
    // Save message
    const savedMessage = await Message.create(messageData);
    
    // Save media metadata if exists
    if (mediaMetadata) {
      try {
        // Check if media already exists by fileHash
        let savedMedia = await Media.findOne({ fileHash: mediaMetadata.fileHash });
        
        if (!savedMedia) {
          savedMedia = await Media.create(mediaMetadata);
        } else {
          console.log(`📦 Media already exists with hash: ${mediaMetadata.fileHash}`);
        }
        
        await Message.findByIdAndUpdate(savedMessage._id, {
          mediaId: savedMedia._id
        });
      } catch (mediaError) {
        if (mediaError.code === 11000) {
          // Handle duplicate media
          const existingMedia = await Media.findOne({ fileHash: mediaMetadata.fileHash });
          if (existingMedia) {
            await Message.findByIdAndUpdate(savedMessage._id, {
              mediaId: existingMedia._id
            });
          }
        } else {
          throw mediaError;
        }
      }
    }
        
        // Update author statistics
        await Author.findOrCreateByPhone(message.author);
        
        // Extract and save links
        if (messageData.links && messageData.links.length > 0) {
          for (const link of messageData.links) {
            await Link.create({
              ...link,
              messageId: savedMessage.id,
              groupId: savedMessage.groupId,
              author: savedMessage.author,
              messageTimestamp: savedMessage.timestamp
            });
          }
        }
        
        console.log('✅ Message saved to MongoDB');
      } catch (error) {
        console.error('❌ Error saving to MongoDB:', error);
      }
    }
    
    if (this.dbConnected) {
  const grouped = MessageUtils.groupMessages([messageData]);
  if (grouped.length > 0) {
    const groupData = MessageUtils.createGroupMetadata(grouped[0]);
    await Group.findOneAndUpdate(
      { id: groupData.id },
      { $set: groupData },
      { upsert: true }
    );
  }
}

// Update RSS feed
const grouped = MessageUtils.groupMessages([messageData]);
if (grouped.length > 0) {
  // If database is connected, use DB RSS manager
  if (this.dbConnected && this.rssManager.generateFeed) {
    await this.rssManager.generateFeed({
      groupId: this.selectedGroup.id,
      limit: 50
    });
  } else {
    // Fallback to original RSS manager
    this.rssManager.updateFeed(grouped[0], this.messageHistory);
  }
  
  this.io.emit('new_message', grouped[0]);
}
    
    FileUtils.updateMediaIndex(this.messageHistory);
    await this.saveSessionData();
  }

  // Enhanced downloadMedia to return metadata
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

      // Save media with enhanced metadata
      const messageMetadata = {
        author: message.author,
        groupId: this.selectedGroup.id,
        caption: message.body || '',
        timestamp: message.timestamp,
        isViewOnce: message.isViewOnce || false,
        isForwarded: message.isForwarded || false,
        forwardingScore: message.forwardingScore || 0
      };
      
      return FileUtils.saveMedia(media, message.id.id, messageMetadata);
      
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
    
    // Load messages from database if connected
    if (this.dbConnected) {
      await this.loadMessagesFromDatabase();
    }
    
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
        const existing = this.messageHistory.find(m => m.id === msg.id._serialized);
        let mediaPath = existing?.mediaPath || null;
        let mediaMetadata = null;

        if (existing) {
          console.log(`🔁 Message ${msg.id._serialized} already exists`);
        }

        if (msg.hasMedia && !mediaPath) {
          const mediaResult = await this.downloadMedia(msg);
          if (mediaResult) {
            mediaPath = mediaResult.path;
            mediaMetadata = mediaResult.metadata;
          }
        }

        const messageData = MessageUtils.createMessageData(msg, mediaPath);
        
        // Save to MongoDB if connected and not existing
        // In the fetchHistory method, replace the media saving section with:
if (this.dbConnected && !existing) {
  try {
    const savedMessage = await Message.create(messageData);
    
    if (mediaMetadata) {
      try {
        // Check if media already exists by fileHash
        let savedMedia = await Media.findOne({ fileHash: mediaMetadata.fileHash });
        
        if (!savedMedia) {
          // Create new media entry only if it doesn't exist
          savedMedia = await Media.create(mediaMetadata);
        } else {
          console.log(`📦 Media already exists with hash: ${mediaMetadata.fileHash}`);
        }
        
        // Update message with media reference
        await Message.findByIdAndUpdate(savedMessage._id, {
          mediaId: savedMedia._id
        });
      } catch (mediaError) {
        if (mediaError.code === 11000) {
          // Duplicate key error - media already exists
          console.log('📦 Media already exists, linking to existing entry');
          const existingMedia = await Media.findOne({ fileHash: mediaMetadata.fileHash });
          if (existingMedia) {
            await Message.findByIdAndUpdate(savedMessage._id, {
              mediaId: existingMedia._id
            });
          }
        } else {
          throw mediaError;
        }
      }
    }
  } catch (error) {
    console.error('Error saving historical message:', error);
  }
}
        
        return messageData;
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
    
    // Create groups in MongoDB
if (this.dbConnected) {
  await this.createMessageGroups();
}

const filteredMessages = MessageUtils.filterMessagesByUser(processedMessages, this.selectedUser);
const grouped = MessageUtils.groupMessages(filteredMessages.reverse());

// Update RSS feed
if (this.dbConnected && this.rssManager.generateFeed) {
  // Generate RSS from database
  await this.rssManager.generateFeed({
    groupId: this.selectedGroup.id,
    limit: 50
  });
} else {
  // Fallback to file-based RSS
  grouped.forEach(group => this.rssManager.updateFeed(group, this.messageHistory));
}
    
    await this.saveSessionData();
    
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
      workingDirectory: process.cwd(),
      databaseConnected: this.dbConnected // NEW: Add database status
    };
  }

  async cleanup() {
    console.log('🧹 Cleaning up WhatsApp manager...');
    await this.saveSessionData();
    
    // Close database connection if needed
    if (this.dbConnected) {
      try {
        await dbConnection.disconnect();
        console.log('✅ Database connection closed');
      } catch (error) {
        console.warn('⚠️ Error closing database connection:', error);
      }
    }
    
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