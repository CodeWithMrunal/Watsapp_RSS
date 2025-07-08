module.exports = (sequelize, DataTypes) => {
  const MessageUrl = sequelize.define('MessageUrl', {
    message_id: {
      type: DataTypes.INTEGER,
      references: {
        model: 'messages',
        key: 'id'
      }
    },
    url_id: {
      type: DataTypes.INTEGER,
      references: {
        model: 'urls',
        key: 'id'
      }
    }
  }, {
    tableName: 'message_urls',
    timestamps: false
  });

  return MessageUrl;
};