module.exports = (sequelize, DataTypes) => {
  const Reaction = sequelize.define('Reaction', {
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
    emoji: {
      type: DataTypes.STRING,
      allowNull: false
    },
    sender_id: {
      type: DataTypes.STRING,
      allowNull: false
    },
    reaction_count: {
      type: DataTypes.INTEGER,
      defaultValue: 1
    }
  }, {
    tableName: 'reactions',
    indexes: [
      {
        fields: ['message_id']
      },
      {
        fields: ['sender_id']
      }
    ]
  });

  Reaction.associate = function(models) {
    Reaction.belongsTo(models.Message, { foreignKey: 'message_id' });
  };

  return Reaction;
};
