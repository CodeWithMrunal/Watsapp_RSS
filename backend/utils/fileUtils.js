const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

class FileUtils {
  static ensureDirectories() {
    Object.values(config.directories).forEach(dir => {
      fs.ensureDirSync(dir);
    });
    console.log('✅ All directories ensured');
  }

  static saveMedia(mediaData, messageId, userMediaPath) {
    try {
      const ext = mediaData.mimetype.split('/')[1] || 'bin';
      const filename = `media_${Date.now()}_${messageId}.${ext}`;
      const fullPath = userMediaPath ? 
        path.join(userMediaPath, filename) : 
        path.join(__dirname, '..', 'media', filename);

      fs.ensureDirSync(path.dirname(fullPath));
      fs.writeFileSync(fullPath, mediaData.data, { encoding: 'base64' });
      console.log(`✅ Media saved to: ${fullPath}`);
      
      return filename;
    } catch (error) {
      console.error('❌ Error saving media:', error);
      return null;
    }
  }

  static saveJSON(filePath, data) {
    try {
      fs.ensureDirSync(path.dirname(filePath));
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error(`❌ Error saving JSON to ${filePath}:`, error);
      return false;
    }
  }

  static groupMessagesByTimestamp(messages) {
    // Sort messages by timestamp
    const sortedMessages = messages.sort((a, b) => a.timestamp - b.timestamp);
    
    const groupedMessages = [];
    let currentGroup = null;
    
    for (const msg of sortedMessages) {
      // Extract group ID from the message ID (before @g.us)
      const groupId = msg.id.split('@g.us')[0];
      
      // Check if we should start a new group
      const shouldStartNewGroup = !currentGroup || 
        currentGroup.author !== msg.author ||
        currentGroup.groupId !== groupId ||
        (msg.timestamp - currentGroup.startTimestamp) > 300; // 5 minutes = 300 seconds
      
      if (shouldStartNewGroup) {
        // Create a new group
        currentGroup = {
          id: msg.id,
          author: msg.author,
          groupId: groupId,
          startTimestamp: msg.timestamp,
          endTimestamp: msg.timestamp,
          messages: [],
          media: [],
          texts: []
        };
        groupedMessages.push(currentGroup);
      }
      
      // Update the end timestamp
      currentGroup.endTimestamp = msg.timestamp;
      
      // Add message to the current group
      currentGroup.messages.push({
        id: msg.id,
        timestamp: msg.timestamp,
        type: msg.type,
        caption: msg.caption || msg.body || '',
        mediaPath: msg.mediaPath
      });
      
      // Organize by type
      if (msg.hasMedia && msg.mediaPath) {
        currentGroup.media.push({
          type: msg.type,
          mediaPath: msg.mediaPath,
          caption: msg.caption || msg.body || '',
          timestamp: msg.timestamp
        });
      } else if (msg.body && !msg.hasMedia) {
        currentGroup.texts.push({
          text: msg.body,
          timestamp: msg.timestamp
        });
      }
    }
    
    // Format the grouped messages for JSON output
    return groupedMessages.map(group => ({
      id: `${group.groupId}_${group.author}_${group.startTimestamp}`,
      author: group.author,
      groupId: group.groupId,
      startTimestamp: group.startTimestamp,
      endTimestamp: group.endTimestamp,
      duration: group.endTimestamp - group.startTimestamp,
      messageCount: group.messages.length,
      media: group.media,
      texts: group.texts,
      allMessages: group.messages
    }));
  }

  static updateMediaIndex(messageHistory, customPath = null) {
    // Filter messages (including text messages without media)
    const relevantMessages = messageHistory
      .filter(msg => msg.hasMedia || (msg.body && msg.body.trim() !== ''))
      .map(msg => ({
        id: msg.id,
        author: msg.author,
        timestamp: msg.timestamp,
        caption: msg.body || '',
        type: msg.type || 'text',
        mediaPath: msg.mediaPath || null,
        hasMedia: msg.hasMedia || false,
        body: msg.body || ''
      }));

    if (relevantMessages.length === 0) return;

    // Group messages by the 5-minute rule
    const groupedMessages = this.groupMessagesByTimestamp(relevantMessages);

    const mediaJsonPath = customPath || './media/media.json';
    const success = this.saveJSON(mediaJsonPath, groupedMessages);
    if (success) {
      console.log(`📦 media.json updated with ${groupedMessages.length} grouped entries from ${relevantMessages.length} messages`);
    }
  }
}

module.exports = FileUtils;