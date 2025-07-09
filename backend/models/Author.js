module.exports = (sequelize, DataTypes) => {
  const Author = sequelize.define('Author', {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false
    },
    phone_number: {
      type: DataTypes.STRING,
      allowNull: true
    },
    push_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    is_business_account: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    profile_pic_url: {
      type: DataTypes.TEXT,
      allowNull: true
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
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'authors',
    indexes: [
      {
        fields: ['phone_number']
      },
      {
        fields: ['push_name']
      },
      {
        fields: ['last_seen']
      }
    ]
  });

  Author.associate = function(models) {
    Author.hasMany(models.Message, { foreignKey: 'author_id' });
    Author.hasMany(models.MessageGroup, { foreignKey: 'author_id' });
  };

  return Author;
};