const WhatsAppManager = require('./WhatsAppManager');
const { WhatsAppSession } = require('../models');
const path = require('path');
const fs = require('fs-extra');

class WhatsAppManagerPool {
  constructor(io, rssManagerFactory) {
    this.io = io;
    this.rssManagerFactory = rssManagerFactory;
    this.managers = new Map(); // userId -> WhatsAppManager instance
    this.userSockets = new Map(); // userId -> Set of socket IDs
    this.initializationQueue = []; // Queue for initialization
    this.isInitializing = false; // Flag to track if initialization is in progress
    
    console.log('✅ WhatsAppManagerPool initialized');
  }

  /**
   * Get or create a WhatsApp manager for a user
   */
  async getManager(userId) {
    if (!this.managers.has(userId)) {
      // Create user-specific directories
      this.ensureUserDirectories(userId);
      
      // Create RSS manager for this user
      const rssManager = this.rssManagerFactory.createForUser(userId);
      
      // Create WhatsApp manager with user-specific configuration
      const manager = new WhatsAppManager(
        this.createUserIoWrapper(userId), 
        rssManager,
        userId,
        this.getUserDataPath(userId)
      );
      
      this.managers.set(userId, manager);
      console.log(`✅ Created WhatsApp manager for user ${userId}`);
      
      // Add to initialization queue instead of initializing immediately
      this.queueInitialization(manager, userId);
    }
    
    return this.managers.get(userId);
  }

  /**
   * Queue initialization to prevent conflicts
   */
  async queueInitialization(manager, userId) {
    this.initializationQueue.push({ manager, userId });
    
    // If not currently initializing, start processing queue
    if (!this.isInitializing) {
      this.processInitializationQueue();
    }
  }

  /**
   * Process initialization queue with delays
   */
  async processInitializationQueue() {
    if (this.initializationQueue.length === 0) {
      this.isInitializing = false;
      return;
    }

    this.isInitializing = true;
    const { manager, userId } = this.initializationQueue.shift();

    try {
      console.log(`🔄 Processing initialization for user ${userId}`);
      
      // Add delay before initialization to prevent Chrome conflicts
      if (this.managers.size > 1) {
        console.log(`⏳ Waiting 3 seconds before initializing user ${userId}...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // Initialize the manager
      await manager.initialize();
      
    } catch (error) {
      console.error(`❌ Error initializing manager for user ${userId}:`, error);
      this.emitToUser(userId, 'error', { 
        message: 'Failed to initialize WhatsApp. Please try again.' 
      });
    }

    // Process next in queue
    setTimeout(() => {
      this.processInitializationQueue();
    }, 1000); // Small delay between initializations
  }

  /**
   * Create a user-specific IO wrapper
   */
  createUserIoWrapper(userId) {
    return {
      emit: (event, data) => {
        this.emitToUser(userId, event, data);
      }
    };
  }

  /**
   * Remove a manager (cleanup when user logs out)
   */
  async removeManager(userId) {
    const manager = this.managers.get(userId);
    if (manager) {
      try {
        // Destroy WhatsApp client if exists
        await manager.destroy();
      } catch (error) {
        console.error(`Error destroying client for user ${userId}:`, error);
      }
      
      this.managers.delete(userId);
      console.log(`🗑️ Removed WhatsApp manager for user ${userId}`);
    }
  }

  /**
   * Register a socket for a user
   */
  addUserSocket(userId, socketId) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId).add(socketId);
    console.log(`📱 Added socket ${socketId} for user ${userId}`);
  }

  /**
   * Remove a socket for a user
   */
  removeUserSocket(userId, socketId) {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }
    console.log(`📱 Removed socket ${socketId} for user ${userId}`);
  }

  /**
   * Emit event to all sockets of a specific user
   */
  emitToUser(userId, event, data) {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.forEach(socketId => {
        this.io.to(socketId).emit(event, data);
      });
    }
  }

  /**
   * Ensure user directories exist
   */
  ensureUserDirectories(userId) {
    const dirs = [
      `./media/user_${userId}`,
      `./rss/user_${userId}`,
      `./backups/user_${userId}`,
      `./.wwebjs_auth/user_${userId}`,
      `./.wwebjs_auth/user_${userId}/session`,
      `./.wwebjs_auth/user_${userId}/chrome-user-data`
    ];
    
    dirs.forEach(dir => {
      fs.ensureDirSync(dir);
    });
    
    console.log(`📁 Created directories for user ${userId}`);
  }

  /**
   * Get user-specific data path
   */
  getUserDataPath(userId) {
    return {
      media: `./media/user_${userId}`,
      rss: `./rss/user_${userId}`,
      backups: `./backups/user_${userId}`,
      auth: `./.wwebjs_auth/user_${userId}`
    };
  }

  /**
   * Load saved session for a user
   */
  async loadUserSession(userId) {
    try {
      const session = await WhatsAppSession.findOne({
        where: { user_id: userId, is_active: true }
      });
      
      if (session && session.session_data) {
        const manager = await this.getManager(userId);
        // Session data would be used to restore WhatsApp connection
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`Error loading session for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Save user session
   */
  async saveUserSession(userId, sessionData) {
    try {
      await WhatsAppSession.upsert({
        user_id: userId,
        session_data: JSON.stringify(sessionData),
        is_active: true,
        last_activity: new Date()
      });
      
      console.log(`💾 Saved session for user ${userId}`);
    } catch (error) {
      console.error(`Error saving session for user ${userId}:`, error);
    }
  }

  /**
   * Get status of all managers
   */
  getAllStatus() {
    const status = {};
    this.managers.forEach((manager, userId) => {
      status[userId] = manager.getStatus();
    });
    return status;
  }

  /**
   * Cleanup inactive managers
   */
  async cleanupInactive() {
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();
    
    for (const [userId, manager] of this.managers.entries()) {
      // Check if user has active sockets
      const hasSockets = this.userSockets.has(userId) && this.userSockets.get(userId).size > 0;
      
      if (!hasSockets && manager.lastActivity && (now - manager.lastActivity) > inactiveThreshold) {
        console.log(`🧹 Cleaning up inactive manager for user ${userId}`);
        await this.removeManager(userId);
      }
    }
  }

  /**
   * Start periodic cleanup
   */
  startCleanupInterval() {
    setInterval(() => {
      this.cleanupInactive();
    }, 5 * 60 * 1000); // Run every 5 minutes
  }
}

module.exports = WhatsAppManagerPool;