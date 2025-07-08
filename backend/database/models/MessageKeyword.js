module.exports = (sequelize, DataTypes) => {
  const MessageKeyword = sequelize.define('MessageKeyword', {
    message_id: {
      type: DataTypes.INTEGER,
      references: {
        model: 'messages',
        key: 'id'
      }
    },
    keyword_id: {
      type: DataTypes.INTEGER,
      references: {
        model: 'keywords',
        key: 'id'
      }
    },
    frequency_in_message: {
      type: DataTypes.INTEGER,
      defaultValue: 1
    }
  }, {
    tableName: 'message_keywords',
    timestamps: false
  });

  return MessageKeyword;
};