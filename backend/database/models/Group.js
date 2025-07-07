// database/models/Group.js
const mongoose = require('mongoose');

const groupStatisticsSchema = new mongoose.Schema({
  totalMessages: { type: Number, default: 0 },
  textMessages: { type: Number, default: 0 },
  mediaMessages: { type: Number, default: 0 },
  linkCount: { type: Number, default: 0 },
  mentionCount: { type: Number, default: 0 },
  mediaTypes: {
    image: { type: Number, default: 0 },
    video: { type: Number, default: 0 },
    audio: { type: Number, default: 0 },
    document: { type: Number, default: 0 },
    sticker: { type: Number, default: 0 },
    voice: { type: Number, default: 0 }
  }
}, { _id: false });

const groupSchema = new mongoose.Schema({
  // Core Identifiers
  id: { type: String, required: true, unique: true, index: true },
  groupId: { type: String, required: true },
  author: { type: String, required: true, index: true },
  authorNumber: { type: String },
  
  // Time Information
  startTimestamp: { type: Number, required: true },
  endTimestamp: { type: Number, required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  duration: { type: Number },
  durationMinutes: { type: Number },
  
  // Statistics
  messageCount: { type: Number, default: 0 },
  statistics: groupStatisticsSchema,
  
  // Aggregated Data References
  messageIds: [{ type: String }],
  mediaIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Media',default:[]}],
  linkIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Link' }],
  
  // Analysis
  averageMessageInterval: { type: Number },
  
  // Metadata
  createdAt: { type: Date, default: Date.now },
  version: { type: String, default: '2.0' }
}, {
  timestamps: true,
  collection: 'groups'
});

// Indexes
groupSchema.index({ groupId: 1, startTimestamp: -1 });
groupSchema.index({ author: 1, startTimestamp: -1 });
groupSchema.index({ duration: -1 });

// Virtual for formatted duration
groupSchema.virtual('formattedDuration').get(function() {
  const hours = Math.floor(this.duration / 3600);
  const minutes = Math.floor((this.duration % 3600) / 60);
  const seconds = this.duration % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
});

// Instance methods
groupSchema.methods.toJSON = function() {
  const obj = this.toObject();
  obj.formattedDuration = this.formattedDuration;
  delete obj.__v;
  return obj;
};

// Static methods
groupSchema.statics.findByGroupId = function(groupId, options = {}) {
  const query = this.find({ groupId });
  
  if (options.author) {
    query.where('author').equals(options.author);
  }
  
  if (options.minDuration) {
    query.where('duration').gte(options.minDuration);
  }
  
  if (options.startDate) {
    query.where('startTimestamp').gte(options.startDate);
  }
  
  if (options.endDate) {
    query.where('endTimestamp').lte(options.endDate);
  }
  
  return query
    .sort({ startTimestamp: options.sort || -1 })
    .limit(options.limit || 100)
    .skip(options.skip || 0);
};

const Group = mongoose.model('Group', groupSchema);

// ===========================================
// database/models/Author.js
// ===========================================

const authorActivitySchema = new mongoose.Schema({
  date: { type: String, required: true }, // YYYY-MM-DD format
  messageCount: { type: Number, default: 0 },
  mediaCount: { type: Number, default: 0 },
  linkCount: { type: Number, default: 0 },
  activeHours: [{ type: Number }] // Array of hours (0-23) when active
}, { _id: false });

const authorSchema = new mongoose.Schema({
  // Identifiers
  id: { type: String, required: true, unique: true, index: true }, // phone@format
  phoneNumber: { type: String, required: true },
  displayName: { type: String },
  
  // Statistics
  totalMessages: { type: Number, default: 0 },
  textMessages: { type: Number, default: 0 },
  mediaMessages: { type: Number, default: 0 },
  totalLinks: { type: Number, default: 0 },
  totalMentions: { type: Number, default: 0 },
  
  // Media breakdown
  mediaTypes: {
    image: { type: Number, default: 0 },
    video: { type: Number, default: 0 },
    audio: { type: Number, default: 0 },
    document: { type: Number, default: 0 },
    sticker: { type: Number, default: 0 },
    voice: { type: Number, default: 0 }
  },
  
  // Time analysis
  firstMessageTimestamp: { type: Number },
  lastMessageTimestamp: { type: Number },
  firstMessageDate: { type: Date },
  lastMessageDate: { type: Date },
  activeDays: { type: Number, default: 0 },
  
  // Engagement metrics
  averageMessageLength: { type: Number, default: 0 },
  averageMessagesPerDay: { type: Number, default: 0 },
  mediaPercentage: { type: Number, default: 0 },
  mostActiveHour: { type: Number }, // 0-23
  mostActiveDay: { type: String }, // Monday-Sunday
  
  // Group participation
  groups: [{ type: String }], // Array of groupIds
  groupCount: { type: Number, default: 0 },
  
  // Daily activity log (last 30 days)
  recentActivity: [authorActivitySchema],
  
  // Preferences and patterns
  preferredLanguage: { type: String, default: 'unknown' },
  emojiUsage: { type: Boolean, default: false },
  averageResponseTime: { type: Number }, // in seconds
  
  // Metadata
  createdAt: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now },
  version: { type: String, default: '2.0' }
}, {
  timestamps: true,
  collection: 'authors'
});

