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
          // Enrich the group metadata before pushing
          currentGroup = this.enrichGroupMetadata(currentGroup);
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
      currentGroup = this.enrichGroupMetadata(currentGroup);
      grouped.push(currentGroup);
    }
    
    return grouped;
  }

  /**
   * Enrich group metadata with additional information
   */
  static enrichGroupMetadata(group) {
    const startTime = group.messages[0].timestamp;
    const endTime = group.messages[group.messages.length - 1].timestamp;
    
    return {
      ...group,
      metadata: {
        messageCount: group.messages.length,
        duration: endTime - startTime,
        startTime: new Date(startTime * 1000).toISOString(),
        endTime: new Date(endTime * 1000).toISOString(),
        hasMedia: group.messages.some(msg => msg.hasMedia),
        mediaCount: group.messages.filter(msg => msg.hasMedia).length,
        textMessageCount: group.messages.filter(msg => !msg.hasMedia && msg.body).length,
        mediaTypes: [...new Set(group.messages.filter(msg => msg.hasMedia).map(msg => msg.type))],
        totalCharacters: group.messages.reduce((sum, msg) => sum + (msg.body?.length || 0), 0),
        averageMessageLength: Math.round(group.messages.reduce((sum, msg) => sum + (msg.body?.length || 0), 0) / group.messages.length),
        languages: this.detectLanguages(group.messages),
        keywords: this.extractKeywords(group.messages),
        urls: this.extractUrls(group.messages),
        mentions: this.extractMentions(group.messages),
        hashtags: this.extractHashtags(group.messages),
        groupHash: this.generateGroupHash(group)
      }
    };
  }

  /**
   * Clean duplicate links from message body
   */
  static cleanDuplicateLinks(messageBody) {
    if (!messageBody || typeof messageBody !== 'string') {
      return messageBody;
    }

    const duplicateNote = "Note: Download Any One Link All Link Are Same";
    
    if (!messageBody.includes(duplicateNote)) {
      return messageBody;
    }

    const lines = messageBody.split('\n');
    const cleanedLines = [];
    let skipLinks = false;
    let linkCount = 0;
    let currentSection = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line === duplicateNote) {
        cleanedLines.push(...currentSection);
        cleanedLines.push(line);
        currentSection = [];
        skipLinks = true;
        linkCount = 0;
        continue;
      }

      const isDriveLink = line.includes('drive.google.com/file/d/');
      
      if (skipLinks && isDriveLink) {
        if (linkCount === 0) {
          cleanedLines.push(line);
          linkCount++;
        }
        continue;
      }

      if (skipLinks && !isDriveLink && line !== '' && linkCount > 0) {
        skipLinks = false;
        linkCount = 0;
      }

      if (!skipLinks || !isDriveLink) {
        currentSection.push(line);
      }
    }

    cleanedLines.push(...currentSection);

    return cleanedLines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Create enriched message data with comprehensive metadata
   */
  static createMessageData(message, mediaPath = null) {
    const cleanedBody = this.cleanDuplicateLinks(message.body);
    const messageHash = this.generateMessageHash(message);
    
    const enrichedData = {
      // Core fields
      id: message.id._serialized,
      messageHash: messageHash,
      body: cleanedBody,
      originalBody: message.body,
      author: message.author,
      timestamp: message.timestamp,
      type: message.type,
      hasMedia: message.hasMedia,
      from: message.from,
      to: message.to,
      mediaPath,
      
      // Enhanced metadata
      metadata: {
        // Temporal data
        datetime: new Date(message.timestamp * 1000).toISOString(),
        dayOfWeek: moment(message.timestamp * 1000).format('dddd'),
        timeOfDay: this.getTimeOfDay(message.timestamp),
        
        // Message characteristics
        messageLength: cleanedBody?.length || 0,
        wordCount: this.countWords(cleanedBody),
        lineCount: cleanedBody?.split('\n').length || 0,
        hasEmojis: this.containsEmojis(cleanedBody),
        emojiCount: this.countEmojis(cleanedBody),
        emojis: this.extractEmojis(cleanedBody),
        
        // Content analysis
        sentiment: this.analyzeSentiment(cleanedBody),
        language: this.detectLanguage(cleanedBody),
        isForwarded: message.isForwarded || false,
        isReply: !!message.quotedMsg,
        replyToId: message.quotedMsg?.id?._serialized || null,
        
        // URL and mention analysis
        urls: this.extractUrlsFromText(cleanedBody),
        urlCount: this.extractUrlsFromText(cleanedBody).length,
        mentions: this.extractMentionsFromText(cleanedBody),
        mentionCount: this.extractMentionsFromText(cleanedBody).length,
        hashtags: this.extractHashtagsFromText(cleanedBody),
        hashtagCount: this.extractHashtagsFromText(cleanedBody).length,
        
        // Media specific metadata
        mediaMetadata: message.hasMedia ? {
          mimetype: message.mimetype || null,
          filename: message.filename || null,
          caption: message.caption || null,
          filesize: message.filesize || null,
          mediaKey: message.mediaKey || null,
          isViewOnce: message.isViewOnce || false,
          mediaUrl: mediaPath ? `/media/${mediaPath.split('/').pop()}` : null
        } : null,
        
        // Platform specific
        isStatus: message.isStatus || false,
        isStarred: message.isStarred || false,
        isGif: message.isGif || false,
        duration: message.duration || null, // For audio/video
        
        // Device and location
        deviceType: message.deviceType || null,
        location: message.location || null,
        
        // Processing metadata
        processedAt: new Date().toISOString(),
        processingVersion: '1.0'
      }
    };

    return enrichedData;
  }

  // Helper methods for content analysis

  static getTimeOfDay(timestamp) {
    const hour = new Date(timestamp * 1000).getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  static countWords(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  static containsEmojis(text) {
    if (!text) return false;
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu;
    return emojiRegex.test(text);
  }

  static countEmojis(text) {
    if (!text) return 0;
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu;
    const matches = text.match(emojiRegex);
    return matches ? matches.length : 0;
  }

  static extractEmojis(text) {
    if (!text) return [];
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu;
    const matches = text.match(emojiRegex);
    return matches ? [...new Set(matches)] : [];
  }

  static analyzeSentiment(text) {
    if (!text) return 'neutral';
    
    // Simple sentiment analysis based on keywords
    const positiveWords = ['good', 'great', 'excellent', 'happy', 'love', 'wonderful', 'amazing', 'best', 'thank', 'thanks', '😊', '😃', '❤️', '👍'];
    const negativeWords = ['bad', 'terrible', 'hate', 'worst', 'angry', 'sad', 'disappointed', 'problem', 'issue', '😢', '😡', '👎'];
    
    const lowerText = text.toLowerCase();
    let positiveScore = 0;
    let negativeScore = 0;
    
    positiveWords.forEach(word => {
      if (lowerText.includes(word)) positiveScore++;
    });
    
    negativeWords.forEach(word => {
      if (lowerText.includes(word)) negativeScore++;
    });
    
    if (positiveScore > negativeScore) return 'positive';
    if (negativeScore > positiveScore) return 'negative';
    return 'neutral';
  }

  static detectLanguage(text) {
    if (!text) return 'unknown';
    
    // Simple language detection based on character sets
    const arabicRegex = /[\u0600-\u06FF]/;
    const chineseRegex = /[\u4E00-\u9FFF]/;
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF]/;
    const koreanRegex = /[\uAC00-\uD7AF]/;
    const devanagariRegex = /[\u0900-\u097F]/; // Hindi
    const cyrillicRegex = /[\u0400-\u04FF]/; // Russian
    
    if (arabicRegex.test(text)) return 'arabic';
    if (chineseRegex.test(text)) return 'chinese';
    if (japaneseRegex.test(text)) return 'japanese';
    if (koreanRegex.test(text)) return 'korean';
    if (devanagariRegex.test(text)) return 'hindi';
    if (cyrillicRegex.test(text)) return 'russian';
    
    // Default to English for Latin characters
    return 'english';
  }

  static detectLanguages(messages) {
    const languages = messages.map(msg => this.detectLanguage(msg.body));
    return [...new Set(languages)].filter(lang => lang !== 'unknown');
  }

  static extractUrlsFromText(text) {
    if (!text) return [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = text.match(urlRegex);
    return matches ? matches.map(url => ({
      url: url,
      domain: this.extractDomain(url),
      type: this.classifyUrl(url)
    })) : [];
  }

  static extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return 'unknown';
    }
  }

  static classifyUrl(url) {
    if (url.includes('drive.google.com')) return 'google-drive';
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('facebook.com') || url.includes('fb.com')) return 'facebook';
    if (url.includes('instagram.com')) return 'instagram';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
    if (url.includes('linkedin.com')) return 'linkedin';
    if (url.includes('github.com')) return 'github';
    if (url.includes('wa.me') || url.includes('whatsapp.com')) return 'whatsapp';
    return 'other';
  }

  static extractMentionsFromText(text) {
    if (!text) return [];
    const mentionRegex = /@(\+?\d{1,15})/g;
    const matches = [...text.matchAll(mentionRegex)];
    return matches.map(match => match[0]);
  }

  static extractHashtagsFromText(text) {
    if (!text) return [];
    const hashtagRegex = /#(\w+)/g;
    const matches = [...text.matchAll(hashtagRegex)];
    return matches.map(match => match[0]);
  }

  static extractKeywords(messages) {
    // Extract top keywords from all messages
    const allText = messages.map(msg => msg.body).filter(Boolean).join(' ');
    const words = allText.toLowerCase().split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !this.isStopWord(word));
    
    const wordFreq = {};
    words.forEach(word => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });
    
    return Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, freq]) => ({ word, frequency: freq }));
  }

  static isStopWord(word) {
    const stopWords = ['the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'of', 'in', 'to', 'for', 'with', 'as', 'by', 'that', 'this', 'it', 'from', 'be', 'are', 'was', 'were', 'been'];
    return stopWords.includes(word);
  }

  static extractUrls(messages) {
    const allUrls = [];
    messages.forEach(msg => {
      const urls = this.extractUrlsFromText(msg.body);
      allUrls.push(...urls);
    });
    return allUrls;
  }

  static extractMentions(messages) {
    const allMentions = [];
    messages.forEach(msg => {
      const mentions = this.extractMentionsFromText(msg.body);
      allMentions.push(...mentions);
    });
    return [...new Set(allMentions)];
  }

  static extractHashtags(messages) {
    const allHashtags = [];
    messages.forEach(msg => {
      const hashtags = this.extractHashtagsFromText(msg.body);
      allHashtags.push(...hashtags);
    });
    return [...new Set(allHashtags)];
  }

  static generateMessageHash(message) {
    const content = `${message.id._serialized}-${message.author}-${message.timestamp}-${message.body}`;
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  static generateGroupHash(group) {
    const content = `${group.author}-${group.timestamp}-${group.messages.length}`;
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
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