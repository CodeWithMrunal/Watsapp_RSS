const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserGroup = sequelize.define('UserGroup', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  group_id: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'WhatsApp group ID'
  },
  group_name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  participant_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  selected_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  monitoring_user: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Specific user being monitored in this group'
  },
  message_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  media_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  last_message_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'group_id']
    }
  ]
});

module.exports = UserGroup;