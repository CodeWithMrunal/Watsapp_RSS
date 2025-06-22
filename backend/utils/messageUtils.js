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

  static createMessageData(message, mediaPath = null) {
    // Clean the message body to remove duplicate links
    const cleanedBody = this.cleanDuplicateLinks(message.body);
    
    return {
      id: message.id._serialized,
      body: cleanedBody, // Use cleaned body
      originalBody: message.body, // Keep original if needed for reference
      author: message.author,
      timestamp: message.timestamp,
      type: message.type,
      hasMedia: message.hasMedia,
      from: message.from,
      mediaPath
    };
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