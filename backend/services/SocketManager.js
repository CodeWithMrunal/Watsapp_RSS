class SocketManager {
  constructor(io, whatsappManagerPool) {
    this.io = io;
    this.whatsappManagerPool = whatsappManagerPool;
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', async (socket) => {
      console.log('Client connected:', socket.id, 'User:', socket.userId);
      
      // Register socket for user
      this.whatsappManagerPool.addUserSocket(socket.userId, socket.id);
      
      // Join user-specific room
      socket.join(`user_${socket.userId}`);
      
      try {
        // Get WhatsApp manager for this user (now await the async function)
        const manager = await this.whatsappManagerPool.getManager(socket.userId);
        
        // Send current status to newly connected client
        socket.emit('status', manager.getStatus());
        
        // Handle ready state checking
        socket.on('check_ready', () => {
          socket.emit('status', manager.getStatus());
        });
        
        // Handle client requesting groups when ready
        socket.on('request_groups', async () => {
          try {
            if (manager.isClientReady()) {
              const groups = await manager.getGroups();
              socket.emit('groups_list', groups);
            } else {
              socket.emit('not_ready', { 
                message: 'WhatsApp client is still initializing',
                status: manager.getStatus()
              });
            }
          } catch (error) {
            socket.emit('error', { message: error.message });
          }
        });
        
        // Handle initialization request
        socket.on('request_qr', async () => {
          try {
            await this.whatsappManagerPool.initializeManager(socket.userId);
          } catch (error) {
            socket.emit('error', { message: 'Failed to initialize WhatsApp' });
          }
        });
        
        // Handle message sending (if you want to add this feature)
        socket.on('send_message', async (data) => {
          try {
            const { chatId, message } = data;
            if (manager.isClientReady() && manager.client) {
              await manager.client.sendMessage(chatId, message);
              socket.emit('message_sent', { success: true });
            } else {
              socket.emit('error', { message: 'WhatsApp client not ready' });
            }
          } catch (error) {
            socket.emit('error', { message: error.message });
          }
        });
        
        // Handle manual WhatsApp logout
        socket.on('whatsapp_logout', async () => {
          try {
            await manager.logout();
            socket.emit('whatsapp_disconnected', { message: 'Logged out successfully' });
          } catch (error) {
            socket.emit('error', { message: error.message });
          }
        });
        
        // Handle refresh groups
        socket.on('refresh_groups', async () => {
          try {
            if (manager.isClientReady()) {
              // Clear cache to force refresh
              manager.groupsCache = null;
              manager.groupsCacheTime = null;
              
              const groups = await manager.getGroups();
              socket.emit('groups_list', groups);
            } else {
              socket.emit('error', { message: 'WhatsApp client not ready' });
            }
          } catch (error) {
            socket.emit('error', { message: error.message });
          }
        });
        
      } catch (error) {
        console.error('Error setting up socket handlers:', error);
        socket.emit('error', { message: 'Failed to initialize connection' });
      }
      
      // Handle disconnection (this doesn't need the manager)
      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id, 'User:', socket.userId);
        
        // Remove socket from user's socket list
        this.whatsappManagerPool.removeUserSocket(socket.userId, socket.id);
        
        // Update last activity for the manager if it exists
        const manager = this.whatsappManagerPool.managers.get(socket.userId);
        if (manager) {
          manager.lastActivity = Date.now();
        }
      });
    });
  }

  // Method to emit events to all connected clients of a specific user
  emitToUser(userId, event, data) {
    this.io.to(`user_${userId}`).emit(event, data);
  }

  // Method to emit to all connected clients
  broadcast(event, data) {
    this.io.emit(event, data);
  }

  // Get connection statistics
  getStats() {
    const stats = {
      totalConnections: this.io.engine.clientsCount,
      userConnections: {}
    };
    
    // Count connections per user
    this.whatsappManagerPool.userSockets.forEach((sockets, userId) => {
      stats.userConnections[userId] = sockets.size;
    });
    
    return stats;
  }
}

module.exports = SocketManager;