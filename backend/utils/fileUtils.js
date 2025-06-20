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

  static saveMedia(mediaData, messageId) {
    try {
      const ext = mediaData.mimetype.split('/')[1] || 'bin';
      const filename = `media_${Date.now()}_${messageId}.${ext}`;
      const mediaPath = path.join('media', filename);
      const fullPath = path.join(__dirname, '..', mediaPath);

      fs.writeFileSync(fullPath, mediaData.data, { encoding: 'base64' });
      console.log(`✅ Media saved to: ${mediaPath}`);
      
      return mediaPath;
    } catch (error) {
      console.error('❌ Error saving media:', error);
      return null;
    }
  }

  static saveJSON(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error(`❌ Error saving JSON to ${filePath}:`, error);
      return false;
    }
  }

  static updateMediaIndex(messageHistory) {
    const mediaItems = messageHistory
      .filter(msg => msg.hasMedia && msg.mediaPath)
      .map(msg => ({
        id: msg.id,
        author: msg.author,
        timestamp: msg.timestamp,
        caption: msg.body || '',
        type: msg.type,
        mediaPath: msg.mediaPath,
      }));

    if (mediaItems.length === 0) return;

    const success = this.saveJSON('./media/media.json', mediaItems);
    if (success) {
      console.log(`📦 media.json updated with ${mediaItems.length} items`);
    }
  }
}

module.exports = FileUtils;