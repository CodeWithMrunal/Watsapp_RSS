# WhatsApp Monitor Server (Modular Version)

A modular Node.js server that monitors WhatsApp group messages and generates RSS feeds in real-time.

## 🏗️ Architecture

The application has been refactored into a modular architecture for better maintainability:

```
├── server.js                 # Main entry point
├── config/
│   └── index.js              # Configuration settings
├── services/
│   ├── WhatsAppManager.js    # WhatsApp client management
│   ├── RSSManager.js         # RSS feed generation
│   └── SocketManager.js      # WebSocket connection handling
├── routes/
│   └── api.js                # API route definitions
├── utils/
│   ├── fileUtils.js          # File operations utilities
│   └── messageUtils.js       # Message processing utilities
├── rss/                      # Generated RSS feeds
├── media/                    # Downloaded media files
└── backups/                  # Message backups
```

## 🚀 Features

- **Modular Design**: Clean separation of concerns with dedicated modules
- **WhatsApp Integration**: Real-time message monitoring
- **RSS Feed Generation**: Automatic RSS feed creation for messages
- **Media Download**: Automatic download and serving of media files
- **WebSocket Support**: Real-time updates to connected clients
- **Message Grouping**: Intelligent grouping of messages by author and time
- **Backup System**: JSON backup functionality for messages
- **User Filtering**: Filter messages by specific group participants

## 📦 Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
   Or for development with auto-restart:
   ```bash
   npm run dev
   ```

## 🔧 Configuration

All configuration is centralized in `config/index.js`:

- **Server settings**: Port, CORS configuration
- **Directory paths**: RSS, backups, media directories
- **WhatsApp settings**: Puppeteer configuration
- **RSS settings**: Feed metadata
- **Message settings**: Grouping timeout

## 📡 API Endpoints

- `GET /api/status` - Get server and authentication status
- `GET /api/groups` - List available WhatsApp groups
- `POST /api/select-group` - Select a group to monitor
- `GET /api/group-participants` - Get participants of selected group
- `POST /api/select-user` - Filter messages by specific user
- `POST /api/fetch-history` - Fetch message history from selected group
- `GET /api/messages` - Get processed messages (grouped or individual)
- `POST /api/initialize` - Initialize WhatsApp client
- `POST /api/backup-messages` - Create backup of message history
- `GET /health` - Health check endpoint

## 🌐 Static File Serving

- `/rss/` - RSS feed files
- `/media/` - Downloaded media files (images, videos, documents)

## 🔄 WebSocket Events

### Client → Server
- `connection` - Client connects to server
- `disconnect` - Client disconnects

### Server → Client
- `qr` - QR code for WhatsApp authentication
- `authenticated` - WhatsApp client successfully authenticated
- `auth_failure` - Authentication failed
- `disconnected` - WhatsApp client disconnected
- `new_message` - New message received
- `status` - Current server status

## 🏃‍♂️ Usage Flow

1. **Start Server**: Run `npm start`
2. **Initialize WhatsApp**: POST to `/api/initialize`
3. **Authenticate**: Scan QR code when prompted
4. **Select Group**: POST to `/api/select-group` with groupId
5. **Optional User Filter**: POST to `/api/select-user` with userId
6. **Fetch History**: POST to `/api/fetch-history` (optional)
7. **Monitor**: Real-time messages will be processed and RSS updated

## 📂 File Structure Details

### Services
- **WhatsAppManager**: Handles all WhatsApp Web.js operations, message processing, and media downloads
- **RSSManager**: Manages RSS feed generation and updates
- **SocketManager**: Handles WebSocket connections and real-time communication

### Utils
- **FileUtils**: File system operations, directory management, and media saving
- **MessageUtils**: Message processing, grouping, filtering, and data transformation

### Routes
- **API Routes**: All REST API endpoints with proper error handling

## 🔧 Key Improvements

### From Original Monolithic Structure:
1. **Separation of Concerns**: Each module has a single responsibility
2. **Better Error Handling**: Centralized error handling with proper HTTP status codes
3. **Configuration Management**: All settings in one place
4. **Code Reusability**: Utility functions can be used across modules
5. **Easier Testing**: Each module can be tested independently
6. **Better Maintainability**: Changes to one feature don't affect others
7. **Scalability**: Easy to add new features or modify existing ones

## 🛠️ Development

### Adding New Features
1. Create new service in `services/` for major functionality
2. Add utilities in `utils/` for reusable functions
3. Create routes in `routes/` for new API endpoints
4. Update configuration in `config/` if needed

### Error Handling
All modules use consistent error handling patterns:
- Services throw errors with descriptive messages
- Routes catch errors and return appropriate HTTP status codes
- Utilities return success/failure boolean values where applicable

## 🔒 Security Considerations

- CORS is configured for specific origins
- No sensitive data exposed in error messages
- File uploads are handled securely with proper extensions
- WhatsApp authentication uses LocalAuth strategy

## 📝 Logging

Consistent logging throughout the application:
- `✅` Success operations
- `❌` Error operations  
- `📦` Media-related operations
- `🔁` Duplicate/existing data operations
- `⚠️` Warning conditions

## 🚀 Deployment

For production deployment:
1. Set `NODE_ENV=production`
2. Configure proper CORS origins in `config/index.js`
3. Ensure proper directory permissions for `rss/`, `media/`, and `backups/`
4. Consider using PM2 or similar process manager
5. Set up proper logging and monitoring

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Follow the existing modular architecture
4. Add proper error handling and logging
5. Update documentation if needed
6. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details