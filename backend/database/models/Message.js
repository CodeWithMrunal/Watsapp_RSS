const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema({
  url: { type: String, required: true },
  type: { type: String, enum: ['general', 'cloud_storage', 'video', 'code', 'social'], default: 'general' },
  platform: { type: String, default: 'unknown' },
  extractedAt: { type: Date, default: Date.now }
}, { _id: false });

const mentionSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  position: { type: Number, required: true },
  raw: { type: String, required: true }
}, { _id: false });

const analysisSchema = new mongoose.Schema({
  wordCount: { type: Number, default: 0 },
  characterCount: { type: Number, default: 0 },
  lineCount: { type: Number, default: 0 },
  hasEmoji: { type: Boolean, default: false },
  language: { type: String, default: 'unknown' },
  contentType: [{ type: String }]
}, { _id: false });

const messageSchema = new mongoose.Schema({
  // Core Identifiers
  id: { type: String, required: true, unique: true, index: true },
  messageId: { type: String, required: true },
  groupId: { type: String, required: true, index: true },
  conversationId: { type: String },
  
  // Message Content
  body: { type: String, default: '' },
  originalBody: { type: String },
  contentHash: { type: String, index: true },
  
  // Author Information
  author: { type: String, required: true, index: true },
  authorNumber: { type: String },
  
  // Timestamps
  timestamp: { type: Number, required: true, index: true },
  createdAt: { type: Date, required: true },
  receivedAt: { type: Date, default: Date.now },
  
  // Message Type and Media
  type: { 
    type: String, 
    required: true,
    enum: ['chat', 'image', 'video', 'audio', 'album','document', 'sticker', 'ptt', 'location', 'vcard', 'revoked']
  },
  hasMedia: { type: Boolean, default: false },
  mediaPath: { type: String },
  mediaType: { type: String },
  mediaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Media' },
  
  // Communication Metadata
  from: { type: String, required: true },
  to: { type: String },
  broadcast: { type: Boolean, default: false },
  isForwarded: { type: Boolean, default: false },
  forwardingScore: { type: Number, default: 0 },
  isStatus: { type: Boolean, default: false },
  isStarred: { type: Boolean, default: false },
  
  // Extracted Entities
  links: [linkSchema],
  linkCount: { type: Number, default: 0 },
  mentions: [mentionSchema],
  mentionCount: { type: Number, default: 0 },
  
  // Content Analysis
  analysis: analysisSchema,
  
  // Reply Context
  hasQuotedMsg: { type: Boolean, default: false },
  quotedMsgId: { type: String },
  
  // Additional Metadata
  deviceType: { type: String, default: 'unknown' },
  isGif: { type: Boolean, default: false },
  isEphemeral: { type: Boolean, default: false },
  isViewOnce: { type: Boolean, default: false },
  
  // Processing Metadata
  processed: { type: Boolean, default: true },
  processedAt: { type: Date, default: Date.now },
  version: { type: String, default: '2.0' }
}, {
  timestamps: true,
  collection: 'messages'
});

// Compound indexes for efficient queries
messageSchema.index({ groupId: 1, timestamp: -1 });
messageSchema.index({ author: 1, timestamp: -1 });
messageSchema.index({ type: 1, timestamp: -1 });
messageSchema.index({ 'links.platform': 1 });
messageSchema.index({ createdAt: -1 });

// Text index for search
messageSchema.index({ body: 'text', 'links.url': 'text' });

// Virtual for formatted date
messageSchema.virtual('formattedDate').get(function() {
  return new Date(this.timestamp * 1000).toLocaleString();
});

// Instance methods
messageSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

messageSchema.methods.isMediaMessage = function() {
  return this.hasMedia && this.mediaPath;
};

messageSchema.methods.getMediaUrl = function(baseUrl = 'http://localhost:3001') {
  if (!this.mediaPath) return null;
  return `${baseUrl}/${this.mediaPath}`;
};

// Static methods
messageSchema.statics.findByGroup = function(groupId, options = {}) {
  const query = this.find({ groupId });
  
  if (options.startDate) {
    query.where('timestamp').gte(options.startDate);
  }
  
  if (options.endDate) {
    query.where('timestamp').lte(options.endDate);
  }
  
  if (options.author) {
    query.where('author').equals(options.author);
  }
  
  if (options.hasMedia !== undefined) {
    query.where('hasMedia').equals(options.hasMedia);
  }
  
  if (options.type) {
    query.where('type').equals(options.type);
  }
  
  return query
    .sort({ timestamp: options.sort || -1 })
    .limit(options.limit || 100)
    .skip(options.skip || 0);
};

messageSchema.statics.getGroupStatistics = async function(groupId, startDate, endDate) {
  const match = { groupId };
  if (startDate) match.timestamp = { $gte: startDate };
  if (endDate) match.timestamp = { ...match.timestamp, $lte: endDate };
  
  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalMessages: { $sum: 1 },
        uniqueAuthors: { $addToSet: '$author' },
        mediaMessages: { $sum: { $cond: ['$hasMedia', 1, 0] } },
        textMessages: { $sum: { $cond: ['$hasMedia', 0, 1] } },
        totalLinks: { $sum: '$linkCount' },
        totalMentions: { $sum: '$mentionCount' },
        avgMessageLength: { $avg: { $strLenCP: '$body' } },
        messageTypes: { $push: '$type' }
      }
    },
    {
      $project: {
        totalMessages: 1,
        uniqueAuthors: { $size: '$uniqueAuthors' },
        mediaMessages: 1,
        textMessages: 1,
        totalLinks: 1,
        totalMentions: 1,
        avgMessageLength: { $round: ['$avgMessageLength', 2] },
        messageTypes: 1
      }
    }
  ]);
  
  return stats[0] || null;
};

messageSchema.statics.searchMessages = function(searchTerm, options = {}) {
  return this.find(
    { $text: { $search: searchTerm } },
    { score: { $meta: 'textScore' } }
  )
  .sort({ score: { $meta: 'textScore' } })
  .limit(options.limit || 50);
};

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;