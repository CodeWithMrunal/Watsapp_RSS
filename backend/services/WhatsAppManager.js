const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const FileUtils = require('../utils/fileUtils');
const MessageUtils = require('../utils/messageUtils');
const WhatsAppStateChecker = require('./WhatsAppStateChecker');
const WhatsAppLoadingManager = require('./WhatsAppLoadingManager');

class WhatsAppManager {
  constructor(io, rssManager, userId, userDataPath) {
    this.client = null;
    this.io = io;
    this.rssManager = rssManager;
    this.userId = userId;
    this.userDataPath = userDataPath;
    this.isAuthenticated = false;
    this.isReady = false;
    this.selectedGroup = null;
    this.selectedUser = null;
    this.messageHistory = [];
    this.groupsCache = null;
    this.groupsCacheTime = null;
    this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache
    this.lastActivity = Date.now();
    this.initializationAttempts = 0;
    this.maxAttempts = 3;
  }

  async initialize() {
    console.log(`🔄 Initializing WhatsApp client for user ${this.userId}...`);
    
    // Check if already initializing or ready
    if (this.isInitializing) {
      console.log(`⏳ Already initializing for user ${this.userId}`);
      return;
    }
    
    if (this.client && this.isReady) {
      console.log(`✅ Client already ready for user ${this.userId}`);
      return;
    }
    
    this.isInitializing = true;
    this.initializationAttempts++;

    // If client exists but not ready, destroy it first
    if (this.client) {
      console.log(`🗑️ Destroying existing client for user ${this.userId}...`);
      try {
        await this.destroy();
      } catch (error) {
        console.warn(`⚠️ Error destroying existing client for user ${this.userId}:`, error);
      }
    }

    // Reset state
    this.isAuthenticated = false;
    this.isReady = false;
    this.selectedGroup = null;
    this.selectedUser = null;
    this.messageHistory = [];
    this.groupsCache = null;
    this.groupsCacheTime = null;

    try {
      // Create user-specific paths
      const authPath = path.join(this.userDataPath.auth, 'session');
      const userDataDir = path.join(this.userDataPath.auth, `chrome-data-${this.userId}`);
      
      // Ensure directories exist
      await fs.ensureDir(authPath);
      await fs.ensureDir(userDataDir);
      
      // Use whatsapp-web.js bundled puppeteer configuration
      const puppeteerOptions = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--allow-running-insecure-content',
          `--user-data-dir=${userDataDir}`
        ],
        // Don't specify executablePath - let whatsapp-web.js handle it
      };

      // Only specify executablePath if Chrome is installed in standard location
      if (process.platform === 'darwin' && fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')) {
        puppeteerOptions.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      }
      