// Indexes
authorSchema.index({ phoneNumber: 1 });
authorSchema.index({ totalMessages: -1 });
authorSchema.index({ lastMessageTimestamp: -1 });
authorSchema.index({ groups: 1 });

// Virtual for activity status
authorSchema.virtual('activityStatus').get(function() {
  if (!this.lastMessageTimestamp) return 'inactive';
  
  const hoursSinceLastMessage = (Date.now() / 1000 - this.lastMessageTimestamp) / 3600;
  
  if (hoursSinceLastMessage < 1) return 'active';
  if (hoursSinceLastMessage < 24) return 'recently_active';
  if (hoursSinceLastMessage < 168) return 'active_this_week';
  return 'inactive';
});

// Instance methods
authorSchema.methods.updateStats = async function(message) {
  this.totalMessages += 1;
  
  if (message.hasMedia) {
    this.mediaMessages += 1;
    if (this.mediaTypes[message.type]) {
      this.mediaTypes[message.type] += 1;
    }
  } else {
    this.textMessages += 1;
  }
  
  this.totalLinks += message.linkCount || 0;
  this.totalMentions += message.mentionCount || 0;
  
  // Update timestamps
  if (!this.firstMessageTimestamp || message.timestamp < this.firstMessageTimestamp) {
    this.firstMessageTimestamp = message.timestamp;
    this.firstMessageDate = new Date(message.timestamp * 1000);
  }
  
  if (!this.lastMessageTimestamp || message.timestamp > this.lastMessageTimestamp) {
    this.lastMessageTimestamp = message.timestamp;
    this.lastMessageDate = new Date(message.timestamp * 1000);
  }
  
  // Update groups
  if (!this.groups.includes(message.groupId)) {
    this.groups.push(message.groupId);
    this.groupCount = this.groups.length;
  }
  
  this.lastUpdated = new Date();
  return this.save();
};

// Static methods
authorSchema.statics.getTopAuthors = function(limit = 10, groupId = null) {
  const match = {};
  if (groupId) match.groups = groupId;
  
  return this.find(match)
    .sort({ totalMessages: -1 })
    .limit(limit);
};

authorSchema.statics.findOrCreateByPhone = async function(phoneNumber, displayName = null) {
  const id = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
  const phoneNum = phoneNumber.replace('@c.us', '').replace('@g.us', '');
  
  const author = await this.findOneAndUpdate(
    { id },
    {
      $setOnInsert: {
        id,
        phoneNumber: phoneNum,
        totalMessages: 0,
        textMessages: 0,
        mediaMessages: 0,
        totalLinks: 0,
        totalMentions: 0,
        mediaTypes: {
          image: 0,
          video: 0,
          audio: 0,
          document: 0,
          sticker: 0,
          voice: 0
        },
        groups: [],
        groupCount: 0,
        recentActivity: [],
        preferredLanguage: 'unknown',
        emojiUsage: false,
        createdAt: new Date(),
        version: '2.0'
      },
      $set: {
        ...(displayName && { displayName }),
        lastUpdated: new Date()
      }
    },
    {
      upsert: true,
      new: true,
      runValidators: true
    }
  );
  
  return author;
};

