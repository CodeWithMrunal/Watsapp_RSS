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