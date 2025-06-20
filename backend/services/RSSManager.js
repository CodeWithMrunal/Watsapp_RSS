const RSS = require('rss');
const fs = require('fs-extra');
const config = require('../config');

class RSSManager {
  constructor() {
    this.rssFeed = null;
    this.initialize();
  }

  initialize() {
    this.rssFeed = new RSS(config.rss);
    console.log('✅ RSS Feed initialized');
  }

  updateFeed(messageGroup, messageHistory) {
    if (!this.rssFeed) return;

    let description = '';
    let title = `Messages from ${messageGroup.author}`;

    messageGroup.messages.forEach(msg => {
      if (msg.type === 'chat') {
        description += `<p>${msg.body}</p>`;
      } else if (msg.hasMedia) {
        description += `<p>[${msg.type.toUpperCase()}] ${msg.body || 'Media file'}</p>`;
      }
    });

    this.rssFeed.item({
      title: title,
      description: description,
      url: `http://localhost:3001/message/${messageGroup.id}`,
      date: new Date(messageGroup.timestamp * 1000),
      guid: messageGroup.id
    });

    // Save both feed.xml and messages.json
    try {
      fs.writeFileSync('./rss/feed.xml', this.rssFeed.xml());
      fs.writeFileSync('./rss/messages.json', JSON.stringify(messageHistory, null, 2));
      console.log('✅ RSS feed and messageHistory exported');
    } catch (error) {
      console.error('❌ Error updating RSS feed:', error);
    }
  }

  reset() {
    this.initialize();
  }
}

module.exports = RSSManager;