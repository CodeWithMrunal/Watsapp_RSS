const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const FileUtils = require('../utils/fileUtils');
const MessageUtils = require('../utils/messageUtils');

class WhatsAppManager {
  constructor(io, rssManager) {
    this.client = null;
    this.io = io;
    this.rssManager = rssManager;
    this.isAuthenticated = false;
    this.selectedGroup = null;
    this.selectedUser = null;
    this.messageHistory = [];
  }

  // Enhanced initialize method to handle re-initialization
  initialize() {
    console.log('🔄 Initializing WhatsApp client...');
    
    // If client already exists, destroy it first
    if (this.client) {
      console.log('🗑️ Destroying existing client...');
      try {
        this.client.destroy();
      } catch (error) {
        console.warn('⚠️ Error destroying existing client:', error);
      }
    }

    // Reset state
    this.isAuthenticated = false;
    this.selectedGroup = null;
    this.selectedUser = null;
    this.messageHistory = [];

    // Create new client
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: config.whatsapp.puppeteer
    });

    this.setupEventHandlers();
    
    // Initialize the client
    this.client.initialize();
    console.log('✅ WhatsApp client initialization started');
  }

  setupEventHandlers() {
    this.client.on('qr', (qr) => {
      console.log('Received QR event');
      qrcode.toDataURL(qr, (err, url) => {
        if (err) {
          console.error('Error generating QR code:', err);
          return;
        }
        this.io.emit('qr', url);
      });
    });

    this.client.on('ready', () => {
      console.log('WhatsApp client is ready!');
      this.isAuthenticated = true;
      this.io.emit('authenticated');
    });

    this.client.on('authenticated', () => {
      console.log('WhatsApp client authenticated');
      this.isAuthenticated = true;
      this.io.emit('authenticated');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('Authentication failed:', msg);
      this.isAuthenticated = false;
      this.io.emit('auth_failure', msg);
    });

    this.client.on('disconnected', (reason) => {
      console.log('WhatsApp client disconnected:', reason);
      this.isAuthenticated = false;
      this.selectedGroup = null;
      this.selectedUser = null;
      this.messageHistory = [];
      this.io.emit('disconnected', reason);
    });

    this.client.on('message', async (message) => {
      await this.handleIncomingMessage(message);
    });
  }

  async handleIncomingMessage(message) {
  console.log('Received message:', message.body || `[${message.type}]`);
  
  if (!this.selectedGroup || !message.from.includes('@g.us')) return;
  if (message.from !== this.selectedGroup.id) return;
  if (this.selectedUser && message.author !== this.selectedUser) return;
  
  let mediaPath = null;

  // Handle media download with special handling for videos
  if (message.hasMedia) {
    console.log(`📦 Message has media. Type: ${message.type}, From: ${message.author}`);
    
    // For videos, we might want to handle them differently
    if (message.type === 'video') {
      console.log('🎥 Processing video message...');
      // You could implement a queue system for videos or handle them asynchronously
    }
    
    mediaPath = await this.downloadMedia(message);
    
    // If video download failed, we still want to record the message
    if (!mediaPath && message.type === 'video') {
      console.log('📝 Recording video message without media file');
    }
  }

  const messageData = MessageUtils.createMessageData(message, mediaPath);
  this.messageHistory.push(messageData);
  
  // Group messages and update RSS
  const grouped = MessageUtils.groupMessages([messageData]);
  if (grouped.length > 0) {
    this.rssManager.updateFeed(grouped[0], this.messageHistory);
    this.io.emit('new_message', grouped[0]);
  }
  FileUtils.updateMediaIndex(this.messageHistory);
}

  async downloadMedia(message) {
  try {
    console.log(`🎬 Starting media download for message ${message.id.id}`);
    console.log(`📊 Media info - Type: ${message.type}, Has Media: ${message.hasMedia}`);
    
    // Add retry logic for video downloads
    let media = null;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts && !media) {
      try {
        attempts++;
        console.log(`📥 Download attempt ${attempts}/${maxAttempts}...`);
        
        // For videos, we might need to wait a bit before downloading
        if (message.type === 'video' && attempts > 1) {
          console.log('⏳ Waiting before retry...');
          await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
        }
        
        // Download with timeout
        const downloadPromise = message.downloadMedia();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Download timeout')), 60000) // 60 second timeout
        );
        
        media = await Promise.race([downloadPromise, timeoutPromise]);
        
      } catch (downloadError) {
        console.warn(`⚠️ Download attempt ${attempts} failed:`, downloadError.message);
        if (attempts === maxAttempts) {
          throw downloadError;
        }
      }
    }

    if (!media) {
      console.error('❌ Media download failed - no media object returned');
      return null;
    }

    // Check if media data exists
    if (!media.data) {
      console.error('❌ Media download failed - no data in media object');
      console.log('📋 Media object details:', {
        hasData: !!media.data,
        mimetype: media.mimetype,
        filename: media.filename,
        mediaKeys: Object.keys(media)
      });
      return null;
    }

    console.log('✅ Media object received:', {
      mimetype: media.mimetype,
      filename: media.filename,
      size: media.data.length,
      dataType: typeof media.data
    });

    // For videos, check if the data is valid
    if (message.type === 'video') {
      // Videos should have substantial size
      if (media.data.length < 1000) {
        console.warn('⚠️ Video data seems too small, might be corrupted');
        return null;
      }
      
      // Log first few bytes to verify it's video data
      const header = media.data.substring(0, 20);
      console.log('🔍 Video data header:', header);
    }

    return FileUtils.saveMedia(media, message.id.id);
    
  } catch (err) {
    console.error('❌ Error while downloading media:', err);
    console.error('📋 Error details:', {
      name: err.name,
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 3).join('\n')
    });
    
    // For videos that fail to download, you might want to save the message info
    if (message.type === 'video') {
      console.log('💡 Video download failed. Consider implementing fallback strategy.');
      // You could save a placeholder or the video URL if available
    }
    
    return null;
  }
}

  async getGroups() {
    if (!this.isAuthenticated || !this.client) {
      throw new Error('WhatsApp not authenticated');
    }
    
    const chats = await this.client.getChats();
    return chats
      .filter(chat => chat.isGroup)
      .map(group => ({
        id: group.id._serialized,
        name: group.name,
        participantCount: group.participants.length
      }));
  }

  async selectGroup(groupId) {
    if (!this.isAuthenticated || !this.client) {
      throw new Error('WhatsApp not authenticated');
    }
    
    const chat = await this.client.getChatById(groupId);
    this.selectedGroup = {
      id: groupId,
      name: chat.name,
      participants: chat.participants
    };
    
    // Reset message history and RSS feed
    this.messageHistory = [];
    this.rssManager.reset();
    
    return this.selectedGroup;
  }

  getGroupParticipants() {
    if (!this.selectedGroup) {
      throw new Error('No group selected');
    }
    
    return this.selectedGroup.participants.map(p => ({
      id: p.id._serialized,
      name: p.pushname || p.id.user,
      isAdmin: p.isAdmin
    }));
  }

  selectUser(userId) {
    this.selectedUser = userId === 'all' ? null : userId;
    return this.selectedUser;
  }

  async fetchHistory(limit = 50) {
    if (!this.selectedGroup || !this.client) {
      throw new Error('No group selected or client not ready');
    }
    
    const chat = await this.client.getChatById(this.selectedGroup.id);
    const messages = await chat.fetchMessages({ limit });
    
    const processedMessages = await Promise.all(
      messages.map(async (msg) => {
        const existing = this.messageHistory.find(m => m.id === msg.id._serialized);
        let mediaPath = existing?.mediaPath || null;

        console.log(`📝 Processing message: ${msg.id._serialized}`);

        if (existing) {
          console.log(`🔁 Message ${msg.id._serialized} already exists in messageHistory`);
        }

        if (msg.hasMedia && !mediaPath) {
          mediaPath = await this.downloadMedia(msg);
        }

        return MessageUtils.createMessageData(msg, mediaPath);
      })
    );

    // Ensure you're not appending duplicates to messageHistory
    const newMessages = processedMessages.filter(
      msg => !this.messageHistory.some(existing => existing.id === msg.id)
    );
    
    this.messageHistory = MessageUtils.sortMessagesByTimestamp([...this.messageHistory, ...newMessages]);
    FileUtils.updateMediaIndex(this.messageHistory);
    
    // Filter by user if specified
    const filteredMessages = MessageUtils.filterMessagesByUser(processedMessages, this.selectedUser);
    
    // Group messages and update RSS
    const grouped = MessageUtils.groupMessages(filteredMessages.reverse());
    grouped.forEach(group => this.rssManager.updateFeed(group, this.messageHistory));
    
    return grouped;
  }

  getMessages(grouped = true) {
    if (grouped) {
      return MessageUtils.groupMessages(this.messageHistory);
    }
    return this.messageHistory;
  }

  // NEW: Logout functionality
  async logout() {
    console.log('🔓 Logging out WhatsApp session...');
    
    try {
      if (this.client) {
        // Destroy the WhatsApp client
        await this.client.destroy();
        console.log('✅ WhatsApp client destroyed');
      }
      
      // Delete authentication folders to force fresh login
      const authFolders = ['.wwebjs_auth', '.wwebjs_cache'];
      
      for (const folder of authFolders) {
        try {
          if (fs.existsSync(folder)) {
            await fs.remove(folder);
            console.log(`🗑️ Deleted ${folder} folder`);
          }
        } catch (error) {
          console.warn(`⚠️ Could not delete ${folder}:`, error);
        }
      }
      
      // Reset all state
      this.isAuthenticated = false;
      this.selectedGroup = null;
      this.selectedUser = null;
      this.messageHistory = [];
      this.client = null;
      
      // Reset RSS manager
      if (this.rssManager) {
        this.rssManager.reset();
      }
      
      // Emit disconnected event to all clients
      this.io.emit('disconnected', 'User logged out');
      
      console.log('✅ Logout completed successfully');
      
    } catch (error) {
      console.error('❌ Error during logout:', error);
      
      // Force reset state even if client destruction fails
      this.isAuthenticated = false;
      this.selectedGroup = null;
      this.selectedUser = null;
      this.messageHistory = [];
      this.client = null;
      
      this.io.emit('disconnected', 'Logout error but state reset');
      
      throw error;
    }
  }

  // Enhanced initialize method to handle re-initialization
  initialize() {
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: config.whatsapp.puppeteer
    });

    this.setupEventHandlers();
    this.client.initialize();
  }

  getStatus() {
    return {
      authenticated: this.isAuthenticated,
      selectedGroup: this.selectedGroup?.name || null,
      selectedUser: this.selectedUser || null
    };
  }

  // Getters for accessing private properties
  get messageHistory() {
    return this._messageHistory || [];
  }

  set messageHistory(value) {
    this._messageHistory = value;
  }
}

module.exports = WhatsAppManager;