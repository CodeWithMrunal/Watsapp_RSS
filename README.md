# Complete Backend Overview: WhatsApp Monitor System
### How to setup and run:
1. start postgres: `brew services start postgresql@14`
2. connect to postgres CLI: `psql -U mrunal.a -d whatsapp_monitor_dev`

1. git clone the repo
2. run the bash script inside the scripts folder to setup env and setup postgres tables.
3. go inside the backend folder and run `npm install`
4. go inside the frontend folder and run `npm init`
5. go inside the selenium folder and run `pip install -r requirements.txt`
6. run the Server.js file using `node Server.js`
7. open another terminal and run `npm run dev` to start the frontend 
8. go to the selenium folder to run `python sele_vd_downloader3.py`

RESET DATABASE:
`npx sequelize-cli db:migrate:undo:all`
RECREATE THE TABLES:
`npx sequelize-cli db:migrate`

view all tables: `\d`
view schema of a particular table: `\d <table name>`

if you encounter _serialized error, then update the whatsapp_web.js module: `npm install whatsapp-web.js@latest`
## **High-Level Architecture**

Your backend is a **real-time WhatsApp message monitoring system** that captures group messages, downloads media, generates RSS feeds, and provides a web API. Here's how everything connects:

```
Frontend (React) ↔ Socket.IO ↔ WhatsApp Web.js ↔ RSS Feed Generation
                    ↕                ↕              ↕
                 WebSocket      Message Processing   File Storage
                   API           Media Download      (JSON/XML)
```

---

## **🚀 Entry Point: server.js**

### **What it does:**
- **Main orchestrator** - Creates and starts the entire system
- **Sets up HTTP server** with Socket.IO for real-time communication
- **Initializes all services** (RSS, WhatsApp, Socket managers)
- **Configures middleware** (CORS, static file serving)

### **Control Flow:**
```javascript
1. WhatsAppMonitorServer constructor()
2. initialize() → Creates all managers
3. setupMiddleware() → CORS + static files
4. setupRoutes() → API endpoints
5. start() → Server listens on port 3001
```

### **Key Features:**
- **Static file serving**: `/media/` and `/rss/` endpoints
- **Health check**: `/health` endpoint for monitoring
- **Graceful shutdown**: Handles SIGINT/SIGTERM properly

---

## **⚙️ Configuration: config/index.js**

### **What it does:**
- **Centralizes all settings** for the entire application
- **Environment-specific configs** (ports, CORS, paths)

### **Key Sections:**
```javascript
server: {
  port: 3001,
  cors: { origin: "http://localhost:5173" }  // React dev server
}

directories: {
  rss: './rss',      // RSS feed files
  backups: './backups', // Message backups
  media: './media'   // Downloaded images/videos
}

whatsapp: {
  puppeteer: { headless: true }  // Chrome browser settings
}

rss: {
  title: 'WhatsApp Monitor Feed',  // RSS metadata
  feed_url: 'http://localhost:3001/rss/feed.xml'
}

messaging: {
  groupTimeoutMinutes: 5  // How long to group messages from same user
}
```

---

## **🔌 API Layer: routes/api.js**

### **What it does:**
- **RESTful API endpoints** for frontend communication
- **Bridges frontend requests** to WhatsApp manager
- **Handles errors and responses** consistently

### **Endpoint Breakdown:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/status` | GET | Check WhatsApp connection status |
| `/groups` | GET | Get all WhatsApp groups |
| `/select-group` | POST | Choose which group to monitor |
| `/group-participants` | GET | Get members of selected group |
| `/select-user` | POST | Filter by specific user |
| `/fetch-history` | POST | Load past messages |
| `/messages` | GET | Get current message history |
| `/initialize` | POST | Start WhatsApp client |
| `/logout` | POST | **NEW** - Logout and clear session |
| `/backup-messages` | POST | Save messages to backup file |

### **Error Handling Pattern:**
```javascript
try {
  const result = await whatsappManager.someMethod();
  res.json({ success: true, data: result });
} catch (error) {
  console.error('Error:', error);
  res.status(500).json({ error: error.message });
}
```

---

## **📱 WhatsApp Core: services/WhatsAppManager.js**

### **What it does:**
- **Main brain** of the system - handles all WhatsApp interactions
- **Manages authentication** (QR codes, session storage)
- **Processes incoming messages** and downloads media
- **Coordinates with RSS manager** for feed updates

