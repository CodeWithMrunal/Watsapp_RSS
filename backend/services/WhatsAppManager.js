const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
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

  initialize() {
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: config.whatsapp.puppeteer
    });

    this.setupEventHandlers();
    this.client.initialize();
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
      this.io.emit('disconnected', reason);
    });

    this.client.on('message', async (message) => {
      await this.handleIncomingMessage(message);
    });
  }

  async handleIncomingMessage(message) {
    console.log('Received message:', message.body);
    
    if (!this.selectedGroup || !message.from.includes('@g.us')) return;
    if (message.from !== this.selectedGroup.id) return;
    if (this.selectedUser && message.author !== this.selectedUser) return;
    
    let mediaPath = null;

    // Handle media download
    if (message.hasMedia) {
      console.log(`📦 Message has media. Type: ${message.type}, From: ${message.author}`);
      mediaPath = await this.downloadMedia(message);
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
      const media = await message.downloadMedia();

      if (!media || !media.data) {
        console.warn('⚠️ Media download failed');
        return null;
      }

      console.log('✅ Media object received:', {
        mimetype: media.mimetype,
        filename: media.filename,
        size: media.data.length
      });

      return FileUtils.saveMedia(media, message.id.id);
    } catch (err) {
      console.error('❌ Error while downloading media:', err);
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