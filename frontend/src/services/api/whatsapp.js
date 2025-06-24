// src/services/api/whatsapp.js
import client from './client';

export const whatsappAPI = {
  // Initialize WhatsApp connection
  initialize: () => client.post('/api/initialize'),

  // Get connection status
  getStatus: () => client.get('/api/status'),

  // Get WhatsApp groups
  getGroups: () => client.get('/api/groups'),

  // Select a group for monitoring
  selectGroup: (groupId) => 
    client.post('/api/select-group', { groupId }),

  // Get group participants
  getGroupParticipants: () => 
    client.get('/api/group-participants'),

  // Select user to monitor
  selectUser: (userId) => 
    client.post('/api/select-user', { userId }),

  // Fetch message history
  fetchHistory: (limit = 50) => 
    client.post('/api/fetch-history', { limit }),

  // Get messages
  getMessages: (grouped = true) => 
    client.get('/api/messages', { params: { grouped } }),

  // Logout from WhatsApp
  logout: () => client.post('/api/logout'),

  // Backup messages
  backupMessages: () => client.post('/api/backup-messages'),

  // Get storage usage
  getStorageUsage: () => client.get('/api/storage-usage')
};