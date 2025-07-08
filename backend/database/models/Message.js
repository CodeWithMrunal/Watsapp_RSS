module.exports = (sequelize, DataTypes) => {
  const Message = sequelize.define('Message', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    whatsapp_id: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
      comment: 'WhatsApp message ID'
    },
    message_hash: {
      type: DataTypes.STRING(32),
      unique: true,
      allowNull: false,
      comment: 'Unique hash for deduplication'
    },
    author_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'authors',
        key: 'id'
      }
    },
    message_group_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'message_groups',
        key: 'id'
      }
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Cleaned message text'
    },
    original_body: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Original message text'
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Message type (chat, image, video, etc.)'
    },
    has_media: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    media_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'media',
        key: 'id'
      }
    },
    timestamp: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Unix timestamp'
    },
    datetime: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Converted datetime'
    },
    day_of_week: {
      type: DataTypes.STRING,
      allowNull: true
    },
    time_of_day: {
      type: DataTypes.ENUM('morning', 'afternoon', 'evening', 'night'),
      allowNull: true
    },
    
    // Message characteristics
    message_length: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    word_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    line_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    has_emojis: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    emoji_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    emojis: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Array of unique emojis used'
    },
    
    // Content analysis
    sentiment: {
      type: DataTypes.ENUM('positive', 'negative', 'neutral'),
      defaultValue: 'neutral'
    },
    language: {
      type: DataTypes.STRING,
      defaultValue: 'unknown'
    },
    is_forwarded: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    is_reply: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    reply_to_id: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'WhatsApp ID of replied message'
    },
    
    // Counts
    url_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    mention_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    hashtag_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    // Platform specific
    from_jid: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'From JID'
    },
    to_jid: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'To JID'
    },
    is_status: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    is_starred: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    is_gif: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    // Additional metadata
    device_type: {
      type: DataTypes.STRING,
      allowNull: true
    },
    location: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Location data if shared'
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Duration for audio/video in seconds'
    },
    
    // Processing metadata
    processed_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    processing_version: {
      type: DataTypes.STRING,
      defaultValue: '1.0'
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Additional message metadata'
    }
  }, {
    tableName: 'messages',
    indexes: [
      {
        fields: ['whatsapp_id']
      },
      {
        fields: ['message_hash']
      },
      {
        fields: ['author_id']
      },
      {
        fields: ['message_group_id']
      },
      {
        fields: ['timestamp']
      },
      {
        fields: ['type']
      },
      {
        fields: ['has_media']
      },
      {
        fields: ['sentiment']
      },
      {
        fields: ['language']
      }
    ]
  });

  Message.associate = function(models) {
    Message.belongsTo(models.Author, {
      foreignKey: 'author_id',
      as: 'author'
    });
    
    Message.belongsTo(models.MessageGroup, {
      foreignKey: 'message_group_id',
      as: 'messageGroup'
    });
    
    Message.belongsTo(models.Media, {
      foreignKey: 'media_id',
      as: 'media'
    });
    
    Message.belongsToMany(models.Url, {
      through: models.MessageUrl,
      foreignKey: 'message_id',
      otherKey: 'url_id',
      as: 'urls'
    });
    
    Message.belongsToMany(models.Keyword, {
      through: models.MessageKeyword,
      foreignKey: 'message_id',
      otherKey: 'keyword_id',
      as: 'keywords'
    });
  };

  return Message;
};