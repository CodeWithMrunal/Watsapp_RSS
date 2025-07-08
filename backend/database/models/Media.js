module.exports = (sequelize, DataTypes) => {
  const Media = sequelize.define('Media', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    file_hash: {
      type: DataTypes.STRING(32),
      unique: true,
      allowNull: false,
      comment: 'File hash for deduplication'
    },
    filename: {
      type: DataTypes.STRING,
      allowNull: false
    },
    original_filename: {
      type: DataTypes.STRING,
      allowNull: true
    },
    filepath: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Relative path to media file'
    },
    filesize: {
      type: DataTypes.BIGINT,
      allowNull: false,
      comment: 'File size in bytes'
    },
    filesize_human: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Human readable file size'
    },
    mimetype: {
      type: DataTypes.STRING,
      allowNull: false
    },
    media_type: {
      type: DataTypes.ENUM('image', 'video', 'audio', 'document', 'pdf', 'text', 'archive', 'other'),
      allowNull: false
    },
    extension: {
      type: DataTypes.STRING,
      allowNull: false
    },
    
    // Media specific attributes
    width: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Width for images/videos'
    },
    height: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Height for images/videos'
    },
    aspect_ratio: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Aspect ratio for images/videos'
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Duration in seconds for audio/video'
    },
    thumbnail_path: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Path to thumbnail if generated'
    },
    
    // WhatsApp specific
    whatsapp_media_key: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'WhatsApp media key'
    },
    caption: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Media caption'
    },
    
    // Processing metadata
    compression_ratio: {
      type: DataTypes.FLOAT,
      allowNull: true
    },
    is_processed: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    processing_error: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Error message if processing failed'
    },
    
    // Timestamps
    file_created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'File system creation time'
    },
    file_modified_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'File system modification time'
    },
    uploaded_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    processing_version: {
      type: DataTypes.STRING,
      defaultValue: '1.0'
    },
    
    // Additional metadata
    exif_data: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'EXIF data for images'
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Additional media metadata'
    }
  }, {
    tableName: 'media',
    indexes: [
      {
        fields: ['file_hash']
      },
      {
        fields: ['media_type']
      },
      {
        fields: ['filesize']
      },
      {
        fields: ['uploaded_at']
      }
    ]
  });

  Media.associate = function(models) {
    Media.hasMany(models.Message, {
      foreignKey: 'media_id',
      as: 'messages'
    });
  };

  return Media;
};