### **Key Components:**

#### **1. Authentication Flow:**
```javascript
initialize() → setupEventHandlers() → client.initialize()
    ↓
QR Code Generated → Frontend displays → User scans → Authenticated
    ↓
Session saved to .wwebjs_auth/ and .wwebjs_cache/
```

#### **2. Event Handlers:**
```javascript
'qr' → Generate QR code for frontend
'ready' → WhatsApp client authenticated
'authenticated' → Confirm authentication
'auth_failure' → Handle login errors
'disconnected' → Clean up and reset state
'message' → Process incoming messages
```

#### **3. Message Processing Pipeline:**
```javascript
handleIncomingMessage(message)
    ↓
1. Check if from selected group
2. Check if from selected user (if filtered)
3. Download media (if present)
4. Create message data object
5. Add to message history
6. Update RSS feed
7. Emit to frontend via Socket.IO
8. Update media index
```

#### **4. Media Download Process:**
```javascript
downloadMedia(message)
    ↓
1. Call message.downloadMedia() (WhatsApp Web.js)
2. Get media object (data + metadata)
3. Generate unique filename
4. Save to ./media/ directory using FileUtils
5. Return media path for storage
```

#### **5. Logout Process:**
```javascript
logout()
    ↓
1. Destroy WhatsApp client
2. Delete .wwebjs_auth/ and .wwebjs_cache/ folders
3. Reset all internal state
4. Reset RSS manager
5. Notify frontend via Socket.IO
```

---

## **📡 Real-time Communication: services/SocketManager.js**

### **What it does:**
- **WebSocket communication** between backend and frontend
- **Real-time updates** when new messages arrive
- **Connection management** for multiple clients

### **Socket Events:**
```javascript
// Server → Frontend
'qr' → QR code data URL
'authenticated' → Login successful
'auth_failure' → Login failed
'disconnected' → WhatsApp disconnected
'new_message' → New message received
'status' → Current system status

// Frontend → Server (handled in api.js)
HTTP requests for actions (initialize, logout, etc.)
```

---

## **📰 RSS Feed System: services/RSSManager.js**

### **What RSS Does & Why It's Important:**

#### **Purpose:**
RSS (Really Simple Syndication) is a **standardized format** for sharing content updates. Your system generates RSS feeds so that:

1. **External tools can consume** WhatsApp messages
2. **RSS readers can display** messages like news articles
3. **Other systems can integrate** with your WhatsApp data
4. **Historical messages persist** in a structured format

#### **How RSS Works in Your System:**
```javascript
updateFeed(messageGroup, messageHistory)
    ↓
1. Create RSS item with:
   - Title: "Messages from [user]"
   - Description: HTML formatted message content
   - URL: Link to message details
   - Date: Message timestamp
   - GUID: Unique message group ID

2. Generate XML file: ./rss/feed.xml
3. Save JSON backup: ./rss/messages.json
```

#### **RSS Feed Structure:**
```xml
<rss version="2.0">
  <channel>
    <title>WhatsApp Monitor Feed</title>
    <description>Real-time WhatsApp group messages</description>
    <item>
      <title>Messages from +1234567890</title>
      <description>&lt;p&gt;Hello world!&lt;/p&gt;</description>
      <url>http://localhost:3001/message/uuid-123</url>
      <pubDate>Sat, 21 Dec 2024 10:30:00 GMT</pubDate>
    </item>
  </channel>
</rss>
```

#### **Why RSS is Important:**
- **Universal format** - Any RSS reader can consume it
- **SEO friendly** - Search engines understand RSS
- **Integration ready** - Easy to connect with other tools
- **Backup mechanism** - Persistent storage of messages
- **Real-time updates** - Feed updates as new messages arrive

---

## **📁 File Management: utils/fileUtils.js**

### **What it does:**
- **File system operations** for media and data storage
- **Directory management** and creation
- **JSON serialization** for structured data

### **Key Functions:**

#### **1. Directory Setup:**
```javascript
ensureDirectories()
    ↓
Creates: ./rss/, ./backups/, ./media/ if they don't exist
```

#### **2. Media Storage:**
```javascript
saveMedia(mediaData, messageId)
    ↓
1. Extract file extension from MIME type
2. Generate unique filename: media_timestamp_messageId.ext
3. Save base64 data to ./media/ directory
4. Return relative file path
```

