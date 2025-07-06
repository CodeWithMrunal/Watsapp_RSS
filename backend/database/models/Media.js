const mongoose = require('mongoose');

const dimensionsSchema = new mongoose.Schema({
  width: { type: Number },
  height: { type: Number },
  duration: { type: Number }, // For video/audio in seconds
  codec: { type: String },
  format: { type: String },
  bitrate: { type: Number },
  frameRate: { type: Number }
}, { _id: false });

const mediaSchema = new mongoose.Schema({
  // File Identifiers
  id: { type: String, required: true, unique: true, index: true },
  messageId: { type: String, required: true, index: true },
  filename: { type: String, required: true },
  originalFilename: { type: String },
  path: { type: String, required: true },
  fullPath: { type: String },
  
  // File Properties
  mimetype: { type: String, required: true },
  mediaType: { 
    type: String, 
    required: true,
    enum: ['image', 'video', 'audio', 'document', 'sticker','album'],
    index: true
  },
  extension: { type: String, required: true },
  fileHash: { type: String, unique: true, sparse: true, index: true },
  
  // Size Information
  fileSize: { type: Number, required: true },
  fileSizeKB: { type: Number },
  fileSizeMB: { type: Number },
  
  // Media Properties
  dimensions: dimensionsSchema,
  
  // Message Context
  author: { type: String, index: true },
  authorNumber: { type: String },
  groupId: { type: String, index: true },
  caption: { type: String, default: '' },
  
  // Timestamps
  messageTimestamp: { type: Number },
  savedAt: { type: Date, default: Date.now },
  fileCreated: { type: Date },
  fileModified: { type: Date },
  
  // Processing Status
  processed: { type: Boolean, default: true },
  processingError: { type: String },
  thumbnailGenerated: { type: Boolean, default: false },
  thumbnailPath: { type: String },
  thumbnailSize: { type: Number },
  
  // Additional Metadata
  isViewOnce: { type: Boolean, default: false },
  isForwarded: { type: Boolean, default: false },
  forwardingScore: { type: Number, default: 0 },
  
  // Storage and Access
  storageLocation: { type: String, default: 'local' }, // local, s3, cloudinary, etc.
  publicUrl: { type: String },
  cdnUrl: { type: String },
  expiresAt: { type: Date }, // For temporary/viewOnce media
  
  // Analytics
  downloadCount: { type: Number, default: 0 },
  lastAccessed: { type: Date },
  
  // Version
  version: { type: String, default: '2.0' }
}, {
  timestamps: true,
  collection: 'media'
});

// Indexes
mediaSchema.index({ groupId: 1, messageTimestamp: -1 });
mediaSchema.index({ author: 1, mediaType: 1 });
mediaSchema.index({ savedAt: -1 });
mediaSchema.index({ fileSize: 1 });

// Virtual for human-readable file size
mediaSchema.virtual('humanFileSize').get(function() {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (this.fileSize === 0) return '0 Bytes';
  const i = parseInt(Math.floor(Math.log(this.fileSize) / Math.log(1024)));
  return Math.round(this.fileSize / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
});

// Virtual for media URL
mediaSchema.virtual('url').get(function() {
  return this.publicUrl || `/media/${this.filename}`;
});

// Instance methods
mediaSchema.methods.toJSON = function() {
  const obj = this.toObject();
  obj.humanFileSize = this.humanFileSize;
  obj.url = this.url;
  delete obj.__v;
  delete obj.fullPath; // Don't expose full system path
  return obj;
};

mediaSchema.methods.incrementDownload = async function() {
  this.downloadCount += 1;
  this.lastAccessed = new Date();
  return this.save();
};

mediaSchema.methods.generateThumbnail = async function() {
  // Placeholder for thumbnail generation logic
  // Would use sharp for images or ffmpeg for videos
  console.log(`Thumbnail generation for ${this.filename} not implemented yet`);
  return null;
};

mediaSchema.methods.isExpired = function() {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
};

// Static methods
mediaSchema.statics.findByGroup = function(groupId, options = {}) {
  const query = this.find({ groupId });
  
  if (options.mediaType) {
    query.where('mediaType').equals(options.mediaType);
  }
  
  if (options.author) {
    query.where('author').equals(options.author);
  }
  
  if (options.startDate) {
    query.where('messageTimestamp').gte(options.startDate);
  }
  
  if (options.endDate) {
    query.where('messageTimestamp').lte(options.endDate);
  }
  
  if (options.minSize) {
    query.where('fileSize').gte(options.minSize);
  }
  
  if (options.maxSize) {
    query.where('fileSize').lte(options.maxSize);
  }
  
  return query
    .sort({ messageTimestamp: options.sort || -1 })
    .limit(options.limit || 100)
    .skip(options.skip || 0);
};

mediaSchema.statics.getStorageStatistics = async function(groupId = null) {
  const match = {};
  if (groupId) match.groupId = groupId;
  
  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$mediaType',
        count: { $sum: 1 },
        totalSize: { $sum: '$fileSize' },
        avgSize: { $avg: '$fileSize' },
        minSize: { $min: '$fileSize' },
        maxSize: { $max: '$fileSize' }
      }
    },
    {
      $project: {
        mediaType: '$_id',
        count: 1,
        totalSize: 1,
        totalSizeMB: { $round: [{ $divide: ['$totalSize', 1048576] }, 2] },
        avgSizeMB: { $round: [{ $divide: ['$avgSize', 1048576] }, 2] },
        minSizeMB: { $round: [{ $divide: ['$minSize', 1048576] }, 2] },
        maxSizeMB: { $round: [{ $divide: ['$maxSize', 1048576] }, 2] },
        _id: 0
      }
    },
    { $sort: { totalSize: -1 } }
  ]);
  
  const totalStats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalFiles: { $sum: 1 },
        totalSize: { $sum: '$fileSize' },
        uniqueAuthors: { $addToSet: '$author' }
      }
    },
    {
      $project: {
        totalFiles: 1,
        totalSize: 1,
        totalSizeMB: { $round: [{ $divide: ['$totalSize', 1048576] }, 2] },
        totalSizeGB: { $round: [{ $divide: ['$totalSize', 1073741824] }, 2] },
        uniqueAuthors: { $size: '$uniqueAuthors' },
        _id: 0
      }
    }
  ]);
  
  return {
    byType: stats,
    total: totalStats[0] || { totalFiles: 0, totalSize: 0, totalSizeMB: 0, totalSizeGB: 0, uniqueAuthors: 0 }
  };
};

mediaSchema.statics.findDuplicates = async function() {
  const duplicates = await this.aggregate([
    {
      $group: {
        _id: '$fileHash',
        count: { $sum: 1 },
        files: { $push: { id: '$id', filename: '$filename', path: '$path' } }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } }
  ]);
  
  return duplicates;
};

mediaSchema.statics.cleanupExpiredMedia = async function() {
  const expired = await this.find({
    expiresAt: { $lt: new Date() }
  });
  
  const results = [];
  for (const media of expired) {
    try {
      // Delete physical file
      const fs = require('fs-extra');
      await fs.remove(media.fullPath);
      if (media.thumbnailPath) {
        await fs.remove(media.thumbnailPath);
      }
      
      // Delete database record
      await media.deleteOne();
      
      results.push({ success: true, file: media.filename });
    } catch (error) {
      results.push({ success: false, file: media.filename, error: error.message });
    }
  }
  
  return results;
};

const Media = mongoose.model('Media', mediaSchema);

module.exports = Media;