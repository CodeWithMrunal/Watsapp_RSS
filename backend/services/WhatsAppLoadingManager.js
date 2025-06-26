// services/WhatsAppLoadingManager.js
class WhatsAppLoadingManager {
  constructor() {
    this.loadingStatus = new Map(); // userId -> loading status
  }

  /**
   * Initialize loading status for a user
   */
  initializeUser(userId) {
    this.loadingStatus.set(userId, {
      state: 'initializing',
      totalChats: 0,
      loadedChats: 0,
      groupsFound: 0,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      estimatedTimeRemaining: null,
      isFullyLoaded: false
    });
  }

  /**
   * Monitor WhatsApp loading progress
   */
  async monitorLoadingProgress(client, userId, io) {
    console.log(`📊 Starting loading monitor for user ${userId}`);
    
    const status = this.loadingStatus.get(userId) || {};
    let previousGroupCount = 0;
    let stableCount = 0;
    const requiredStableChecks = 3; // Must be stable for 3 checks
    
    const checkInterval = setInterval(async () => {
      try {
        if (!client || !client.pupPage) {
          clearInterval(checkInterval);
          return;
        }

        const result = await client.pupPage.evaluate(() => {
          try {
            if (!window.Store || !window.Store.Chat) {
              return { error: 'Store not ready' };
            }

            const allChats = window.Store.Chat.getModelsArray();
            const groups = allChats.filter(chat => chat && chat.isGroup);
            
            // Check if chats are still loading
            const loadingIndicator = document.querySelector('[data-testid="startup-progress"]');
            const isStillLoading = !!loadingIndicator;
            
            // Count chats with proper data
            const fullyLoadedGroups = groups.filter(chat => {
              try {
                return chat.id && chat.id._serialized && chat.name;
              } catch (e) {
                return false;
              }
            });

            return {
              totalChats: allChats.length,
              totalGroups: groups.length,
              loadedGroups: fullyLoadedGroups.length,
              isStillLoading,
              // Sample some group names for debugging
              sampleGroups: fullyLoadedGroups.slice(0, 5).map(g => g.name)
            };
          } catch (error) {
            return { error: error.message };
          }
        });

        if (result.error) {
          console.log(`⚠️ Error checking progress: ${result.error}`);
          return;
        }

        // Update status
        status.totalChats = result.totalChats;
        status.loadedChats = result.totalChats;
        status.groupsFound = result.loadedGroups;
        status.lastUpdate = Date.now();

        // Calculate progress
        const elapsedTime = Date.now() - status.startTime;
        const progressRate = result.loadedGroups / (elapsedTime / 1000); // groups per second
        
        // Check if loading has stabilized
        if (result.loadedGroups === previousGroupCount && result.loadedGroups > 0) {
          stableCount++;
          if (stableCount >= requiredStableChecks && !result.isStillLoading) {
            status.isFullyLoaded = true;
            status.state = 'ready';
          }
        } else {
          stableCount = 0;
          status.state = 'loading';
        }
        
        previousGroupCount = result.loadedGroups;

        // Estimate time remaining
        if (progressRate > 0 && result.totalGroups > result.loadedGroups) {
          const remaining = result.totalGroups - result.loadedGroups;
          status.estimatedTimeRemaining = Math.ceil(remaining / progressRate);
        }

        // Log progress
        console.log(`📊 Loading progress for user ${userId}:`, {
          loaded: result.loadedGroups,
          total: result.totalGroups,
          state: status.state,
          stableCount
        });

        // Emit progress update
        io.emit('loading_progress', {
          groupsLoaded: result.loadedGroups,
          totalGroups: result.totalGroups,
          isFullyLoaded: status.isFullyLoaded,
          state: status.state,
          estimatedTimeRemaining: status.estimatedTimeRemaining
        });

        // If fully loaded, clear interval
        if (status.isFullyLoaded) {
          console.log(`✅ WhatsApp fully loaded for user ${userId}! Groups: ${result.loadedGroups}`);
          clearInterval(checkInterval);
          
          // Emit a special event for full load
          io.emit('whatsapp_fully_loaded', {
            groupsAvailable: result.loadedGroups
          });
        }

        this.loadingStatus.set(userId, status);

      } catch (error) {
        console.error(`Error monitoring progress for user ${userId}:`, error);
      }
    }, 5000); // Check every 5 seconds

    // Clear interval after 10 minutes to prevent memory leaks
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 10 * 60 * 1000);
  }

  /**
   * Get loading status for a user
   */
  getStatus(userId) {
    return this.loadingStatus.get(userId) || {
      state: 'unknown',
      groupsFound: 0,
      isFullyLoaded: false
    };
  }

  /**
   * Check if user's WhatsApp is ready for group fetching
   */
  isReadyForGroups(userId) {
    const status = this.getStatus(userId);
    return status.isFullyLoaded || status.groupsFound > 0;
  }

  /**
   * Get cached groups count
   */
  getGroupsCount(userId) {
    const status = this.getStatus(userId);
    return status.groupsFound || 0;
  }
}

module.exports = new WhatsAppLoadingManager();