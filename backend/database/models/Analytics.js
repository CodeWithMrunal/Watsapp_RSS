const mongoose = require('mongoose');

const hourlyDistributionSchema = new mongoose.Schema({
  hour: { type: Number, required: true, min: 0, max: 23 },
  messageCount: { type: Number, default: 0 },
  mediaCount: { type: Number, default: 0 },
  activeAuthors: { type: Number, default: 0 }
}, { _id: false });

const mediaDistributionSchema = new mongoose.Schema({
  type: { type: String, required: true },
  count: { type: Number, default: 0 },
  totalSize: { type: Number, default: 0 },
  avgSize: { type: Number, default: 0 }
}, { _id: false });

const topEntitySchema = new mongoose.Schema({
  value: { type: String, required: true },
  count: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 }
}, { _id: false });

const analyticsSchema = new mongoose.Schema({
  // Identifiers
  groupId: { type: String, required: true, index: true },
  date: { type: String, required: true, index: true }, // YYYY-MM-DD format
  dateObj: { type: Date, required: true },
  
  // Time period
  periodType: { 
    type: String, 
    enum: ['daily', 'weekly', 'monthly'], 
    default: 'daily',
    index: true
  },
  startTimestamp: { type: Number, required: true },
  endTimestamp: { type: Number, required: true },
  
  // Message Statistics
  totalMessages: { type: Number, default: 0 },
  textMessages: { type: Number, default: 0 },
  mediaMessages: { type: Number, default: 0 },
  forwardedMessages: { type: Number, default: 0 },
  deletedMessages: { type: Number, default: 0 },
  
  // Author Statistics
  uniqueAuthors: { type: Number, default: 0 },
  newAuthors: { type: Number, default: 0 }, // First time posters
  topAuthors: [topEntitySchema],
  authorEngagement: {
    veryActive: { type: Number, default: 0 }, // >50 messages
    active: { type: Number, default: 0 },     // 10-50 messages
    moderate: { type: Number, default: 0 },   // 5-10 messages
    low: { type: Number, default: 0 }         // <5 messages
  },
  
  // Content Analysis
  totalWords: { type: Number, default: 0 },
  avgMessageLength: { type: Number, default: 0 },
  totalLinks: { type: Number, default: 0 },
  uniqueLinks: { type: Number, default: 0 },
  totalMentions: { type: Number, default: 0 },
  uniqueMentions: { type: Number, default: 0 },
  
  // Media Analysis
  mediaDistribution: [mediaDistributionSchema],
  totalMediaSize: { type: Number, default: 0 },
  largestMedia: {
    filename: { type: String },
    size: { type: Number },
    type: { type: String }
  },
  
  // Temporal Analysis
  hourlyDistribution: [hourlyDistributionSchema],
  peakHour: { type: Number }, // 0-23
  peakHourMessages: { type: Number },
  quietestHour: { type: Number },
  quietestHourMessages: { type: Number },
  
  // Link Analysis
  topDomains: [topEntitySchema],
  topPlatforms: [topEntitySchema],
  linkTypes: {
    cloudStorage: { type: Number, default: 0 },
    video: { type: Number, default: 0 },
    social: { type: Number, default: 0 },
    news: { type: Number, default: 0 },
    other: { type: Number, default: 0 }
  },
  
  // Language Analysis
  languages: [topEntitySchema],
  primaryLanguage: { type: String, default: 'unknown' },
  multilingualConversations: { type: Number, default: 0 },
  
  // Engagement Metrics
  avgResponseTime: { type: Number }, // in seconds
  conversationThreads: { type: Number, default: 0 },
  longestThread: {
    messageCount: { type: Number },
    duration: { type: Number }, // in seconds
    participants: { type: Number }
  },
  
  // Sentiment Analysis (placeholder for future ML integration)
  sentiment: {
    positive: { type: Number, default: 0 },
    neutral: { type: Number, default: 0 },
    negative: { type: Number, default: 0 }
  },
  
  // Anomalies and Alerts
  anomalies: [{
    type: { type: String },
    description: { type: String },
    severity: { type: String, enum: ['low', 'medium', 'high'] },
    value: { type: mongoose.Schema.Types.Mixed }
  }],
  
  // Processing metadata
  processedAt: { type: Date, default: Date.now },
  processingTime: { type: Number }, // in milliseconds
  version: { type: String, default: '2.0' }
}, {
  timestamps: true,
  collection: 'analytics'
});

