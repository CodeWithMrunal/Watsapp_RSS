const express = require('express');
const moment = require('moment');
const FileUtils = require('../utils/fileUtils');
const { authenticate } = require('../middleware/auth');
const { UserGroup, UserMessage } = require('../models');

const router = express.Router();

function createApiRoutes(whatsappManagerPool) {
  // All routes now require authentication
  router.use(authenticate);

  // Get WhatsApp manager for authenticated user (async)
  const getManager = async (req) => {
    return await whatsappManagerPool.getManager(req.userId);
  };

  router.get('/status', async (req, res) => {
    try {
      const manager = await getManager(req);
      res.json(manager.getStatus());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/groups', async (req, res) => {
    console.log(`GET /api/groups for user ${req.userId}`);
    
    try {
      const manager = await getManager(req);
      
      if (!manager.isClientReady()) {
        return res.status(503).json({ 
          error: 'WhatsApp client is still initializing. Please wait a moment and try again.',
          status: manager.getStatus()
        });
      }
      
      const groups = await manager.getGroups();
      
      // Save groups to database for this user
      for (const group of groups) {
        await UserGroup.findOrCreate({
          where: {
            user_id: req.userId,
            group_id: group.id
          },
          defaults: {
            group_name: group.name,
            participant_count: group.participantCount
          }
        });
      }
      
      res.json(groups);
    } catch (error) {
      console.error('Error fetching groups:', error);
      const manager = await getManager(req);
      res.status(500).json({ 
        error: error.message,
        status: manager.getStatus()
      });
    }
  });

  router.post('/select-group', async (req, res) => {
    console.log(`POST /api/select-group for user ${req.userId}`, req.body);
    const { groupId } = req.body;
    
    try {
      const manager = await getManager(req);
      const selectedGroup = await manager.selectGroup(groupId);
      
      // Update database
      await UserGroup.update(
        { selected_at: new Date() },
        { 
          where: { 
            user_id: req.userId, 
            group_id: groupId 
          } 
        }
      );
      
      res.json({ success: true, group: selectedGroup });
    } catch (error) {
      console.error('Error selecting group:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/group-participants', async (req, res) => {
    console.log(`GET /api/group-participants for user ${req.userId}`);
    
    try {
      const manager = await getManager(req);
      const participants = manager.getGroupParticipants();
      res.json(participants);
    } catch (error) {
      console.error('Error fetching participants:', error);
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/select-user', async (req, res) => {
    console.log(`POST /api/select-user for user ${req.userId}`, req.body);
    const { userId } = req.body;
    
    try {
      const manager = await getManager(req);
      const selectedUser = manager.selectUser(userId);
      
      // Update monitoring user in database
      if (manager.selectedGroup) {
        await UserGroup.update(
          { monitoring_user: userId === 'all' ? null : userId },
          { 
            where: { 
              user_id: req.userId, 
              group_id: manager.selectedGroup.id 
            } 
          }
        );
      }
      
      res.json({ success: true, selectedUser });
    } catch (error) {
      console.error('Error selecting user:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/fetch-history', async (req, res) => {
    console.log(`POST /api/fetch-history for user ${req.userId}`, req.body);
    const { limit = 50 } = req.body;
    
    try {
      const manager = await getManager(req);
      const messages = await manager.fetchHistory(limit);
      
      // Save messages to database
      if (manager.selectedGroup) {
        for (const messageGroup of messages) {
          for (const msg of messageGroup.messages) {
            await UserMessage.findOrCreate({
              where: {
                user_id: req.userId,
                message_id: msg.id
              },
              defaults: {
                group_id: manager.selectedGroup.id,
                author: msg.author,
                message_type: msg.type,
                body: msg.body,
                has_media: msg.hasMedia,
                media_path: msg.mediaPath,
                timestamp: msg.timestamp
              }
            });
          }
        }
      }
      
      res.json({ messages });
    } catch (error) {
      console.error('Error fetching history:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/messages', async (req, res) => {
    const { grouped = true } = req.query;
    
    try {
      const manager = await getManager(req);
      const messages = manager.getMessages(grouped === 'true');
      res.json(messages);
    } catch (error) {
      console.error('Error getting messages:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/initialize', async (req, res) => {
    try {
      const manager = await getManager(req);
      await manager.initialize();
      res.json({ success: true });
    } catch (error) {
      console.error('Error initializing WhatsApp manager:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/logout', async (req, res) => {
    console.log(`POST /api/logout for user ${req.userId}`);
    
    try {
      const manager = await getManager(req);
      await manager.logout();
      
      // Remove manager from pool
      await whatsappManagerPool.removeManager(req.userId);
      
      res.json({ success: true, message: 'Successfully logged out' });
    } catch (error) {
      console.error('Error during logout:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/backup-messages', async (req, res) => {
    try {
      const manager = await getManager(req);
      const messageHistory = manager.messageHistory;
      
      if (!messageHistory || messageHistory.length === 0) {
        return res.status(400).json({ error: 'No messages to backup' });
      }

      const timestamp = moment().format('YYYY-MM-DD_HH-mm-ss');
      const userDir = `./backups/user_${req.userId}`;
      const filename = `${userDir}/messages-${timestamp}.json`;

      // Ensure user backup directory exists
      const fs = require('fs-extra');
      fs.ensureDirSync(userDir);
      
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

  // Get user's storage usage
  router.get('/storage-usage', async (req, res) => {
    try {
      const user = await req.user.reload();
      const storageInfo = {
        used_mb: user.storage_used_mb,
        quota_mb: user.storage_quota_mb,
        percentage: (user.storage_used_mb / user.storage_quota_mb) * 100,
        remaining_mb: user.storage_quota_mb - user.storage_used_mb
      };
      res.json(storageInfo);
    } catch (error) {
      console.error('Error getting storage usage:', error);
      res.status(500).json({ error: 'Failed to get storage usage' });
    }
  });

  return router;
}

module.exports = createApiRoutes;