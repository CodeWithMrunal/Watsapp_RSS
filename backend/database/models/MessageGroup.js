module.exports = (sequelize, DataTypes) => {
  const MessageGroup = sequelize.define('MessageGroup', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    group_hash: {
      type: DataTypes.STRING(32),
      unique: true,
      allowNull: false,
      comment: 'Unique hash for the message group'
    },
    whatsapp_group_id: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'WhatsApp group ID'
    },
    author_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'authors',
        key: 'id'
      }
    },
    start_timestamp: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Unix timestamp of first message'
    },
    end_timestamp: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Unix timestamp of last message'
    },
    duration_seconds: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Duration in seconds'
    },
    message_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    media_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    text_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    total_characters: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    total_words: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    total_size_bytes: {
      type: DataTypes.BIGINT,
      defaultValue: 0
    },
    messages_per_minute: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    dominant_sentiment: {
      type: DataTypes.ENUM('positive', 'negative', 'neutral'),
      defaultValue: 'neutral'
    },
    languages: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Array of detected languages'
    },
    media_types: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Count of each media type'
    },
    url_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    emoji_count: {
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
    sentiment_scores: {
      type: DataTypes.JSON,
      defaultValue: { positive: 0, negative: 0, neutral: 0 }
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Additional group metadata'
    }
  }, {
    tableName: 'message_groups',
    indexes: [
      {
        fields: ['group_hash']
      },
      {
        fields: ['author_id']
      },
      {
        fields: ['whatsapp_group_id']
      },
      {
        fields: ['start_timestamp']
      },
      {
        fields: ['end_timestamp']
      },
      {
        fields: ['message_count']
      }
    ]
  });

  MessageGroup.associate = function(models) {
    MessageGroup.belongsTo(models.Author, {
      foreignKey: 'author_id',
      as: 'author'
    });
    
    MessageGroup.hasMany(models.Message, {
      foreignKey: 'message_group_id',
      as: 'messages'
    });
    
    MessageGroup.hasOne(models.GroupStatistic, {
      foreignKey: 'message_group_id',
      as: 'statistics'
    });
  };

  return MessageGroup;
};