const Author = mongoose.model('Author', authorSchema);

// ===========================================
// database/models/Link.js
// ===========================================

const linkSchema = new mongoose.Schema({
  // Identifiers
  url: { type: String, required: true, index: true },
  shortUrl: { type: String }, // Shortened version if applicable
  
  // Classification
  type: { 
    type: String, 
    enum: ['general', 'cloud_storage', 'video', 'code', 'social', 'news', 'shopping', 'other'],
    default: 'general'
  },
  platform: { type: String, index: true },
  domain: { type: String, index: true },
  
  // Source information
  messageId: { type: String, required: true, index: true },
  groupId: { type: String, required: true, index: true },
  author: { type: String, required: true, index: true },
  authorNumber: { type: String },
  
  // Metadata
  title: { type: String }, // Extracted from link preview
  description: { type: String },
  imageUrl: { type: String },
  favicon: { type: String },
  
  // Timestamps
  messageTimestamp: { type: Number },
  extractedAt: { type: Date, default: Date.now },
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  
  // Usage statistics
  occurrenceCount: { type: Number, default: 1 },
  clickCount: { type: Number, default: 0 },
  shareCount: { type: Number, default: 1 }, // How many times shared
  
  // Link validation
  isValid: { type: Boolean, default: true },
  lastChecked: { type: Date },
  httpStatus: { type: Number },
  redirectUrl: { type: String },
  
  // Analysis
  isSuspicious: { type: Boolean, default: false },
  suspiciousReason: { type: String },
  isShortened: { type: Boolean, default: false },
  
  // Version
  version: { type: String, default: '2.0' }
}, {
  timestamps: true,
  collection: 'links'
});

// Indexes
linkSchema.index({ domain: 1, platform: 1 });
linkSchema.index({ groupId: 1, extractedAt: -1 });
linkSchema.index({ author: 1, type: 1 });
linkSchema.index({ occurrenceCount: -1 });

// Text index for search
linkSchema.index({ url: 'text', title: 'text', description: 'text' });

// Virtual for display URL
linkSchema.virtual('displayUrl').get(function() {
  try {
    const urlObj = new URL(this.url);
    return urlObj.hostname + urlObj.pathname;
  } catch {
    return this.url;
  }
});

// Instance methods
linkSchema.methods.incrementOccurrence = async function() {
  this.occurrenceCount += 1;
  this.shareCount += 1;
  this.lastSeen = new Date();
  return this.save();
};

linkSchema.methods.recordClick = async function() {
  this.clickCount += 1;
  return this.save();
};

linkSchema.methods.validateLink = async function() {
  // Placeholder for link validation logic
  // Would use axios or similar to check HTTP status
  console.log(`Link validation for ${this.url} not implemented yet`);
  return true;
};

// Static methods
linkSchema.statics.findByDomain = function(domain, options = {}) {
  return this.find({ domain })
    .sort({ occurrenceCount: -1 })
    .limit(options.limit || 50);
};

linkSchema.statics.getPopularLinks = function(groupId = null, days = 7) {
  const match = {
    extractedAt: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
  };
  
  if (groupId) match.groupId = groupId;
  
  return this.find(match)
    .sort({ occurrenceCount: -1, clickCount: -1 })
    .limit(20);
};

linkSchema.statics.getPlatformStatistics = async function(groupId = null) {
  const match = {};
  if (groupId) match.groupId = groupId;
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$platform',
        count: { $sum: 1 },
        uniqueUrls: { $addToSet: '$url' },
        totalClicks: { $sum: '$clickCount' },
        totalShares: { $sum: '$shareCount' }
      }
    },
    {
      $project: {
        platform: '$_id',
        count: 1,
        uniqueUrls: { $size: '$uniqueUrls' },
        totalClicks: 1,
        totalShares: 1,
        _id: 0
      }
    },
    { $sort: { count: -1 } }
  ]);
};

const Link = mongoose.model('Link', linkSchema);

// Export all models
module.exports = {
  Group,
  Author,
  Link
};