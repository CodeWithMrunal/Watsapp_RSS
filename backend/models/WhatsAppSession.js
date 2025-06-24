const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const WhatsAppSession = sequelize.define('WhatsAppSession', {
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
  session_data: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Encrypted WhatsApp session data'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  phone_number: {
    type: DataTypes.STRING,
    allowNull: true
  },
  connected_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  disconnected_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  last_activity: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
});

module.exports = WhatsAppSession;