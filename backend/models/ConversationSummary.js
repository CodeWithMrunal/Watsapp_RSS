module.exports = (sequelize, DataTypes) => {
  const ConversationSummary = sequelize.define('ConversationSummary', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    conversation_id: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    group_id: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'groups',
        key: 'id'
      }
    },
    start_time: {
      type: DataTypes.DATE,
      allowNull: false
    },
    end_time: {
      type: DataTypes.DATE,
      allowNull: false
    },
    duration: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    message_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    participant_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    dominant_language: {
      type: DataTypes.STRING,
      allowNull: true
    },
    is_media_heavy: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    average_messages_per_day: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    peak_hours: {
      type: DataTypes.ARRAY(DataTypes.INTEGER),
      defaultValue: []
    },
    statistics: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'conversation_summaries',
    indexes: [
      {
        fields: ['group_id']
      },
      {
        fields: ['start_time']
      },
      {
        fields: ['end_time']
      }
    ]
  });

  ConversationSummary.associate = function(models) {
    ConversationSummary.belongsTo(models.Group, { foreignKey: 'group_id' });
  };

  return ConversationSummary;
};