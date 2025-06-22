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

  /**
   * Format message body for RSS feed
   * Converts plain text with links to proper HTML
   */
  formatMessageForRSS(body) {
    if (!body) return '';
    
    // Escape HTML characters
    let formatted = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    
    // Convert URLs to clickable links
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    formatted = formatted.replace(urlRegex, '<a href="$1" target="_blank">$1</a>');
    
    // Convert newlines to <br> tags for better formatting
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
  }

  updateFeed(messageGroup, messageHistory) {
    if (!this.rssFeed) return;

    let description = '';
    let title = `Messages from ${messageGroup.author}`;
    let mediaCount = 0;
    let linkCount = 0;

    // Process each message in the group
    messageGroup.messages.forEach(msg => {
      if (msg.type === 'chat' && msg.body) {
        // Format the message body for RSS
        const formattedBody = this.formatMessageForRSS(msg.body);
        description += `<div style="margin-bottom: 10px;">${formattedBody}</div>`;
        
        // Count links in the message (after cleaning)
        const links = msg.body.match(/https?:\/\/[^\s]+/g) || [];
        linkCount += links.length;
      } else if (msg.hasMedia) {
        mediaCount++;
        const mediaType = msg.type.toUpperCase();
        const mediaDescription = msg.body ? this.formatMessageForRSS(msg.body) : 'Media file';
        description += `<div style="margin-bottom: 10px;"><strong>[${mediaType}]</strong> ${mediaDescription}</div>`;
      }
    });

    // Add metadata to description if there are media files or links
    if (mediaCount > 0 || linkCount > 0) {
      description += '<hr style="margin: 15px 0;"><small style="color: #666;">';
      if (mediaCount > 0) {
        description += `📎 Contains ${mediaCount} media file${mediaCount > 1 ? 's' : ''}`;
      }
      if (linkCount > 0) {
        description += `${mediaCount > 0 ? ' • ' : ''}🔗 ${linkCount} link${linkCount > 1 ? 's' : ''}`;
      }
      description += '</small>';
    }

    // Create RSS item
    this.rssFeed.item({
      title: title,
      description: description,
      url: `http://localhost:3001/message/${messageGroup.id}`,
      date: new Date(messageGroup.timestamp * 1000),
      guid: messageGroup.id,
      categories: [messageGroup.type],
      custom_elements: [
        { 'content:encoded': `<![CDATA[${description}]]>` }
      ]
    });

    // Save both feed.xml and messages.json
    try {
      // Ensure RSS directory exists
      fs.ensureDirSync('./rss');
      
      // Save RSS feed with proper formatting
      const rssXml = this.rssFeed.xml({ indent: true });
      fs.writeFileSync('./rss/feed.xml', rssXml);
      
      // Save message history with cleaned content
      fs.writeFileSync('./rss/messages.json', JSON.stringify(messageHistory, null, 2));
      
      // Log success with stats
      const totalMessages = messageHistory.length;
      const latestGroupSize = messageGroup.messages.length;
      
      console.log('✅ RSS feed and messageHistory exported');
      console.log(`   📊 Total messages: ${totalMessages}`);
      console.log(`   📬 Latest group: ${latestGroupSize} message${latestGroupSize > 1 ? 's' : ''}`);
      
      if (linkCount > 0) {
        // Count original links if available
        const originalLinks = messageGroup.messages.reduce((count, msg) => {
          if (msg.originalBody) {
            const links = msg.originalBody.match(/https?:\/\/[^\s]+/g) || [];
            return count + links.length;
          }
          return count;
        }, 0);
        
        if (originalLinks > linkCount) {
          console.log(`   🔗 Links: ${linkCount} (cleaned from ${originalLinks})`);
        } else {
          console.log(`   🔗 Links: ${linkCount}`);
        }
      }
    } catch (error) {
      console.error('❌ Error updating RSS feed:', error);
    }
  }

  reset() {
    this.initialize();
  }
}

module.exports = RSSManager;