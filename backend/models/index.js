const sequelize = require('../config/database');
const User = require('./User');
const WhatsAppSession = require('./WhatsAppSession');
const UserGroup = require('./UserGroup');
const UserMessage = require('./UserMessage');

// Define associations
User.hasOne(WhatsAppSession, {
  foreignKey: 'user_id',
  as: 'whatsappSession'
});

User.hasMany(UserGroup, {
  foreignKey: 'user_id',
  as: 'groups'
});

User.hasMany(UserMessage, {
  foreignKey: 'user_id',
  as: 'messages'
});

WhatsAppSession.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

UserGroup.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

UserMessage.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

// Sync database
const syncDatabase = async (force = false) => {
  try {
    await sequelize.sync({ force });
    console.log('✅ Database synchronized successfully');
  } catch (error) {
    console.error('❌ Error synchronizing database:', error);
  }
};

module.exports = {
  sequelize,
  User,
  WhatsAppSession,
  UserGroup,
  UserMessage,
  syncDatabase
};