const express = require('express');
const moment = require('moment');
const FileUtils = require('../utils/fileUtils');

const router = express.Router();

function createApiRoutes(whatsappManager) {
  router.get('/status', (req, res) => {
    res.json(whatsappManager.getStatus());
  });

  router.get('/groups', async (req, res) => {
    console.log('GET /api/groups');

    try {
      const groups = await whatsappManager.getGroups();
      res.json(groups);
    } catch (error) {
      console.error('Error fetching groups:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/select-group', async (req, res) => {
    console.log('POST /api/select-group', req.body);
    const { groupId } = req.body;
    
    try {
      const selectedGroup = await whatsappManager.selectGroup(groupId);
      res.json({ success: true, group: selectedGroup });
    } catch (error) {
      console.error('Error selecting group:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/group-participants', async (req, res) => {
    console.log('GET /api/group-participants');
    
    try {
      const participants = whatsappManager.getGroupParticipants();
      res.json(participants);
    } catch (error) {
      console.error('Error fetching participants:', error);
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/select-user', (req, res) => {
    console.log('POST /api/select-user', req.body);
    const { userId } = req.body;
    
    try {
      const selectedUser = whatsappManager.selectUser(userId);
      res.json({ success: true, selectedUser });
    } catch (error) {
      console.error('Error selecting user:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/fetch-history', async (req, res) => {
    console.log('POST /api/fetch-history', req.body);
    const { limit = 50 } = req.body;
    
    try {
      const messages = await whatsappManager.fetchHistory(limit);
      res.json({ messages });
    } catch (error) {
      console.error('Error fetching history:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/messages', (req, res) => {
    const { grouped = true } = req.query;
    
    try {
      const messages = whatsappManager.getMessages(grouped === 'true');
      res.json(messages);
    } catch (error) {
      console.error('Error getting messages:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/initialize', (req, res) => {
    try {
      whatsappManager.initialize();
      res.json({ success: true });
    } catch (error) {
      console.error('Error initializing WhatsApp manager:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // NEW: Logout endpoint
  router.post('/logout', async (req, res) => {
    console.log('POST /api/logout - Logging out WhatsApp session');
    
    try {
      await whatsappManager.logout();
      res.json({ success: true, message: 'Successfully logged out' });
    } catch (error) {
      console.error('Error during logout:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/backup-messages', (req, res) => {
    const messageHistory = whatsappManager.messageHistory;
    
    if (!messageHistory || messageHistory.length === 0) {
      return res.status(400).json({ error: 'No messages to backup' });
    }

    const timestamp = moment().format('YYYY-MM-DD_HH-mm-ss');
    const filename = `./backups/messages-${timestamp}.json`;

    try {
      const success = FileUtils.saveJSON(filename, messageHistory);
      if (success) {
        res.json({ success: true, message: `Messages backed up to ${filename}` });
      } else {
        res.status(500).json({ error: 'Failed to write backup file' });
      }
    } catch (err) {
      console.error('❌ Failed to write backup:', err);
      res.status(500).json({ error: 'Failed to write backup file' });
    }
  });

  return router;
}

module.exports = createApiRoutes;