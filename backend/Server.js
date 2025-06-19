const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { Server } = require('socket.io');
const http = require('http');
const cors = require('cors');
const RSS = require('rss');
const fs = require('fs-extra');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
console.log('Server.js starting...');
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use('/rss', express.static(path.join(__dirname, 'rss')));

// Global variables
let client = null;
let isAuthenticated = false;
let selectedGroup = null;
let selectedUser = null;
let messageHistory = [];
let groupedMessages = new Map();
let rssFeed = null;

// Ensure RSS directory exists
fs.ensureDirSync('./rss');
fs.ensureDirSync('./backups');
fs.ensureDirSync('./media'); // For saving downloaded media


// Initialize RSS Feed
function initializeRSSFeed() {
  rssFeed = new RSS({
    title: 'WhatsApp Monitor Feed',
    description: 'Real-time WhatsApp group messages',
    feed_url: 'http://localhost:3001/rss/feed.xml',
    site_url: 'http://localhost:3001',
    language: 'en'
  });
}

// Group messages within 5 minutes
function groupMessages(messages) {
  const grouped = [];
  let currentGroup = null;
  
  messages.forEach(msg => {
    if (!currentGroup || 
        currentGroup.author !== msg.author || 
        moment(msg.timestamp * 1000).diff(moment(currentGroup.timestamp * 1000), 'minutes') > 5) {
      
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

// Update RSS Feed
function updateRSSFeed(messageGroup) {
  if (!rssFeed) return;

  let description = '';
  let title = `Messages from ${messageGroup.author}`;

  messageGroup.messages.forEach(msg => {
    if (msg.type === 'chat') {
      description += `<p>${msg.body}</p>`;
    } else if (msg.hasMedia) {
      description += `<p>[${msg.type.toUpperCase()}] ${msg.body || 'Media file'}</p>`;
    }
  });

  rssFeed.item({
    title: title,
    description: description,
    url: `http://localhost:3001/message/${messageGroup.id}`,
    date: new Date(messageGroup.timestamp * 1000),
    guid: messageGroup.id
  });

  // Save both feed.xml and messages.json
  fs.writeFileSync('./rss/feed.xml', rssFeed.xml());
  fs.writeFileSync('./rss/messages.json', JSON.stringify(messageHistory, null, 2));

  console.log('✅ RSS feed and messageHistory exported');
}


// Initialize WhatsApp Client
function initializeWhatsAppClient() {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  client.on('qr', (qr) => {
    console.log('Received QR event');
    qrcode.toDataURL(qr, (err, url) => {
      if (err) {
        console.error('Error generating QR code:', err);
        return;
      }
      io.emit('qr', url);
    });
  });

  client.on('ready', () => {
    console.log('WhatsApp client is ready!');
    isAuthenticated = true;
    io.emit('authenticated');
  });

  client.on('authenticated', () => {
    console.log('WhatsApp client authenticated');
    isAuthenticated = true;
    io.emit('authenticated');
  });

  client.on('auth_failure', (msg) => {
    console.error('Authentication failed:', msg);
    isAuthenticated = false;
    io.emit('auth_failure', msg);
  });

  client.on('disconnected', (reason) => {
    console.log('WhatsApp client disconnected:', reason);
    isAuthenticated = false;
    io.emit('disconnected', reason);
  });

  client.on('message', async (message) => {
    console.log('Received message:', message.body);
    if (!selectedGroup || !message.from.includes('@g.us')) return;
    
    if (message.from !== selectedGroup.id) return;
    
    // Filter by user if specified
    if (selectedUser && message.author !== selectedUser) return;
    
    let mediaPath = null;

if (message.hasMedia) {
  console.log(`📦 Message from ${message.author} has media, attempting to download...`);

  try {
    const media = await message.downloadMedia();

    if (!media) {
      console.log('⚠️ media is null or undefined');
    } else if (!media.data) {
      console.log('⚠️ media.data is missing');
    } else {
      console.log('✅ Media object received:', {
        mimetype: media.mimetype,
        filename: media.filename,
      });

      const ext = media.mimetype.split('/')[1] || 'bin';
      const filename = `media_${Date.now()}.${ext}`;
      const mediaPath = path.join(__dirname, 'media', filename);

      fs.writeFileSync(mediaPath, media.data, { encoding: 'base64' });
      console.log(`✅ Media saved to: ${mediaPath}`);
    }
  } catch (err) {
    console.error('❌ Error while downloading media:', err);
  }
}


const messageData = {
  id: message.id._serialized,
  body: message.body,
  author: message.author,
  timestamp: message.timestamp,
  type: message.type,
  hasMedia: message.hasMedia,
  from: message.from,
  mediaPath // <-- this is the relative path to the downloaded media
};

    
    messageHistory.push(messageData);
    
    // Group messages and update RSS
    const grouped = groupMessages([messageData]);
    if (grouped.length > 0) {
      updateRSSFeed(grouped[0]);
      io.emit('new_message', grouped[0]);
    }
  });

  client.initialize();
}

// API Routes
app.get('/api/status', (req, res) => {
  res.json({ 
    authenticated: isAuthenticated,
    selectedGroup: selectedGroup?.name || null,
    selectedUser: selectedUser || null
  });
});

app.get('/api/groups', async (req, res) => {
    console.log('GET /api/groups');

  if (!isAuthenticated || !client) {
    return res.status(401).json({ error: 'WhatsApp not authenticated' });
  }
  
  try {
    const chats = await client.getChats();
    const groups = chats
      .filter(chat => chat.isGroup)
      .map(group => ({
        id: group.id._serialized,
        name: group.name,
        participantCount: group.participants.length
      }));
    
    res.json(groups);
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

app.post('/api/select-group', async (req, res) => {
    console.log('POST /api/select-group', req.body);

  const { groupId } = req.body;
  
  if (!isAuthenticated || !client) {
    return res.status(401).json({ error: 'WhatsApp not authenticated' });
  }
  
  try {
    const chat = await client.getChatById(groupId);
    selectedGroup = {
      id: groupId,
      name: chat.name,
      participants: chat.participants
    };
    
    // Reset message history and RSS feed
    messageHistory = [];
    initializeRSSFeed();
    
    res.json({ success: true, group: selectedGroup });
  } catch (error) {
    console.error('Error selecting group:', error);
    res.status(500).json({ error: 'Failed to select group' });
  }
});

app.get('/api/group-participants', async (req, res) => {
    console.log('GET /api/group-participants');
  if (!selectedGroup) {
    return res.status(400).json({ error: 'No group selected' });
  }
  
  try {
    const participants = selectedGroup.participants.map(p => ({
      id: p.id._serialized,
      name: p.pushname || p.id.user,
      isAdmin: p.isAdmin
    }));
    
    res.json(participants);
  } catch (error) {
    console.error('Error fetching participants:', error);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

app.post('/api/select-user', (req, res) => {
    console.log('POST /api/select-user', req.body);
  const { userId } = req.body;
  selectedUser = userId === 'all' ? null : userId;
  res.json({ success: true, selectedUser });
});

app.post('/api/fetch-history', async (req, res) => {
      console.log('POST /api/fetch-history', req.body);
  const { limit = 50 } = req.body;
  
  if (!selectedGroup || !client) {
    return res.status(400).json({ error: 'No group selected or client not ready' });
  }
  
  try {
    const chat = await client.getChatById(selectedGroup.id);
    const messages = await chat.fetchMessages({ limit });
    
    const processedMessages = await Promise.all(
  messages.map(async (msg) => {
    let mediaPath = null;

    if (msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();

        if (media && media.data) {
          const ext = media.mimetype.split('/')[1] || 'bin';
          const filename = `media_${Date.now()}_${msg.id.id}.${ext}`;
          mediaPath = path.join('media', filename); // relative for JSON
          const fullPath = path.join(__dirname, mediaPath);

          fs.writeFileSync(fullPath, media.data, { encoding: 'base64' });
          console.log(`✅ [History] Saved media for message ${msg.id._serialized} to ${mediaPath}`);
        } else {
          console.warn(`⚠️ [History] Media empty or null for ${msg.id._serialized}`);
        }
      } catch (err) {
        console.error(`❌ [History] Failed to download media for ${msg.id._serialized}:`, err.message);
      }
    }

    return {
      id: msg.id._serialized,
      body: msg.body,
      author: msg.author,
      timestamp: msg.timestamp,
      type: msg.type,
      hasMedia: msg.hasMedia,
      from: msg.from,
      mediaPath, // Will be null if no media or failed
    };
  })
);

    
    // Filter by user if specified
    const filteredMessages = selectedUser 
      ? processedMessages.filter(msg => msg.author === selectedUser)
      : processedMessages;
    
    messageHistory = filteredMessages.reverse();
    
    // Group messages and update RSS
    const grouped = groupMessages(messageHistory);
    grouped.forEach(group => updateRSSFeed(group));
    
    res.json({ messages: grouped });
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to fetch message history' });
  }
});

app.get('/api/messages', (req, res) => {
  const { grouped = true } = req.query;
  
  if (grouped === 'true') {
    const groupedMsgs = groupMessages(messageHistory);
    res.json(groupedMsgs);
  } else {
    res.json(messageHistory);
  }
});

app.post('/api/initialize', (req, res) => {
  if (!client) {
    initializeWhatsAppClient();
    initializeRSSFeed();
  }
  res.json({ success: true });
});

app.post('/api/backup-messages', (req, res) => {
  if (!messageHistory || messageHistory.length === 0) {
    return res.status(400).json({ error: 'No messages to backup' });
  }

  const timestamp = moment().format('YYYY-MM-DD_HH-mm-ss');
  const filename = `./backups/messages-${timestamp}.json`;

  try {
    fs.writeFileSync(filename, JSON.stringify(messageHistory, null, 2));
    res.json({ success: true, message: `Messages backed up to ${filename}` });
  } catch (err) {
    console.error('❌ Failed to write backup:', err);
    res.status(500).json({ error: 'Failed to write backup file' });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.emit('status', {
    authenticated: isAuthenticated,
    selectedGroup: selectedGroup?.name || null,
    selectedUser: selectedUser || null
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});