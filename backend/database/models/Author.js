module.exports = (sequelize, DataTypes) => {
  const Author = sequelize.define('Author', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    whatsapp_id: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: 'WhatsApp user ID'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Display name or phone number'
    },
    is_admin: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    first_seen: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    last_seen: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    message_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    media_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Additional author metadata'
    }
  }, {
    tableName: 'authors',
    indexes: [
      {
        fields: ['whatsapp_id']
      },
      {
        fields: ['last_seen']
      }
    ]
  });

  Author.associate = function(models) {
    Author.hasMany(models.Message, {
      foreignKey: 'author_id',
      as: 'messages'
    });
    
    Author.hasMany(models.MessageGroup, {
      foreignKey: 'author_id',
      as: 'messageGroups'
    });
  };

  return Author;
};