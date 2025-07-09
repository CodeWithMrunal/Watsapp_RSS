const moment = require('moment');
const { v4: uuidv4 } = require('uuid');
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
          // Enrich the completed group with statistics
          currentGroup = this.enrichGroupStatistics(currentGroup);
          grouped.push(currentGroup);
        }
        
        currentGroup = {
          id: uuidv4(),
          author: msg.author,
          authorDetails: msg.authorDetails || {},
          timestamp: msg.timestamp,
          startTime: new Date(msg.timestamp * 1000).toISOString(),
          messages: [msg],
          type: 'group',
          statistics: {
            messageCount: 0,
            mediaCount: 0,
            textCount: 0,
            linkCount: 0,
            mentionCount: 0,
            forwardedCount: 0,
            deletedCount: 0,
            starredCount: 0
          }
        };
      } else {
        currentGroup.messages.push(msg);
      }
    });
    
    if (currentGroup) {
      currentGroup = this.enrichGroupStatistics(currentGroup);
      grouped.push(currentGroup);
    }
    
    return grouped;
  }

  /**
   * Enrich group with aggregated statistics
   */
  static enrichGroupStatistics(group) {
    const stats = {
      messageCount: group.messages.length,
      mediaCount: 0,
      textCount: 0,
      linkCount: 0,
      mentionCount: 0,
      forwardedCount: 0,
      deletedCount: 0,
      starredCount: 0,
      mediaByType: {},
      totalMediaSize: 0,
      totalTextLength: 0,
      uniqueMentions: new Set(),
      linkDomains: new Set()
    };

    group.messages.forEach(msg => {
      if (msg.hasMedia) {
        stats.mediaCount++;
        stats.mediaByType[msg.type] = (stats.mediaByType[msg.type] || 0) + 1;
        if (msg.mediaMetadata?.fileSize) {
          stats.totalMediaSize += msg.mediaMetadata.fileSize;
        }
      } else if (msg.body) {
        stats.textCount++;
        stats.totalTextLength += msg.body.length;
      }

      if (msg.links) stats.linkCount += msg.links.length;
      if (msg.mentions) {
        stats.mentionCount += msg.mentions.length;
        msg.mentions.forEach(m => stats.uniqueMentions.add(m));
      }
      if (msg.isForwarded) stats.forwardedCount++;
      if (msg.isDeleted) stats.deletedCount++;
      if (msg.isStarred) stats.starredCount++;

      // Track link domains
      if (msg.links) {
        msg.links.forEach(link => {
          const domain = this.extractDomain(link);
          if (domain) stats.linkDomains.add(domain);
        });
      }
    });

    // Convert sets to arrays for JSON serialization
    stats.uniqueMentions = Array.from(stats.uniqueMentions);
    stats.linkDomains = Array.from(stats.linkDomains);

    // Calculate averages
    stats.averageMessageLength = stats.textCount > 0 
      ? Math.round(stats.totalTextLength / stats.textCount) 
      : 0;

    // Add duration
    const firstMsg = group.messages[0];
    const lastMsg = group.messages[group.messages.length - 1];
    const duration = lastMsg.timestamp - firstMsg.timestamp;

    return {
      ...group,
      endTime: new Date(lastMsg.timestamp * 1000).toISOString(),
      duration: duration,
      durationFormatted: this.formatDuration(duration),
      statistics: stats
    };
  }

  /**
   * Extract domain from URL
   */
  static extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return null;
    }
  }

  /**
   * Format duration
   */
  static formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  /**
   * Extract links from message body
   */
  static extractLinks(body) {
    if (!body) return [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return body.match(urlRegex) || [];
  }

  /**
   * Extract mentions from message
   */
  static extractMentions(message) {
    const mentions = [];
    
    // Extract @mentions from body
    if (message.body) {
      const mentionRegex = /@(\d+)/g;
      const matches = message.body.matchAll(mentionRegex);
      for (const match of matches) {
        mentions.push(match[1]);
      }
    }

    // Add mentioned contacts if available
    if (message.mentionedIds) {
      mentions.push(...message.mentionedIds.map(id => id._serialized));
    }

    return [...new Set(mentions)]; // Remove duplicates
  }

  /**
   * Detect language (simplified - you might want to use a proper library)
   */
  static detectLanguage(text) {
    if (!text) return null;
    
    // Simple heuristic - check for common patterns
    // In production, use a library like franc or langdetect
    const patterns = {
      'en': /\b(the|is|are|was|were|have|has|had|will|would|could|should)\b/i,
      'es': /\b(el|la|los|las|es|son|está|están|tiene|tienen)\b/i,
      'pt': /\b(o|a|os|as|é|são|está|estão|tem|têm)\b/i,
      'hi': /[\u0900-\u097F]/,
      'ar': /[\u0600-\u06FF]/,
      'zh': /[\u4E00-\u9FFF]/,
      'ja': /[\u3040-\u309F\u30A0-\u30FF]/,
      'ko': /[\uAC00-\uD7AF]/
    };

    for (const [lang, pattern] of Object.entries(patterns)) {
      if (pattern.test(text)) return lang;
    }

    return 'unknown';
  }

  /**
   * Clean duplicate links from message body
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
   * Parse quoted message metadata
   */
  static parseQuotedMessage(message) {
    if (!message.hasQuotedMsg) return null;

    try {
      return {
        id: message.quotedMsg?.id?._serialized || null,
        author: message.quotedMsg?.author || null,
        body: message.quotedMsg?.body || null,
        type: message.quotedMsg?.type || null,
        timestamp: message.quotedMsg?.timestamp || null
      };
    } catch (error) {
      console.warn('Error parsing quoted message:', error);
      return null;
    }
  }

  /**
   * Extract author details
   */
  static extractAuthorDetails(message) {
    return {
      id: message.author || message.from,
      pushName: message._data?.notifyName || null,
      phoneNumber: message.author?.split('@')[0] || null,
      isBusinessAccount: message._data?.bizAccount || false,
      profilePicUrl: null // Would need to fetch separately
    };
  }

  /**
   * Extract message reactions
   */
  static extractReactions(message) {
    if (!message.reactions || !Array.isArray(message.reactions)) return [];

    return message.reactions.map(reaction => ({
      emoji: reaction.aggregateEmoji || reaction.emoji,
      count: reaction.count || 1,
      senders: reaction.senders || []
    }));
  }

  static createMessageData(message, mediaPath = null) {
    // Clean the message body to remove duplicate links
    const cleanedBody = this.cleanDuplicateLinks(message.body);
    
    // Extract various metadata
    const links = this.extractLinks(cleanedBody);
    const mentions = this.extractMentions(message);
    const quotedMessage = this.parseQuotedMessage(message);
    const authorDetails = this.extractAuthorDetails(message);
    const reactions = this.extractReactions(message);
    const detectedLanguage = this.detectLanguage(cleanedBody);

    // Build media metadata if available
    let mediaMetadata = null;
    if (mediaPath && typeof mediaPath === 'object') {
      mediaMetadata = mediaPath; // mediaPath is already the full metadata object
      mediaPath = mediaMetadata.path; // Extract just the path
    }
    
    return {
      // Core message data
      id: message.id._serialized,
      messageId: message.id.id,
      
      // Content
      body: cleanedBody,
      originalBody: message.body,
      caption: message.caption || null,
      
      // Author information
      author: message.author,
      authorDetails: authorDetails,
      
      // Timestamps
      timestamp: message.timestamp,
      date: new Date(message.timestamp * 1000).toISOString(),
      
      // Message type and status
      type: message.type,
      hasMedia: message.hasMedia,
      isForwarded: message.isForwarded || false,
      isStarred: message.isStarred || false,
      isStatus: message.isStatus || false,
      isBroadcast: message.broadcast || false,
      isDeleted: message.body === '' && !message.hasMedia,
      isEphemeral: message.isEphemeral || false,
      
      // Group information
      from: message.from,
      to: message.to,
      groupId: message.from?.includes('@g.us') ? message.from.split('@')[0] : null,
      groupName: message.chat?.name || null,
      
      // Media information
      mediaPath: mediaPath,
      mediaMetadata: mediaMetadata,
      
      // Extracted entities
      links: links,
      mentions: mentions,
      quotedMessage: quotedMessage,
      reactions: reactions,
      
      // Additional metadata
      detectedLanguage: detectedLanguage,
      wordCount: cleanedBody ? cleanedBody.split(/\s+/).filter(w => w.length > 0).length : 0,
      charCount: cleanedBody ? cleanedBody.length : 0,
      
      // Device info (if available)
      deviceType: message.deviceType || null,
      
      // Raw data for future reference
      _raw: {
        hasQuotedMsg: message.hasQuotedMsg || false,
        vCards: message.vCards || [],
        inviteV4: message.inviteV4 || null,
        location: message.location || null
      }
    };
  }

  static filterMessagesByUser(messages, selectedUser) {
    if (!selectedUser) return messages;
    return messages.filter(msg => msg.author === selectedUser);
  }

  static sortMessagesByTimestamp(messages) {
    return messages.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Generate message statistics for a set of messages
   */
  static generateStatistics(messages) {
    const stats = {
      totalMessages: messages.length,
      messageTypes: {},
      authors: {},
      timeline: {},
      mediaStats: {
        total: 0,
        byType: {},
        totalSize: 0
      },
      linkStats: {
        total: 0,
        byDomain: {},
        byType: {}
      },
      mentionStats: {
        total: 0,
        uniqueUsers: new Set(),
        byUser: {}
      },
      languageStats: {},
      hourlyDistribution: Array(24).fill(0),
      dailyDistribution: {},
      averageMessageLength: 0,
      totalWordCount: 0
    };

    let totalLength = 0;
    let textMessageCount = 0;

    messages.forEach(msg => {
      // Message types
      stats.messageTypes[msg.type] = (stats.messageTypes[msg.type] || 0) + 1;

      // Author statistics
      if (!stats.authors[msg.author]) {
        stats.authors[msg.author] = {
          messageCount: 0,
          mediaCount: 0,
          textCount: 0,
          firstMessage: msg.timestamp,
          lastMessage: msg.timestamp,
          authorDetails: msg.authorDetails || {}
        };
      }
      stats.authors[msg.author].messageCount++;
      stats.authors[msg.author].lastMessage = msg.timestamp;

      // Media statistics
      if (msg.hasMedia) {
        stats.mediaStats.total++;
        stats.mediaStats.byType[msg.type] = (stats.mediaStats.byType[msg.type] || 0) + 1;
        stats.authors[msg.author].mediaCount++;
        
        if (msg.mediaMetadata?.fileSize) {
          stats.mediaStats.totalSize += msg.mediaMetadata.fileSize;
        }
      } else if (msg.body) {
        stats.authors[msg.author].textCount++;
        textMessageCount++;
        totalLength += msg.body.length;
        stats.totalWordCount += msg.wordCount || 0;
      }

      // Link statistics
      if (msg.links && msg.links.length > 0) {
        stats.linkStats.total += msg.links.length;
        msg.links.forEach(link => {
          const domain = this.extractDomain(link);
          if (domain) {
            stats.linkStats.byDomain[domain] = (stats.linkStats.byDomain[domain] || 0) + 1;
          }
          
          // Categorize link
          const linkType = this.categorizeLinkType(link);
          stats.linkStats.byType[linkType] = (stats.linkStats.byType[linkType] || 0) + 1;
        });
      }

      // Mention statistics
      if (msg.mentions && msg.mentions.length > 0) {
        stats.mentionStats.total += msg.mentions.length;
        msg.mentions.forEach(mention => {
          stats.mentionStats.uniqueUsers.add(mention);
          stats.mentionStats.byUser[mention] = (stats.mentionStats.byUser[mention] || 0) + 1;
        });
      }

      // Language statistics
      if (msg.detectedLanguage) {
        stats.languageStats[msg.detectedLanguage] = (stats.languageStats[msg.detectedLanguage] || 0) + 1;
      }

      // Time-based statistics
      const msgDate = new Date(msg.timestamp * 1000);
      const hour = msgDate.getHours();
      const dayKey = msgDate.toISOString().split('T')[0];
      
      stats.hourlyDistribution[hour]++;
      stats.dailyDistribution[dayKey] = (stats.dailyDistribution[dayKey] || 0) + 1;

      // Timeline (messages per day)
      const timelineKey = dayKey;
      if (!stats.timeline[timelineKey]) {
        stats.timeline[timelineKey] = {
          date: timelineKey,
          messageCount: 0,
          mediaCount: 0,
          authors: new Set()
        };
      }
      stats.timeline[timelineKey].messageCount++;
      if (msg.hasMedia) stats.timeline[timelineKey].mediaCount++;
      stats.timeline[timelineKey].authors.add(msg.author);
    });

    // Calculate averages
    stats.averageMessageLength = textMessageCount > 0 ? Math.round(totalLength / textMessageCount) : 0;
    stats.mentionStats.uniqueUsersCount = stats.mentionStats.uniqueUsers.size;
    stats.mentionStats.uniqueUsers = Array.from(stats.mentionStats.uniqueUsers);

    // Convert timeline authors sets to counts
    Object.keys(stats.timeline).forEach(key => {
      stats.timeline[key].uniqueAuthors = stats.timeline[key].authors.size;
      delete stats.timeline[key].authors; // Remove set before JSON serialization
    });

    // Sort authors by message count
    stats.topAuthors = Object.entries(stats.authors)
      .sort((a, b) => b[1].messageCount - a[1].messageCount)
      .slice(0, 10)
      .map(([author, data]) => ({ author, ...data }));

    // Peak activity hours
    stats.peakHours = stats.hourlyDistribution
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return stats;
  }

  /**
   * Categorize link type
   */
  static categorizeLinkType(url) {
    const categories = {
      'social-media': ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'tiktok.com'],
      'video': ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com'],
      'file-sharing': ['drive.google.com', 'dropbox.com', 'box.com', 'onedrive.com', 'mega.nz'],
      'messaging': ['wa.me', 'whatsapp.com', 't.me', 'telegram.org'],
      'code': ['github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com'],
      'news': ['cnn.com', 'bbc.com', 'reuters.com', 'bloomberg.com'],
      'shopping': ['amazon.com', 'ebay.com', 'alibaba.com', 'flipkart.com']
    };

    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.toLowerCase();
      
      for (const [category, domains] of Object.entries(categories)) {
        if (domains.some(d => domain.includes(d))) {
          return category;
        }
      }
      
      return 'other';
    } catch {
      return 'invalid';
    }
  }

  /**
   * Generate conversation summary
   */
  static generateConversationSummary(messages) {
    const stats = this.generateStatistics(messages);
    
    const startTime = messages.length > 0 ? new Date(messages[0].timestamp * 1000) : null;
    const endTime = messages.length > 0 ? new Date(messages[messages.length - 1].timestamp * 1000) : null;
    
    return {
      conversationId: uuidv4(),
      startTime: startTime?.toISOString(),
      endTime: endTime?.toISOString(),
      duration: startTime && endTime ? Math.floor((endTime - startTime) / 1000) : 0,
      messageCount: messages.length,
      participantCount: Object.keys(stats.authors).length,
      statistics: stats,
      mostActiveHours: stats.peakHours.map(h => h.hour),
      dominantLanguage: Object.entries(stats.languageStats)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown',
      mediaHeavy: stats.mediaStats.total > stats.totalMessages * 0.3,
      averageMessagesPerDay: Object.keys(stats.dailyDistribution).length > 0
        ? Math.round(stats.totalMessages / Object.keys(stats.dailyDistribution).length)
        : 0
    };
  }
}

module.exports = MessageUtils;