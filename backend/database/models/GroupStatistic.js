module.exports = (sequelize, DataTypes) => {
  const GroupStatistic = sequelize.define('GroupStatistic', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    message_group_id: {
      type: DataTypes.INTEGER,
      unique: true,
      references: {
        model: 'message_groups',
        key: 'id'
      }
    },
    hourly_distribution: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Message count by hour'
    },
    daily_distribution: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Message count by day'
    },
    top_keywords: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Top keywords with frequencies'
    },
    top_urls: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Most shared URLs'
    },
    emoji_distribution: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Emoji usage statistics'
    },
    language_distribution: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Language usage percentages'
    },
    media_size_distribution: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Media sizes by type'
    },
    response_times: {
      type: DataTypes.JSON,
      defaultValue: [],
      comment: 'Average response times between messages'
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Additional statistics'
    }
  }, {
    tableName: 'group_statistics'
  });

  GroupStatistic.associate = function(models) {
    GroupStatistic.belongsTo(models.MessageGroup, {
      foreignKey: 'message_group_id',
      as: 'messageGroup'
    });
  };

  return GroupStatistic;
};