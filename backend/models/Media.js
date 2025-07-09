module.exports = (sequelize, DataTypes) => {
  const Media = sequelize.define('Media', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    message_id: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      references: {
        model: 'messages',
        key: 'id'
      }
    },
    file_path: {
      type: DataTypes.STRING,
      allowNull: false
    },
    filename: {
      type: DataTypes.STRING,
      allowNull: false
    },
    original_filename: {
      type: DataTypes.STRING,
      allowNull: true
    },
    file_size: {
      type: DataTypes.BIGINT,
      defaultValue: 0
    },
    file_hash: {
      type: DataTypes.STRING,
      allowNull: true
    },
    mimetype: {
      type: DataTypes.STRING,
      allowNull: true
    },
    media_type: {
      type: DataTypes.STRING,
      allowNull: false
    },
    width: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    height: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    duration: {
      type: DataTypes.FLOAT,
      allowNull: true
    },
    thumbnail_path: {
      type: DataTypes.STRING,
      allowNull: true
    },
    is_voice_note: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    saved_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'media',
    indexes: [
      {
        fields: ['message_id']
      },
      {
        fields: ['file_hash']
      },
      {
        fields: ['media_type']
      },
      {
        fields: ['saved_at']
      }
    ]
  });

  Media.associate = function(models) {
    Media.belongsTo(models.Message, { foreignKey: 'message_id' });
  };

  return Media;
};