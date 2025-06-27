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
   * Update the group count manually when groups are fetched
   */
  updateGroupCount(userId, groupCount) {
    const status = this.loadingStatus.get(userId);
    if (status) {
      status.groupsFound = groupCount;
      status.totalGroups = groupCount;
      status.loadedGroups = groupCount;
      status.lastUpdate = Date.now();
      
      // If we have groups, mark as fully loaded
      if (groupCount > 0) {
        status.isFullyLoaded = true;
        status.state = 'ready';
      }
      
      this.loadingStatus.set(userId, status);
      console.log(`📊 Updated group count for user ${userId}: ${groupCount} groups`);
    }
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
    let checkCount = 0;
    
    const checkInterval = setInterval(async () => {
      try {
        checkCount++;
        
        if (!client || !client.pupPage) {
          clearInterval(checkInterval);
          return;
        }

        // If we already know groups are loaded, just emit the status
        if (status.isFullyLoaded && status.groupsFound > 0) {
          io.emit('loading_progress', {
            groupsLoaded: status.groupsFound,
            totalGroups: status.groupsFound,
            isFullyLoaded: true,
            state: 'ready',
            estimatedTimeRemaining: null
          });
          
          io.emit('whatsapp_fully_loaded', {
            groupsAvailable: status.groupsFound
          });
          
          clearInterval(checkInterval);
          return;
        }

        const result = await client.pupPage.evaluate(() => {
          try {
            // Try multiple ways to access Store
            const Store = window.Store || 
                         window.mR?.findModule('Chat')?.[0] || 
                         window.webpackChunkwhatsapp_web_client?.default?.Chat;
            
            if (!Store || !Store.Chat) {
              return { error: 'Store not ready', totalChats: 0, totalGroups: 0, loadedGroups: 0 };
            }

            const allChats = Store.Chat.getModelsArray ? Store.Chat.getModelsArray() : Store.Chat.models || [];
            const groups = allChats.filter(chat => {
              try {
                return chat && chat.isGroup === true;
              } catch (e) {
                return false;
              }
            });
            
            // Check if chats are still loading
            const loadingIndicator = document.querySelector('[data-testid="startup-progress"]') ||
                                   document.querySelector('[data-icon="sync"]') ||
                                   document.querySelector('.startup-progress');
            const isStillLoading = !!loadingIndicator;
            
            // Count chats with proper data
            const fullyLoadedGroups = groups.filter(chat => {
              try {
                return chat.id && (chat.id._serialized || chat.id.toString()) && chat.name;
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
              sampleGroups: fullyLoadedGroups.slice(0, 5).map(g => g.name || 'Unknown')
            };
          } catch (error) {
            console.error('Error in evaluate:', error);
            return { error: error.message, totalChats: 0, totalGroups: 0, loadedGroups: 0 };
          }
        });

        if (result.error) {
          console.log(`⚠️ Error checking progress: ${result.error}`);
          
          // After several attempts, if we're getting errors but groups were fetched elsewhere, 
          // trust the external group count
          if (checkCount > 5 && status.groupsFound > 0) {
            status.isFullyLoaded = true;
            status.state = 'ready';
          }
          
          // Still emit progress even with error
          io.emit('loading_progress', {
            groupsLoaded: status.groupsFound || 0,
            totalGroups: status.groupsFound || 0,
            isFullyLoaded: status.isFullyLoaded,
            state: status.state,
            estimatedTimeRemaining: null
          });
          
          return;
        }

        // Update status with results
        status.totalChats = result.totalChats;
        status.loadedChats = result.totalChats;
        
        // Use the max of detected groups or previously known groups
        const detectedGroups = result.loadedGroups || result.totalGroups || 0;
        if (detectedGroups > status.groupsFound) {
          status.groupsFound = detectedGroups;
        }
        
        status.lastUpdate = Date.now();

        // Calculate progress
        const elapsedTime = Date.now() - status.startTime;
        const progressRate = status.groupsFound / (elapsedTime / 1000); // groups per second
        
        // Check if loading has stabilized
        if (status.groupsFound === previousGroupCount && status.groupsFound > 0) {
          stableCount++;
          if (stableCount >= requiredStableChecks && !result.isStillLoading) {
            status.isFullyLoaded = true;
            status.state = 'ready';
          }
        } else if (status.groupsFound > previousGroupCount) {
          stableCount = 0;
          status.state = 'loading';
        }
        
        previousGroupCount = status.groupsFound;

        // Estimate time remaining
        if (progressRate > 0 && result.totalGroups > status.groupsFound) {
          const remaining = result.totalGroups - status.groupsFound;
          status.estimatedTimeRemaining = Math.ceil(remaining / progressRate);
        }

        // Log progress
        console.log(`📊 Loading progress for user ${userId}:`, {
          loaded: status.groupsFound,
          total: result.totalGroups || status.groupsFound,
          state: status.state,
          stableCount
        });

        // Emit progress update
        io.emit('loading_progress', {
          groupsLoaded: status.groupsFound,
          totalGroups: result.totalGroups || status.groupsFound,
          isFullyLoaded: status.isFullyLoaded,
          state: status.state,
          estimatedTimeRemaining: status.estimatedTimeRemaining
        });

        // If fully loaded, clear interval and emit event
        if (status.isFullyLoaded || (status.groupsFound > 0 && checkCount > 10)) {
          console.log(`✅ WhatsApp fully loaded for user ${userId}! Groups: ${status.groupsFound}`);
          
          io.emit('whatsapp_fully_loaded', {
            groupsAvailable: status.groupsFound
          });
          
          clearInterval(checkInterval);
        }

        this.loadingStatus.set(userId, status);

      } catch (error) {
        console.error(`Error monitoring progress for user ${userId}:`, error);
      }
    }, 5000); // Check every 5 seconds

    // Clear interval after 5 minutes to prevent memory leaks
    setTimeout(() => {
      clearInterval(checkInterval);
      
      // Final check - if we have groups, mark as loaded
      if (status.groupsFound > 0 && !status.isFullyLoaded) {
        status.isFullyLoaded = true;
        status.state = 'ready';
        
        io.emit('whatsapp_fully_loaded', {
          groupsAvailable: status.groupsFound
        });
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Get loading status for a user
   */
  getStatus(userId) {
    return this.loadingStatus.get(userId) || {
      state: 'unknown',
      groupsFound: 0,
      isFullyLoaded: false,
      totalChats: 0,
      loadedChats: 0,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      estimatedTimeRemaining: null
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

  /**
   * Force mark as fully loaded (useful when groups are fetched successfully)
   */
  markAsFullyLoaded(userId, groupCount) {
    const status = this.getStatus(userId);
    status.isFullyLoaded = true;
    status.state = 'ready';
    status.groupsFound = groupCount;
    status.totalGroups = groupCount;
    status.loadedGroups = groupCount;
    this.loadingStatus.set(userId, status);
  }
}

module.exports = new WhatsAppLoadingManager();