// Compound indexes for efficient queries
analyticsSchema.index({ groupId: 1, date: -1 });
analyticsSchema.index({ groupId: 1, periodType: 1, dateObj: -1 });
analyticsSchema.index({ dateObj: -1 });

// Virtual for formatted date range
analyticsSchema.virtual('dateRange').get(function() {
  const start = new Date(this.startTimestamp * 1000);
  const end = new Date(this.endTimestamp * 1000);
  return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
});

// Virtual for message rate
analyticsSchema.virtual('messagesPerHour').get(function() {
  const hours = (this.endTimestamp - this.startTimestamp) / 3600;
  return hours > 0 ? Math.round(this.totalMessages / hours * 10) / 10 : 0;
});

// Instance methods
analyticsSchema.methods.toJSON = function() {
  const obj = this.toObject();
  obj.dateRange = this.dateRange;
  obj.messagesPerHour = this.messagesPerHour;
  delete obj.__v;
  return obj;
};

analyticsSchema.methods.detectAnomalies = function(previousAnalytics) {
  const anomalies = [];
  
  // Detect unusual message volume
  if (previousAnalytics && previousAnalytics.totalMessages > 0) {
    const changePercent = ((this.totalMessages - previousAnalytics.totalMessages) / previousAnalytics.totalMessages) * 100;
    
    if (Math.abs(changePercent) > 200) {
      anomalies.push({
        type: 'message_volume',
        description: `Message volume changed by ${changePercent.toFixed(0)}%`,
        severity: Math.abs(changePercent) > 500 ? 'high' : 'medium',
        value: { previous: previousAnalytics.totalMessages, current: this.totalMessages }
      });
    }
  }
  
  // Detect unusual author activity
  if (this.uniqueAuthors === 1 && this.totalMessages > 50) {
    anomalies.push({
      type: 'single_author_spam',
      description: 'High volume of messages from single author',
      severity: 'medium',
      value: { messages: this.totalMessages, author: this.topAuthors[0]?.value }
    });
  }
  
  // Detect unusual media volume
  const mediaPercent = (this.mediaMessages / this.totalMessages) * 100;
  if (mediaPercent > 80) {
    anomalies.push({
      type: 'high_media_volume',
      description: `${mediaPercent.toFixed(0)}% of messages contain media`,
      severity: 'low',
      value: { mediaMessages: this.mediaMessages, totalMessages: this.totalMessages }
    });
  }
  
  this.anomalies = anomalies;
  return anomalies;
};

