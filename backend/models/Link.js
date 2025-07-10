const { defaultValueSchemable } = require("sequelize/lib/utils");

module.exports = (sequelize, DataTypes) => {
  const Link = sequelize.define('Link', {
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
    url: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    domain: {
      type: DataTypes.STRING,
      allowNull: true
    },
    link_type: {
      type: DataTypes.STRING,
      allowNull: true
    },
    position: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    processed:{
        type:DataTypes.INTEGER,
        defaultValue: 0
    }
  }, {
    tableName: 'links',
    indexes: [
      {
        fields: ['message_id']
      },
      {
        fields: ['domain']
      },
      {
        fields: ['link_type']
      }
    ]
  });

  Link.associate = function(models) {
    Link.belongsTo(models.Message, { foreignKey: 'message_id' });
  };

  return Link;
};