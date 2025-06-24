const RSSManager = require('./RSSManager');
const config = require('../config');

class RSSManagerFactory {
  constructor() {
    this.managers = new Map(); // userId -> RSSManager instance
  }

  /**
   * Create an RSS manager for a specific user
   */
  createForUser(userId) {
    if (!this.managers.has(userId)) {
      // Create user-specific RSS configuration
      const userConfig = {
        ...config.rss,
        feed_url: `http://localhost:3001/rss/user/${userId}/feed.xml`,
        site_url: `http://localhost:3001/user/${userId}`,
        title: `WhatsApp Monitor Feed - User ${userId}`,
        outputPath: `./rss/user_${userId}/feed.xml`
      };
      
      const manager = new RSSManager(userConfig, userId);
      this.managers.set(userId, manager);
      
      console.log(`📡 Created RSS manager for user ${userId}`);
    }
    
    return this.managers.get(userId);
  }

  /**
   * Get RSS manager for a user
   */
  getManager(userId) {
    return this.managers.get(userId);
  }

  /**
   * Remove RSS manager for a user
   */
  removeManager(userId) {
    if (this.managers.has(userId)) {
      this.managers.delete(userId);
      console.log(`🗑️ Removed RSS manager for user ${userId}`);
    }
  }
}

module.exports = RSSManagerFactory;