module.exports = (sequelize, DataTypes) => {
  const Group = sequelize.define('Group', {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    participant_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    is_archived: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    is_muted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    last_activity: {
      type: DataTypes.DATE,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    tableName: 'groups',
    indexes: [
      {
        fields: ['name']
      },
      {
        fields: ['last_activity']
      }
    ]
  });

  Group.associate = function(models) {
    Group.hasMany(models.Message, { foreignKey: 'group_id' });
    Group.hasMany(models.MessageGroup, { foreignKey: 'group_id' });
  };

  return Group;
};