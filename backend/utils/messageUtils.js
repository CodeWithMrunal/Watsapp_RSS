const moment = require('moment');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const config = require('../config');

class MessageUtils {
  static groupMessages(messages) {
    const grouped = [];
    let currentGroup = null;
    
    messages.forEach(msg => {
      if (!currentGroup || 
          currentGroup.author !== msg.author || 
          moment(msg.timestamp * 1000).diff(moment(currentGroup.timestamp * 1000), 'minutes') > config.messaging.groupTimeoutMinutes) {
        
        if (currentGroup) {
          grouped.push(currentGroup);
        }
        
        currentGroup = {
          id: uuidv4(),
          author: msg.author,
          timestamp: msg.timestamp,
          messages: [msg],
          type: 'group'
        };
      } else {
        currentGroup.messages.push(msg);
      }
    });
    
    if (currentGroup) {
      grouped.push(currentGroup);
    }
    
    return grouped;
  }

  /**
   * Clean duplicate links from message body
   * Removes duplicate Google Drive links when "Note: Download Any One Link All Link Are Same" is present
   */
  static cleanDuplicateLinks(messageBody) {
    if (!messageBody || typeof messageBody !== 'string') {
      return messageBody;
    }

    // Split the message into sections by the duplicate note
    const duplicateNote = "Note: Download Any One Link All Link Are Same";
    
    // Check if the message contains duplicate links
    if (!messageBody.includes(duplicateNote)) {
      return messageBody;
    }

    // Split message into lines
    const lines = messageBody.split('\n');
    const cleanedLines = [];
    let skipLinks = false;
    let linkCount = 0;
    let currentSection = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if this line contains the duplicate note
      if (line === duplicateNote) {
        // Add the current section to cleaned lines
        cleanedLines.push(...currentSection);
        cleanedLines.push(line); // Add the note itself
        currentSection = [];
        skipLinks = true;
        linkCount = 0;
        continue;
      }

      // Check if this is a Google Drive link
      const isDriveLink = line.includes('drive.google.com/file/d/');
      
      if (skipLinks && isDriveLink) {
        // Only keep the first link after the duplicate note
        if (linkCount === 0) {
          cleanedLines.push(line);
          linkCount++;
        }
        // Skip subsequent links
        continue;
      }

      // If we encounter a non-link line after processing links, reset the flag
      if (skipLinks && !isDriveLink && line !== '' && linkCount > 0) {
        skipLinks = false;
        linkCount = 0;
      }

      // For all other lines, add them to current section
      if (!skipLinks || !isDriveLink) {
        currentSection.push(line);
      }
    }

    // Add any remaining lines
    cleanedLines.push(...currentSection);

