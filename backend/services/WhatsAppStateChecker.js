// services/WhatsAppStateChecker.js
class WhatsAppStateChecker {
  /**
   * Check if WhatsApp Web is fully loaded and ready
   * @param {Client} client - WhatsApp Web client
   * @returns {Promise<boolean>}
   */
  static async isFullyReady(client) {
    try {
      // Check if the client page exists
      if (!client.pupPage) {
        console.log('❌ Puppeteer page not available');
        return false;
      }

      // Check WhatsApp Web state
      const state = await client.pupPage.evaluate(() => {
        try {
          // Check if window.Store exists
          if (!window.Store) {
            console.log('Store not available');
            return { ready: false, reason: 'Store not loaded' };
          }

          // Check if Chat model is loaded
          if (!window.Store.Chat) {
            console.log('Chat store not available');
            return { ready: false, reason: 'Chat store not loaded' };
          }

          // Check if the chat list is loaded
          const chats = window.Store.Chat.getModelsArray();
          if (!chats || chats.length === 0) {
            console.log('No chats loaded yet');
            return { ready: false, reason: 'Chats not loaded' };
          }

          // Check if all chats have proper IDs
          const invalidChats = chats.filter(chat => !chat.id || !chat.id._serialized);
          if (invalidChats.length > 0) {
            console.log(`Found ${invalidChats.length} chats without proper IDs`);
            return { ready: false, reason: 'Some chats not fully loaded' };
          }

          // Check connection state
          if (window.Store.State && window.Store.State.Socket) {
            const socketState = window.Store.State.Socket.state;
            if (socketState !== 'CONNECTED') {
              return { ready: false, reason: `Socket state: ${socketState}` };
            }
          }

          return { ready: true, chatCount: chats.length };
        } catch (error) {
          return { ready: false, reason: error.message };
        }
      });

      console.log('WhatsApp state check:', state);
      return state.ready;

    } catch (error) {
      console.error('Error checking WhatsApp state:', error);
      return false;
    }
  }

  /**
   * Wait for WhatsApp to be fully ready
   * @param {Client} client - WhatsApp Web client
   * @param {number} maxWaitTime - Maximum time to wait in milliseconds
   * @returns {Promise<boolean>}
   */
  static async waitForFullReady(client, maxWaitTime = 30000) {
    const startTime = Date.now();
    const checkInterval = 1000; // Check every second

    while (Date.now() - startTime < maxWaitTime) {
      const isReady = await this.isFullyReady(client);
      if (isReady) {
        console.log('✅ WhatsApp is fully ready');
        return true;
      }

      console.log('⏳ Waiting for WhatsApp to be fully ready...');
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    console.error('❌ Timeout waiting for WhatsApp to be fully ready');
    return false;
  }

  /**
   * Safe method to get chats with retries
   * @param {Client} client - WhatsApp Web client
   * @param {number} maxRetries - Maximum number of retries
   * @returns {Promise<Array>}
   */
  static async safeGetChats(client, maxRetries = 5) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`Attempting to get chats (attempt ${attempt + 1}/${maxRetries})`);
        
        // First ensure WhatsApp is ready
        const isReady = await this.waitForFullReady(client, 10000);
        if (!isReady) {
          throw new Error('WhatsApp not fully ready');
        }

        // Try to get chats using a safer method
        const chats = await client.pupPage.evaluate(() => {
          try {
            if (!window.Store || !window.Store.Chat) {
              throw new Error('Store not available');
            }

            const allChats = window.Store.Chat.getModelsArray();
            
            // Filter and map chats safely
            return allChats
              .filter(chat => {
                try {
                  return chat && chat.id && chat.id._serialized && chat.isGroup;
                } catch (e) {
                  return false;
                }
              })
              .map(chat => {
                try {
                  return {
                    id: { _serialized: chat.id._serialized },
                    name: chat.name || 'Unnamed Group',
                    isGroup: true,
                    participants: chat.participants || [],
                    timestamp: chat.timestamp || 0,
                    lastMessage: chat.lastMessage || null
                  };
                } catch (e) {
                  return null;
                }
              })
              .filter(chat => chat !== null);
          } catch (error) {
            console.error('Error in evaluate:', error);
            return [];
          }
        });

        if (chats.length > 0) {
          console.log(`✅ Successfully retrieved ${chats.length} group chats`);
          return chats;
        }

        console.log('⚠️ No chats found, retrying...');
        
      } catch (error) {
        console.error(`Attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < maxRetries - 1) {
          const waitTime = (attempt + 1) * 2000; // Exponential backoff
          console.log(`Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    throw new Error('Failed to get chats after all retries');
  }
}

module.exports = WhatsAppStateChecker;