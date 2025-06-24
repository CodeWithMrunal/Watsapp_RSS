const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserMessage = sequelize.define('UserMessage', {
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
  message_id: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'WhatsApp message ID'
  },
  group_id: {
    type: DataTypes.STRING,
    allowNull: false
  },
  author: {
    type: DataTypes.STRING,
    allowNull: false
  },
  message_type: {
    type: DataTypes.ENUM('chat', 'image', 'video', 'audio', 'document', 'sticker'),
    defaultValue: 'chat'
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  has_media: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  media_path: {
    type: DataTypes.STRING,
    allowNull: true
  },
  media_size: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Media file size in bytes'
  },
  timestamp: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'WhatsApp message timestamp'
  },
  processed_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  indexes: [
    {
      fields: ['user_id', 'message_id'],
      unique: true
    },
    {
      fields: ['user_id', 'group_id']
    },
    {
      fields: ['user_id', 'author']
    },
    {
      fields: ['timestamp']
    }
  ]
});

module.exports = UserMessage;