#### **3. Media Index:**
```javascript
updateMediaIndex(messageHistory)
    ↓
1. Filter messages with media
2. Create simplified media objects
3. Save to ./media/media.json
4. Used by your Selenium downloader integration
```

---

## **🔧 Message Processing: utils/messageUtils.js**

### **What it does:**
- **Message transformation** and formatting
- **Message grouping** logic for UI display
- **Data filtering** and sorting utilities

### **Key Functions:**

#### **1. Message Grouping:**
```javascript
groupMessages(messages)
    ↓
Groups messages from same user within 5 minutes into single UI blocks
```

#### **2. Message Data Creation:**
```javascript
createMessageData(message, mediaPath)
    ↓
Standardizes WhatsApp message format for internal use
```

#### **3. User Filtering:**
```javascript
filterMessagesByUser(messages, selectedUser)
    ↓
Shows only messages from specific user when filter applied
```

---

## **🔄 Complete Control Flow**

### **1. System Startup:**
```
server.js → Initialize all services → Start HTTP server → Ready for connections
```

### **2. WhatsApp Authentication:**
```
Frontend clicks "Connect" → POST /api/initialize → WhatsApp generates QR
→ Socket emits QR to frontend → User scans → Authentication complete
```

### **3. Group Selection:**
```
GET /api/groups → WhatsApp fetches group list → POST /api/select-group
→ Reset message history → Ready for monitoring
```

### **4. Message Processing (Real-time):**
```
WhatsApp message received → handleIncomingMessage() → Download media (if any)
→ Update message history → Update RSS feed → Emit to frontend → Update media.json
```

### **5. History Fetching:**
```
POST /api/fetch-history → WhatsApp fetches past messages → Process each message
→ Download missing media → Update RSS feed → Return grouped messages
```

### **6. Logout Process:**
```
POST /api/logout → Destroy WhatsApp client → Delete auth folders
→ Reset all state → Notify frontend → Ready for fresh login
```

---

## **📊 Data Flow Summary**

```
WhatsApp Messages → WhatsAppManager → MessageUtils → RSSManager
                                   ↓                    ↓
                              FileUtils              RSS Feed
                                   ↓                    ↓
                              Media Storage        feed.xml
                                   ↓                    ↓
                              media.json         messages.json
                                   ↓                    ↓
                          Selenium Integration    External Tools
```

---

## **🎯 Key Benefits of This Architecture**

1. **Modular Design** - Each service has a single responsibility
2. **Real-time Updates** - Socket.IO for instant message delivery
3. **Media Handling** - Automatic download and storage
4. **RSS Integration** - Standard format for external consumption
5. **Error Resilience** - Graceful handling of failures
6. **Scalable Structure** - Easy to add new features
7. **Clean Authentication** - Proper session management
8. **File Organization** - Structured storage for all data types

This backend provides a complete WhatsApp monitoring solution with real-time capabilities, media handling, RSS feed generation, and a clean API for frontend integration!

# WhatsApp Monitor - Docker Edition

A comprehensive WhatsApp monitoring application with automated link downloading capabilities.

## Quick Start for End Users

### Option 1: Use Pre-built Images (Recommended)

```bash
# 1. Create project directory
mkdir whatsapp-monitor && cd whatsapp-monitor

# 2. Download the production compose file
curl -O https://raw.githubusercontent.com/yourusername/whatsapp-monitor/main/docker-compose.prod.yml

# 3. Start the application
DOCKER_USERNAME=yourusername make install

 ### Option 2: Oneliner Install
 docker run -d --name whatsapp-monitor -p 80:8080 -p 3001:3001 yourusername/whatsapp-monitor-frontend:latest


 # For other users:
 ### 1. Create project directory
mkdir whatsapp-monitor
cd whatsapp-monitor

### 2. Create data directories  
mkdir -p data/{rss,media,backups,session,cache}

### 3. Download compose file
curl -O https://github.com/inmobi-glance/WhatsApp_Monitor/blob/single-instance/docker-compose.prod.yml


### 4. Start the application
docker-compose -f docker-compose.prod.yml up -d

### 5. Access the application
open http://localhost  ### macOS
### or visit http://localhost in any browser


RESET DATABASE:
npx sequelize-cli db:migrate:undo:all

create Databases:
npx sequelize-cli db:migrate

