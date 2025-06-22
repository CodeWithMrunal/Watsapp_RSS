class SocketManager {
  constructor(io, whatsappManager) {
    this.io = io;
    this.whatsappManager = whatsappManager;
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);
      
      // Send current status to newly connected client
      socket.emit('status', this.whatsappManager.getStatus());
      
      // NEW: Handle ready state checking
      socket.on('check_ready', () => {
        socket.emit('status', this.whatsappManager.getStatus());
      });
      
      // NEW: Handle client requesting groups when ready
      socket.on('request_groups', async () => {
        try {
          if (this.whatsappManager.isClientReady()) {
            const groups = await this.whatsappManager.getGroups();
            socket.emit('groups_list', groups);
          } else {
            socket.emit('not_ready', { 
              message: 'WhatsApp client is still initializing',
              status: this.whatsappManager.getStatus()
            });
          }
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });
      
      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });
  }

  // Method to emit events to all connected clients
  emit(event, data) {
    this.io.emit(event, data);
  }

  // Method to emit to a specific socket
  emitToSocket(socketId, event, data) {
    this.io.to(socketId).emit(event, data);
  }
}

module.exports = SocketManager;