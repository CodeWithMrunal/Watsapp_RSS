module.exports = (sequelize, DataTypes) => {
  const Mention = sequelize.define('Mention', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    message_id: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'messages',
        key: 'id'
      }
    },
    mentioned_user_id: {
      type: DataTypes.STRING,
      allowNull: false
    },
    position: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    }
  }, {
    tableName: 'mentions',
    indexes: [
      {
        fields: ['message_id']
      },
      {
        fields: ['mentioned_user_id']
      }
    ]
  });

  Mention.associate = function(models) {
    Mention.belongsTo(models.Message, { foreignKey: 'message_id' });
  };

  return Mention;
};