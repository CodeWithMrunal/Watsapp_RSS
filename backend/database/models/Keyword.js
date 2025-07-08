module.exports = (sequelize, DataTypes) => {
  const Keyword = sequelize.define('Keyword', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    word: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    frequency: {
      type: DataTypes.INTEGER,
      defaultValue: 1
    },
    first_seen: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    last_seen: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'keywords',
    indexes: [
      {
        fields: ['word']
      },
      {
        fields: ['frequency']
      }
    ]
  });

  Keyword.associate = function(models) {
    Keyword.belongsToMany(models.Message, {
      through: models.MessageKeyword,
      foreignKey: 'keyword_id',
      otherKey: 'message_id',
      as: 'messages'
    });
  };

  return Keyword;
};