      // Create new client with user-specific configuration
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: `user_${this.userId}`,
          dataPath: authPath
        }),
        puppeteer: puppeteerOptions,
        qrMaxRetries: 5,
        authTimeoutMs: 60000,
        // Prevent session takeover
        takeoverOnConflict: false,
        takeoverTimeoutMs: 0
      });

      this.setupEventHandlers();
      
      // Initialize the client with timeout
      const initTimeout = setTimeout(() => {
        console.error(`❌ Initialization timeout for user ${this.userId}`);
        this.handleInitializationError(new Error('Initialization timeout'));
      }, 60000); // 60 second timeout

      await this.client.initialize();
      clearTimeout(initTimeout);
      
      console.log(`✅ WhatsApp client initialization started for user ${this.userId}`);
      this.isInitializing = false;
      
    } catch (error) {
      console.error(`❌ Error initializing WhatsApp client for user ${this.userId}:`, error);
      this.handleInitializationError(error);
    }
  }

  handleInitializationError(error) {
    this.isInitializing = false;
    this.io.emit('error', { 
      message: `Failed to initialize WhatsApp client: ${error.message}`,
      retry: this.initializationAttempts < this.maxAttempts
    });
    
    if (this.initializationAttempts < this.maxAttempts) {
      console.log(`🔄 Retrying initialization for user ${this.userId} (attempt ${this.initializationAttempts}/${this.maxAttempts})`);
      setTimeout(() => {
        this.initialize();
      }, 5000); // Retry after 5 seconds
    } else {
      console.error(`❌ Max initialization attempts reached for user ${this.userId}`);
      throw error;
    }
  }

  setupEventHandlers() {
    if (!this.client) return;

    this.client.on('qr', async (qr) => {
      console.log(`📱 QR Code received for user ${this.userId}`);
      try {
        const qrDataUrl = await qrcode.toDataURL(qr);
        this.io.emit('qr', qrDataUrl);
      } catch (err) {
        console.error(`Error generating QR code for user ${this.userId}:`, err);
      }
    });

    this.client.on('ready', async () => {
      console.log(`✅ WhatsApp client is ready for user ${this.userId}!`);
      this.isAuthenticated = true;
      this.isReady = true;
      this.isInitializing = false;
      this.initializationAttempts = 0;
      this.lastActivity = Date.now();
      
      // Initialize loading manager for this user
      WhatsAppLoadingManager.initializeUser(this.userId);
      
      // Start monitoring loading progress
      WhatsAppLoadingManager.monitorLoadingProgress(this.client, this.userId, this.io);
      
      // Wait for WhatsApp to be FULLY ready before pre-fetching
      setTimeout(async () => {
        try {
          const fullyReady = await WhatsAppStateChecker.waitForFullReady(this.client, 15000);
          if (fullyReady) {
            console.log(`🚀 WhatsApp fully loaded for user ${this.userId}, pre-fetching groups...`);
            const groups = await this.prefetchGroups();
            
            // Emit event that groups are ready
            if (groups && groups.length > 0) {
              this.io.emit('whatsapp_fully_loaded', {
                userId: this.userId,
                groupCount: groups.length,
                groups: groups.slice(0, 10)
              });
            }
          } else {
            console.log(`⚠️ WhatsApp not fully ready for user ${this.userId}, skipping pre-fetch`);
          }
        } catch (err) {
          console.error(`Error during pre-fetch for user ${this.userId}:`, err);
        }
      }, 5000); // Wait 5 seconds after ready event
      
      this.io.emit('ready');
      this.io.emit('authenticated');
    });

    this.client.on('authenticated', () => {
      console.log(`🔐 WhatsApp client authenticated for user ${this.userId}`);
      this.isAuthenticated = true;
      this.lastActivity = Date.now();
    });

    this.client.on('auth_failure', (msg) => {
      console.error(`❌ Authentication failed for user ${this.userId}:`, msg);
      this.isAuthenticated = false;
      this.isReady = false;
      this.isInitializing = false;
      this.io.emit('auth_failure', msg);
    });

    this.client.on('disconnected', (reason) => {
      console.log(`🔌 WhatsApp client disconnected for user ${this.userId}:`, reason);
      this.isAuthenticated = false;
      this.isReady = false;
      this.isInitializing = false;
      this.selectedGroup = null;
      this.selectedUser = null;
      this.messageHistory = [];
      this.groupsCache = null;
      this.io.emit('disconnected', reason);
    });

    this.client.on('message', async (message) => {
      this.lastActivity = Date.now(); // Update activity
      await this.handleIncomingMessage(message);
    });

    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading for user ${this.userId}: ${percent}% - ${message}`);
      this.io.emit('loading_progress', { percent, message });
    });

    // Handle client errors
    this.client.on('error', (error) => {
      console.error(`❌ Client error for user ${this.userId}:`, error);
      this.io.emit('error', { message: error.message });
    });
  }

 // Gracefully destroy the client
  async destroy() {
    try {
      if (this.client) {
        // Remove all event listeners first
        this.client.removeAllListeners();
        
        // Try to destroy the client
        await this.client.destroy();
        this.client = null;
      }
    } catch (error) {
      console.error(`Error destroying client for user ${this.userId}:`, error);
    } finally {
      this.client = null;
      this.isAuthenticated = false;
      this.isReady = false;
      this.isInitializing = false;
    }
  }

  // Pre-fetch groups in background
  async prefetchGroups() {
    try {
      console.log(`🔄 Pre-fetching groups in background for user ${this.userId}...`);
      
      // Wait a bit for WhatsApp to fully load chats
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts) {
        try {
          const groups = await this.fetchGroupsOptimized();
          
          if (groups.length > 0) {
            console.log(`✅ Pre-fetched ${groups.length} groups for user ${this.userId}`);
            
            // Update loading manager and emit events
            if (typeof WhatsAppLoadingManager !== 'undefined') {
              WhatsAppLoadingManager.markAsFullyLoaded(this.userId, groups.length);
            }
            
            // Emit loading progress and fully loaded events
            this.io.emit('loading_progress', {
              groupsLoaded: groups.length,
              totalGroups: groups.length,
              isFullyLoaded: true,
              state: 'ready',
              estimatedTimeRemaining: null
            });
            
            this.io.emit('whatsapp_fully_loaded', {
              userId: this.userId,
              groupsAvailable: groups.length
            });
            
            return groups;
          }
          
          console.log(`⏳ No groups found yet for user ${this.userId}, waiting...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          attempts++;
          
        } catch (error) {
          console.log(`⏳ WhatsApp still loading for user ${this.userId}: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          attempts++;
        }
      }
      
      console.warn(`⚠️ Could not prefetch groups after ${maxAttempts} attempts for user ${this.userId}`);
      
    } catch (error) {
      console.error(`Error pre-fetching groups for user ${this.userId}:`, error);
    }
  }

  async fetchGroupsOptimized(retryCount = 0) {
    console.log(`📋 Fetching groups for user ${this.userId}... (attempt ${retryCount + 1})`);
    
    if (!this.client || !this.isReady) {
      throw new Error('Client not ready');
    }
    
    const startTime = Date.now();
    
    try {
    // Add a delay on first attempt to ensure WhatsApp is ready
    if (retryCount === 0) {
      console.log(`⏳ Waiting for WhatsApp to stabilize...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  catch(e){
    console.log("abcd");
  }
    // Check if page is still active
    try {
      await this.client.pupPage.evaluate(() => {
        return window.Store ? true : false;
      });
    } catch (e) {
      console.log(`⚠️ Page evaluation failed, WhatsApp might be reloading`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    try {
      // Method 1: Try using the built-in getChats method first
      const allChats = await this.client.getChats();
      console.log(`📊 Found ${allChats.length} total chats for user ${this.userId}`);
      
      // Filter for groups
      const groups = allChats
        .filter(chat => chat.isGroup)
        .map(chat => ({
          id: chat.id._serialized,
          name: chat.name || 'Unnamed Group',
          participantCount: chat.participants?.length || 0,
          lastMessage: chat.lastMessage?.body?.substring(0, 50) || '',
          timestamp: chat.timestamp || 0,
          unreadCount: chat.unreadCount || 0
        }));
      
      const fetchTime = Date.now() - startTime;
      console.log(`✅ Fetched ${groups.length} groups in ${fetchTime}ms for user ${this.userId}`);
      
      // Update loading manager with actual group count
      if (typeof WhatsAppLoadingManager !== 'undefined') {
        WhatsAppLoadingManager.updateGroupCount(this.userId, groups.length);
        
        // If groups were found, mark as fully loaded
        if (groups.length > 0) {
          WhatsAppLoadingManager.markAsFullyLoaded(this.userId, groups.length);
          
          // Emit the fully loaded event
          this.io.emit('whatsapp_fully_loaded', {
            userId: this.userId,
            groupsAvailable: groups.length
          });
        }
      }
      
      // Cache the results
      this.groupsCache = groups;
      this.groupsCacheTime = Date.now();
      
      return groups;
      
    } catch (error) {
      console.error(`Error with getChats method for user ${this.userId}:`, error.message);
      
      // Method 2: Fallback to page evaluation if getChats fails
      try {
        console.log(`🔄 Trying alternate method for user ${this.userId}...`);
        
        const groups = await this.client.pupPage.evaluate(() => {
          try {
            // Multiple ways to access the Store
            const Store = window.Store || window.mR?.findModule('Chat')[0] || window.webpackChunkwhatsapp_web_client?.default?.Chat;
            
            if (!Store || !Store.Chat) {
              console.error('Store.Chat not available');
              return [];
            }

            // Get all chats
            const allChats = Store.Chat.getModelsArray ? Store.Chat.getModelsArray() : Store.Chat.models || [];
            console.log(`Found ${allChats.length} chats in Store`);
            
            // Filter and map groups
            const groups = [];
            for (const chat of allChats) {
              try {
                // Check if it's a group
                if (chat && chat.isGroup === true) {
                  groups.push({
                    id: chat.id?._serialized || chat.id?.toString() || '',
                    name: chat.name || chat.title || 'Unnamed Group',
                    participantCount: chat.participants?.length || chat.participantCount || 0,
                    lastMessage: chat.lastMessage?.body?.substring(0, 50) || '',
                    timestamp: chat.timestamp || chat.t || 0,
                    unreadCount: chat.unreadCount || 0
                  });
                }
              } catch (e) {
                console.error('Error processing chat:', e);
              }
            }
            
            console.log(`Filtered ${groups.length} groups from ${allChats.length} chats`);
            return groups;
          } catch (error) {
            console.error('Error in evaluate:', error);
            return [];
          }
        });
        
        const fetchTime = Date.now() - startTime;
        console.log(`✅ Fetched ${groups.length} groups using fallback method in ${fetchTime}ms for user ${this.userId}`);
        
        // Update loading manager
        if (typeof WhatsAppLoadingManager !== 'undefined' && groups.length > 0) {
          WhatsAppLoadingManager.markAsFullyLoaded(this.userId, groups.length);
          
          // Emit the fully loaded event
          this.io.emit('whatsapp_fully_loaded', {
            userId: this.userId,
            groupsAvailable: groups.length
          });
        }
        
        // Cache the results
        this.groupsCache = groups;
        this.groupsCacheTime = Date.now();
        
        return groups;
        
      } catch (fallbackError) {
        console.error(`Error with fallback method for user ${this.userId}:`, fallbackError.message);
        
        // If we have cached groups, return them
        if (this.groupsCache && this.groupsCache.length > 0) {
          console.log(`⚠️ Returning cached groups due to error for user ${this.userId}`);
          return this.groupsCache;
        }
        
        // If no cache and still failing after retries, return empty array
        if (retryCount >= 2) {
          console.warn(`⚠️ Could not fetch groups after ${retryCount + 1} attempts for user ${this.userId}`);
          return [];
        }
        
        // Retry with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
        console.log(`🔄 Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchGroupsOptimized(retryCount + 1);
      }
    }
  }
// Add a method to get loading status
  getLoadingStatus() {
    return WhatsAppLoadingManager.getStatus(this.userId);
  }

  // Also update the ready event to ensure proper initialization
  // setupEventHandlers() {
  //   if (!this.client) return;

  //   this.client.on('qr', async (qr) => {
  //     console.log(`📱 QR Code received for user ${this.userId}`);
  //     try {
  //       const qrDataUrl = await qrcode.toDataURL(qr);
  //       this.io.emit('qr', qrDataUrl);
  //     } catch (err) {
  //       console.error(`Error generating QR code for user ${this.userId}:`, err);
  //     }
  //   });

  //   this.client.on('ready', async () => {
  //     console.log(`✅ WhatsApp client is ready for user Yay ${this.userId}!`);
  //     this.isAuthenticated = true;
  //     this.isReady = true;
  //     this.isInitializing = false;
  //     this.initializationAttempts = 0;
  //     this.lastActivity = Date.now();
      
  //     WhatsAppLoadingManager.initializeUser(this.userId);
      
  //     // Start monitoring loading progress
  //     WhatsAppLoadingManager.monitorLoadingProgress(this.client, this.userId, this.io);
      
  //     // Wait for WhatsApp to be FULLY ready before pre-fetching
  //     setTimeout(async () => {
  //       try {
  //         const fullyReady = await WhatsAppStateChecker.waitForFullReady(this.client, 15000);
  //         if (fullyReady) {
  //           console.log(`🚀 WhatsApp fully loaded for user ${this.userId}, pre-fetching groups...`);
  //           await this.prefetchGroups();
  //         } else {
  //           console.log(`⚠️ WhatsApp not fully ready for user ${this.userId}, skipping pre-fetch`);
  //         }
  //       } catch (err) {
  //         console.error(`Error during pre-fetch for user ${this.userId}:`, err);
  //       }
  //     }, 5000); // Wait 5 seconds after ready event
      
  //     this.io.emit('ready');
  //     this.io.emit('authenticated');
  //   });
  // }

  async checkAndHandleIdleState() {
    const idleTime = Date.now() - this.lastActivity;
    const IDLE_THRESHOLD = 2 * 60 * 1000; // 2 minutes
    
    if (idleTime > IDLE_THRESHOLD) {
      console.log(`⚠️ Client ${this.userId} was idle for ${Math.round(idleTime / 1000)}s`);
      
      // Check connection state
      try {
        const state = await this.client.getState();
        console.log(`WhatsApp state for user ${this.userId}: ${state}`);
        
        if (state !== 'CONNECTED') {
          console.log(`🔄 Reconnecting WhatsApp for user ${this.userId}...`);
          // Wait for reconnection
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        // Clear cache to force fresh data
        this.groupsCache = null;
        this.groupsCacheTime = null;
        
        // Wait for WhatsApp to stabilize
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.error(`Error checking state for user ${this.userId}:`, error);
      }
    }
    
    // Update last activity
    this.lastActivity = Date.now();
  }

  async getGroups() {
    console.log(`📋 Getting groups for user ${this.userId}...`);
    
    // Check if client is ready
    if (!this.isReady || !this.client) {
      throw new Error('WhatsApp client not ready. Please wait a moment and try again.');
    }
    
    // Check and handle idle state
    await this.checkAndHandleIdleState();
    
    // Clear cache if requested to force refresh
    if (this.shouldRefreshGroups) {
      this.groupsCache = null;
      this.groupsCacheTime = null;
      this.shouldRefreshGroups = false;
    }
    
    // Return cached groups if available and fresh
    if (this.groupsCache && this.groupsCacheTime) {
      const cacheAge = Date.now() - this.groupsCacheTime;
      if (cacheAge < this.CACHE_DURATION && this.groupsCache.length > 0) {
        console.log(`📦 Returning ${this.groupsCache.length} cached groups for user ${this.userId}`);
        return this.groupsCache;
      }
    }
    
    // Fetch fresh groups
    try {
      const groups = await this.fetchGroupsOptimized();
      
      // Emit event that groups are ready
      if (groups.length > 0) {
        this.io.emit('groups_fetched', {
          count: groups.length,
          userId: this.userId
        });
      }
      
      return groups;
    } catch (error) {
      console.error(`Error fetching groups for user ${this.userId}:`, error);
      
      // If fetch fails, return cached groups if available
      if (this.groupsCache && this.groupsCache.length > 0) {
        console.log(`⚠️ Using stale cache (${this.groupsCache.length} groups) due to fetch error for user ${this.userId}`);
        return this.groupsCache;
      }
      
      // If no cache, return empty array instead of throwing
      console.warn(`⚠️ No groups available for user ${this.userId}`);
      return [];
    }
  }

  // Add method to force refresh groups
  refreshGroups() {
    console.log(`🔄 Forcing group refresh for user ${this.userId}`);
    this.shouldRefreshGroups = true;
    this.groupsCache = null;
    this.groupsCacheTime = null;
  }

  // Add method to check if client is ready
  isClientReady() {
    return this.isReady && this.isAuthenticated && this.client && !this.isInitializing;
  }

  // Rest of your methods remain the same...
  async handleIncomingMessage(message) {
    console.log(`Received message for user ${this.userId}:`, message.body || `[${message.type}]`);
    
    if (!this.selectedGroup || !message.from.includes('@g.us')) return;
    if (message.from !== this.selectedGroup.id) return;
    if (this.selectedUser && message.author !== this.selectedUser) return;
    
    let mediaPath = null;

    if (message.hasMedia) {
      console.log(`📦 Message has media for user ${this.userId}. Type: ${message.type}`);
      mediaPath = await this.downloadMedia(message);
    }

    const messageData = MessageUtils.createMessageData(message, mediaPath);
    this.messageHistory.push(messageData);
    
    const grouped = MessageUtils.groupMessages([messageData]);
    if (grouped.length > 0) {
      this.rssManager.updateFeed(grouped[0], this.messageHistory);
      this.io.emit('new_message', grouped[0]);
    }
    
    // Use user-specific path
    const userMediaPath = path.join(this.userDataPath.media, 'media.json');
    FileUtils.updateMediaIndex(this.messageHistory, userMediaPath);
  }

  async downloadMedia(message) {
    try {
      console.log(`🎬 Starting media download for user ${this.userId}, message ${message.id.id}`);
      
      const media = await message.downloadMedia();
      if (!media || !media.data) {
        console.error(`❌ Media download failed for user ${this.userId} - no media data`);
        return null;
      }

      // Save to user-specific media directory
      const ext = media.mimetype.split('/')[1] || 'bin';
      const filename = `media_${Date.now()}_${message.id.id}.${ext}`;
      const mediaPath = path.join(this.userDataPath.media, filename);
      
      await fs.ensureDir(path.dirname(mediaPath));
      await fs.writeFile(mediaPath, media.data, { encoding: 'base64' });
      
      console.log(`✅ Media saved for user ${this.userId}: ${mediaPath}`);
      
      // Return relative path
      return path.join(`user_${this.userId}`, filename);
      
    } catch (err) {
      console.error(`❌ Error downloading media for user ${this.userId}:`, err);
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
    
    const userMediaPath = path.join(this.userDataPath.media, 'media.json');
    FileUtils.updateMediaIndex(this.messageHistory, userMediaPath);
    
    const filteredMessages = MessageUtils.filterMessagesByUser(processedMessages, this.selectedUser);
    const grouped = MessageUtils.groupMessages(filteredMessages.reverse());
    
    grouped.forEach(group => this.rssManager.updateFeed(group, this.messageHistory));
    
    return grouped;
  }

  getMessages(grouped = true) {
    if (grouped) {
      return MessageUtils.groupMessages(this.messageHistory);
    }
    return this.messageHistory;
  }

  async logout() {
    console.log(`🔓 Logging out WhatsApp session for user ${this.userId}...`);
    
    try {
      await this.destroy();
      
      // Clean up user auth data
      const authPath = this.userDataPath.auth;
      if (fs.existsSync(authPath)) {
        await fs.remove(authPath);
        console.log(`🗑️ Deleted auth data for user ${this.userId}`);
      }
      
      this.io.emit('disconnected', 'User logged out');
      console.log(`✅ Logout completed successfully for user ${this.userId}`);
      
    } catch (error) {
      console.error(`❌ Error during logout for user ${this.userId}:`, error);
      this.io.emit('disconnected', 'Logout error but state reset');
      throw error;
    }
  }

// Update getStatus to include loading info
  getStatus() {
    const loadingStatus = typeof WhatsAppLoadingManager !== 'undefined' 
      ? WhatsAppLoadingManager.getStatus(this.userId) 
      : { state: 'unknown', groupsFound: 0, isFullyLoaded: false };
      
    return {
      authenticated: this.isAuthenticated,
      ready: this.isReady,
      initializing: this.isInitializing,
      selectedGroup: this.selectedGroup?.name || null,
      selectedUser: this.selectedUser || null,
      cachedGroups: this.groupsCache?.length || 0,
      lastActivity: this.lastActivity,
      loading: {
        state: loadingStatus.state,
        groupsLoaded: this.groupsCache?.length || loadingStatus.groupsFound || 0,
        isFullyLoaded: loadingStatus.isFullyLoaded || (this.groupsCache?.length > 0),
        estimatedTimeRemaining: loadingStatus.estimatedTimeRemaining
      }
    };
  }
  get messageHistory() {
    return this._messageHistory || [];
  }

  set messageHistory(value) {
    this._messageHistory = value;
  }
}

module.exports = WhatsAppManager;