// Static methods
analyticsSchema.statics.generateDailyAnalytics = async function(groupId, date) {
  const Message = require('./Message');
  const Media = require('./Media');
  const Link = require('./Link');
  const Author = require('./Author');
  
  // Set date boundaries
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  const startTimestamp = Math.floor(startOfDay.getTime() / 1000);
  const endTimestamp = Math.floor(endOfDay.getTime() / 1000);
  
  // Fetch messages for the day
  const messages = await Message.find({
    groupId,
    timestamp: { $gte: startTimestamp, $lte: endTimestamp }
  });
  
  if (messages.length === 0) {
    return null; // No analytics for days without messages
  }
  
  // Calculate basic statistics
  const analytics = new this({
    groupId,
    date: startOfDay.toISOString().split('T')[0],
    dateObj: startOfDay,
    periodType: 'daily',
    startTimestamp,
    endTimestamp,
    totalMessages: messages.length
  });
  
  // Process messages
  const authorCounts = {};
  const hourlyData = Array(24).fill(null).map((_, i) => ({ 
    hour: i, 
    messageCount: 0, 
    mediaCount: 0, 
    activeAuthors: new Set() 
  }));
  
  let totalWords = 0;
  const uniqueLinks = new Set();
  const uniqueMentions = new Set();
  
  messages.forEach(msg => {
    // Author statistics
    authorCounts[msg.author] = (authorCounts[msg.author] || 0) + 1;
    
    // Message type statistics
    if (msg.hasMedia) {
      analytics.mediaMessages++;
    } else {
      analytics.textMessages++;
    }
    
    if (msg.isForwarded) analytics.forwardedMessages++;
    
    // Content analysis
    if (msg.body) {
      totalWords += msg.body.split(/\s+/).filter(w => w.length > 0).length;
    }
    
    // Links and mentions
    msg.links?.forEach(link => uniqueLinks.add(link.url));
    msg.mentions?.forEach(mention => uniqueMentions.add(mention.phoneNumber));
    analytics.totalLinks += msg.linkCount || 0;
    analytics.totalMentions += msg.mentionCount || 0;
    
    // Hourly distribution
    const hour = new Date(msg.timestamp * 1000).getHours();
    hourlyData[hour].messageCount++;
    if (msg.hasMedia) hourlyData[hour].mediaCount++;
    hourlyData[hour].activeAuthors.add(msg.author);
  });
  
  // Set calculated values
  analytics.uniqueAuthors = Object.keys(authorCounts).length;
  analytics.totalWords = totalWords;
  analytics.avgMessageLength = totalWords / messages.length;
  analytics.uniqueLinks = uniqueLinks.size;
  analytics.uniqueMentions = uniqueMentions.size;
  
  // Top authors
  analytics.topAuthors = Object.entries(authorCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([author, count]) => ({
      value: author,
      count,
      percentage: (count / messages.length) * 100
    }));
  
  // Author engagement levels
  Object.values(authorCounts).forEach(count => {
    if (count > 50) analytics.authorEngagement.veryActive++;
    else if (count > 10) analytics.authorEngagement.active++;
    else if (count >= 5) analytics.authorEngagement.moderate++;
    else analytics.authorEngagement.low++;
  });
  
  // Process hourly distribution
  analytics.hourlyDistribution = hourlyData.map(data => ({
    hour: data.hour,
    messageCount: data.messageCount,
    mediaCount: data.mediaCount,
    activeAuthors: data.activeAuthors.size
  }));
  
  // Find peak and quiet hours
  const sortedHours = [...analytics.hourlyDistribution].sort((a, b) => b.messageCount - a.messageCount);
  analytics.peakHour = sortedHours[0].hour;
  analytics.peakHourMessages = sortedHours[0].messageCount;
  analytics.quietestHour = sortedHours[sortedHours.length - 1].hour;
  analytics.quietestHourMessages = sortedHours[sortedHours.length - 1].messageCount;
  
  // Get media statistics
  const mediaStats = await Media.getStorageStatistics(groupId);
  analytics.mediaDistribution = mediaStats.byType;
  analytics.totalMediaSize = mediaStats.total.totalSize;
  
  // Get link statistics
  const linkStats = await Link.getPlatformStatistics(groupId);
  analytics.topPlatforms = linkStats.slice(0, 5).map(stat => ({
    value: stat.platform,
    count: stat.count,
    percentage: (stat.count / analytics.totalLinks) * 100
  }));
  
  // Check for anomalies
  const previousDay = new Date(startOfDay);
  previousDay.setDate(previousDay.getDate() - 1);
  const previousAnalytics = await this.findOne({
    groupId,
    date: previousDay.toISOString().split('T')[0]
  });
  
  if (previousAnalytics) {
    analytics.detectAnomalies(previousAnalytics);
  }
  
  // Record processing time
  analytics.processingTime = Date.now() - analytics.processedAt.getTime();
  
  return analytics.save();
};

analyticsSchema.statics.getGroupTrends = async function(groupId, days = 30) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.find({
    groupId,
    periodType: 'daily',
    dateObj: { $gte: startDate, $lte: endDate }
  })
  .sort({ dateObj: 1 })
  .select('date totalMessages uniqueAuthors mediaMessages totalLinks');
};

analyticsSchema.statics.getGroupSummary = async function(groupId, startDate, endDate) {
  const match = {
    groupId,
    periodType: 'daily'
  };
  
  if (startDate) match.dateObj = { $gte: startDate };
  if (endDate) match.dateObj = { ...match.dateObj, $lte: endDate };
  
  const summary = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalDays: { $sum: 1 },
        totalMessages: { $sum: '$totalMessages' },
        totalMediaMessages: { $sum: '$mediaMessages' },
        totalLinks: { $sum: '$totalLinks' },
        avgDailyMessages: { $avg: '$totalMessages' },
        avgUniqueAuthors: { $avg: '$uniqueAuthors' },
        maxDailyMessages: { $max: '$totalMessages' },
        minDailyMessages: { $min: '$totalMessages' }
      }
    }
  ]);
  
  return summary[0] || null;
};

const Analytics = mongoose.model('Analytics', analyticsSchema);

module.exports = Analytics;