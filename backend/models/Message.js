module.exports = (sequelize, DataTypes) => {
  const Message = sequelize.define('Message', {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false
    },
    message_id: {
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
    author_id: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'authors',
        key: 'id'
      }
    },
    timestamp: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    message_date: {
      type: DataTypes.DATE,
      allowNull: false
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    original_body: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    caption: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    has_media: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    is_forwarded: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    is_starred: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    is_ephemeral: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    is_status: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    is_broadcast: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    from_jid: {
      type: DataTypes.STRING,
      allowNull: true
    },
    to_jid: {
      type: DataTypes.STRING,
      allowNull: true
    },
    word_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    char_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    detected_language: {
      type: DataTypes.STRING,
      allowNull: true
    },
    device_type: {
      type: DataTypes.STRING,
      allowNull: true
    },
    quoted_message_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    quoted_message_data: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    raw_data: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'messages',
    indexes: [
      {
        fields: ['group_id']
      },
      {
        fields: ['author_id']
      },
      {
        fields: ['timestamp']
      },
      {
        fields: ['message_date']
      },
      {
        fields: ['type']
      },
      {
        fields: ['has_media']
      },
      {
        fields: ['is_forwarded']
      },
      {
        fields: ['detected_language']
      },
      {
        fields: ['quoted_message_id']
      }
    ]
  });

  Message.associate = function(models) {
    Message.belongsTo(models.Group, { foreignKey: 'group_id' });
    Message.belongsTo(models.Author, { foreignKey: 'author_id' });
    Message.hasOne(models.Media, { foreignKey: 'message_id' });
    Message.hasMany(models.Link, { foreignKey: 'message_id' });
    Message.hasMany(models.Mention, { foreignKey: 'message_id' });
    Message.hasMany(models.Reaction, { foreignKey: 'message_id' });
  };

  return Message;
};