    // Join back and clean up extra newlines
    return cleanedLines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2
      .trim();
  }

  /**
   * Extract all links from message body
   */
  static extractLinks(messageBody) {
    if (!messageBody) return [];
    
    const linkRegex = /(https?:\/\/[^\s]+)/g;
    const links = messageBody.match(linkRegex) || [];
    
    return links.map(link => {
      let type = 'general';
      let platform = 'unknown';
      
      if (link.includes('drive.google.com')) {
        type = 'cloud_storage';
        platform = 'google_drive';
      } else if (link.includes('youtube.com') || link.includes('youtu.be')) {
        type = 'video';
        platform = 'youtube';
      } else if (link.includes('github.com')) {
        type = 'code';
        platform = 'github';
      } else if (link.includes('linkedin.com')) {
        type = 'social';
        platform = 'linkedin';
      } else if (link.includes('twitter.com') || link.includes('x.com')) {
        type = 'social';
        platform = 'twitter';
      }
      
      return {
        url: link,
        type: type,
        platform: platform,
        extractedAt: new Date().toISOString()
      };
    });
  }

  /**
   * Extract mentions from message body
   */
  static extractMentions(messageBody) {
    if (!messageBody) return [];
    
    // WhatsApp mention format: @919876543210
    const mentionRegex = /@(\d{12})/g;
    const mentions = [];
    let match;
    
    while ((match = mentionRegex.exec(messageBody)) !== null) {
      mentions.push({
        phoneNumber: match[1],
        position: match.index,
        raw: match[0]
      });
    }
    
    return mentions;
  }

  /**
   * Analyze message sentiment and extract entities
   */
  static analyzeMessage(messageBody) {
    if (!messageBody) return null;
    
    const analysis = {
      wordCount: messageBody.split(/\s+/).filter(word => word.length > 0).length,
      characterCount: messageBody.length,
      lineCount: messageBody.split('\n').length,
      hasEmoji: /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(messageBody),
      language: this.detectLanguage(messageBody),
      contentType: this.detectContentType(messageBody)
    };
    
    return analysis;
  }

  /**
   * Simple language detection based on character sets
   */
  static detectLanguage(text) {
    if (!text) return 'unknown';
    
    // Basic detection - can be enhanced with proper NLP libraries
    if (/[\u0900-\u097F]/.test(text)) return 'hindi';
    if (/[\u0C00-\u0C7F]/.test(text)) return 'telugu';
    if (/[\u0C80-\u0CFF]/.test(text)) return 'kannada';
    if (/[\u0B80-\u0BFF]/.test(text)) return 'tamil';
    if (/[\u4E00-\u9FFF]/.test(text)) return 'chinese';
    if (/[\u3040-\u309F]|[\u30A0-\u30FF]/.test(text)) return 'japanese';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'korean';
    if (/[\u0600-\u06FF]/.test(text)) return 'arabic';
    
    return 'english'; // Default
  }

  /**
   * Detect content type based on message patterns
   */
  static detectContentType(messageBody) {
    if (!messageBody) return 'unknown';
    
    const types = [];
    
    if (this.extractLinks(messageBody).length > 0) types.push('links');
    if (/\b\d{10,}\b/.test(messageBody)) types.push('phone_number');
    if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/.test(messageBody)) types.push('email');
    if (/₹|Rs\.?|INR|\$|USD|EUR|£/.test(messageBody)) types.push('currency');
    if (/\d{1,2}:\d{2}\s*(AM|PM|am|pm)?/.test(messageBody)) types.push('time');
    if (/\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/.test(messageBody)) types.push('date');
    if (/\b(urgent|important|asap|emergency)\b/i.test(messageBody)) types.push('priority');
    
    return types.length > 0 ? types : ['text'];
  }

  /**
   * Generate content hash for deduplication
   */
  static generateContentHash(content) {
    return crypto.createHash('sha256').update(content || '').digest('hex');
  }

  /**
   * Create enhanced message metadata
   */
  static createMessageData(message, mediaPath = null) {
    // Clean the message body to remove duplicate links
    const cleanedBody = this.cleanDuplicateLinks(message.body);
    
    // Extract rich metadata
    const links = this.extractLinks(cleanedBody);
    const mentions = this.extractMentions(cleanedBody);
    const analysis = this.analyzeMessage(cleanedBody);
    const contentHash = this.generateContentHash(cleanedBody);
    
    // Parse group information from message ID
    const groupMatch = message.id._serialized.match(/(\d+)@g\.us/);
    const groupId = groupMatch ? groupMatch[1] : null;
    
    // Enhanced metadata structure
    return {
      // Core identifiers
      id: message.id._serialized,
      messageId: message.id.id,
      groupId: groupId,
      conversationId: message.from,
      
      // Message content
      body: cleanedBody,
      originalBody: message.body,
      contentHash: contentHash,
      
      // Author information
      author: message.author,
      authorNumber: message.author ? message.author.split('@')[0] : null,
      
      // Timestamps
      timestamp: message.timestamp,
      createdAt: new Date(message.timestamp * 1000).toISOString(),
      receivedAt: new Date().toISOString(),
      
      // Message type and media
      type: message.type,
      hasMedia: message.hasMedia,
      mediaPath: mediaPath,
      mediaType: message.hasMedia ? message.type : null,
      
      // Communication metadata
      from: message.from,
      to: message.to,
      broadcast: message.broadcast || false,
      isForwarded: message.isForwarded || false,
      forwardingScore: message.forwardingScore || 0,
      isStatus: message.isStatus || false,
      isStarred: message.isStarred || false,
      
      // Extracted entities
      links: links,
      linkCount: links.length,
      mentions: mentions,
      mentionCount: mentions.length,
      
      // Content analysis
      analysis: analysis,
      
      // Reply context
      hasQuotedMsg: message.hasQuotedMsg || false,
      quotedMsgId: message.hasQuotedMsg && message.quotedMsg ? message.quotedMsg.id._serialized : null,
      
      // Additional metadata
      deviceType: message.deviceType || 'unknown',
      isGif: message.isGif || false,
      isEphemeral: message.isEphemeral || false,
      isViewOnce: message.isViewOnce || false,
      
      // Processing metadata
      processed: true,
      processedAt: new Date().toISOString(),
      version: '2.0' // Metadata version for future migrations
    };
  }

  /**
   * Create group metadata
   */
  static createGroupMetadata(groupedMessages) {
    const messages = groupedMessages.messages || [];
    const mediaMessages = messages.filter(m => m.hasMedia);
    const textMessages = messages.filter(m => !m.hasMedia && m.body);
    
    // Aggregate links from all messages
    const allLinks = messages.reduce((acc, msg) => {
      const links = this.extractLinks(msg.body);
      return acc.concat(links);
    }, []);
    
    // Aggregate mentions
    const allMentions = messages.reduce((acc, msg) => {
      const mentions = this.extractMentions(msg.body);
      return acc.concat(mentions);
    }, []);
    
    return {
      id: groupedMessages.id,
      groupId: groupedMessages.groupId,
      author: groupedMessages.author,
      authorNumber: groupedMessages.author ? groupedMessages.author.split('@')[0] : null,
      
      // Time range
      startTimestamp: groupedMessages.timestamp,
      endTimestamp: messages.length > 0 ? messages[messages.length - 1].timestamp : groupedMessages.timestamp,
      duration: messages.length > 0 ? messages[messages.length - 1].timestamp - groupedMessages.timestamp : 0,
      
      // Message statistics
      totalMessages: messages.length,
      textMessages: textMessages.length,
      mediaMessages: mediaMessages.length,
      
      // Media breakdown
      mediaTypes: {
        images: mediaMessages.filter(m => m.type === 'image').length,
        videos: mediaMessages.filter(m => m.type === 'video').length,
        audio: mediaMessages.filter(m => m.type === 'audio').length,
        documents: mediaMessages.filter(m => m.type === 'document').length,
        stickers: mediaMessages.filter(m => m.type === 'sticker').length,
        voice: mediaMessages.filter(m => m.type === 'ptt').length
      },
      
      // Content analysis
      totalLinks: allLinks.length,
      linksByPlatform: this.groupBy(allLinks, 'platform'),
      totalMentions: allMentions.length,
      uniqueMentions: [...new Set(allMentions.map(m => m.phoneNumber))].length,
      
      // Engagement metrics
      averageMessageLength: textMessages.length > 0 
        ? textMessages.reduce((sum, msg) => sum + (msg.body ? msg.body.length : 0), 0) / textMessages.length 
        : 0,
      totalWords: textMessages.reduce((sum, msg) => sum + (msg.body ? msg.body.split(/\s+/).length : 0), 0),
      
      // Metadata
      createdAt: new Date().toISOString(),
      version: '2.0'
    };
  }

  /**
   * Helper function to group array by property
   */
  static groupBy(array, property) {
    return array.reduce((groups, item) => {
      const key = item[property];
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
      return groups;
    }, {});
  }

  static filterMessagesByUser(messages, selectedUser) {
    if (!selectedUser) return messages;
    return messages.filter(msg => msg.author === selectedUser);
  }

  static sortMessagesByTimestamp(messages) {
    return messages.sort((a, b) => a.timestamp - b.timestamp);
  }
}

module.exports = MessageUtils;