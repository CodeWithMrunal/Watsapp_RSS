module.exports = (sequelize, DataTypes) => {
  const Url = sequelize.define('Url', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    url: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: true
    },
    domain: {
      type: DataTypes.STRING,
      allowNull: false
    },
    url_type: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Type of URL (google-drive, youtube, etc.)'
    },
    first_seen: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    last_seen: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    occurrence_count: {
      type: DataTypes.INTEGER,
      defaultValue: 1
    }
  }, {
    tableName: 'urls',
    indexes: [
      {
        fields: ['domain']
      },
      {
        fields: ['url_type']
      }
    ]
  });

  Url.associate = function(models) {
    Url.belongsToMany(models.Message, {
      through: models.MessageUrl,
      foreignKey: 'url_id',
      otherKey: 'message_id',
      as: 'messages'
    });
  };

  return Url;
};