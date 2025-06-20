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

  static createMessageData(message, mediaPath = null) {
    return {
      id: message.id._serialized,
      body: message.body,
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