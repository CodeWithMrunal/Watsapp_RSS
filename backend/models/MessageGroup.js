module.exports = (sequelize, DataTypes) => {
  const MessageGroup = sequelize.define('MessageGroup', {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false
    },
    group_id: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'groups',
        key: 'id'
      }
    },
    author_id: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'authors',
        key: 'id'
      }
    },
    start_timestamp: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    end_timestamp: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    start_date: {
      type: DataTypes.DATE,
      allowNull: false
    },
    end_date: {
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
    media_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    text_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    link_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    mention_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    total_media_size: {
      type: DataTypes.BIGINT,
      defaultValue: 0
    },
    average_message_length: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    statistics: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'message_groups',
    indexes: [
      {
        fields: ['group_id']
      },
      {
        fields: ['author_id']
      },
      {
        fields: ['start_timestamp']
      },
      {
        fields: ['end_timestamp']
      }
    ]
  });

  MessageGroup.associate = function(models) {
    MessageGroup.belongsTo(models.Group, { foreignKey: 'group_id' });
    MessageGroup.belongsTo(models.Author, { foreignKey: 'author_id' });
  };

  return MessageGroup;
};