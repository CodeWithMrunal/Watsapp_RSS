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
    this.isProcessingQueue = false; // Flag to track if queue is being processed
    
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
    }
    
    return this.managers.get(userId);
  }

  /**
   * Initialize manager with queue
   */
  async initializeManager(userId) {
    const manager = await this.getManager(userId);
    
    // Add to queue if not already initializing
    if (!manager.isInitializing && !manager.isReady) {
      this.initializationQueue.push({ manager, userId });
      
      // Start processing queue if not already doing so
      if (!this.isProcessingQueue) {
        this.processInitializationQueue();
      }
    }
    
    return manager;
  }

  /**
   * Process initialization queue with proper spacing
   */
  async processInitializationQueue() {
    if (this.initializationQueue.length === 0) {
      this.isProcessingQueue = false;
      return;
    }

    this.isProcessingQueue = true;
    const { manager, userId } = this.initializationQueue.shift();

    try {
      console.log(`🔄 Processing initialization for user ${userId}`);
      
      // Wait before initialization to avoid Chrome conflicts
      const activeManagers = Array.from(this.managers.values()).filter(m => m.isInitializing).length;
      if (activeManagers > 0) {
        console.log(`⏳ Waiting ${5 * activeManagers} seconds before initializing user ${userId}...`);
        await new Promise(resolve => setTimeout(resolve, 5000 * activeManagers));
      }
      
      // Initialize the manager
      await manager.initialize();
      
    } catch (error) {
      console.error(`❌ Error initializing manager for user ${userId}:`, error);
      this.emitToUser(userId, 'error', { 
        message: 'Failed to initialize WhatsApp. Please try again.' 
      });
    }

    // Process next in queue after a delay
    setTimeout(() => {
      this.processInitializationQueue();
    }, 2000);
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
      
      // Remove from queue if present
      this.initializationQueue = this.initializationQueue.filter(item => item.userId !== userId);
      
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
      `./.wwebjs_auth/user_${userId}/chrome-data-${userId}`
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