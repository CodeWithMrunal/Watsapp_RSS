// backend/routes/multiGroupRoutes.js
const express = require('express');
const router = express.Router();

module.exports = (whatsappManager) => {
  // Get all monitored groups
  router.get('/monitored-groups', (req, res) => {
    try {
      const groups = whatsappManager.getMonitoredGroups();
      res.json({
        success: true,
        groups,
        count: groups.length
      });
    } catch (error) {
      console.error('Error fetching monitored groups:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch monitored groups'
      });
    }
  });

  // Add a group to monitoring
  router.post('/add-group', async (req, res) => {
    try {
      const { groupId } = req.body;
      
      if (!groupId) {
        return res.status(400).json({
          success: false,
          error: 'Group ID is required'
        });
      }

      const group = await whatsappManager.addGroupToMonitor(groupId);
      
      res.json({
        success: true,
        group,
        message: `Successfully added ${group.name} to monitoring`
      });
    } catch (error) {
      console.error('Error adding group to monitor:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to add group'
      });
    }
  });

  // Remove a group from monitoring
  router.post('/remove-group', (req, res) => {
    try {
      const { groupId } = req.body;
      
      if (!groupId) {
        return res.status(400).json({
          success: false,
          error: 'Group ID is required'
        });
      }

      const removed = whatsappManager.removeGroupFromMonitor(groupId);
      
      res.json({
        success: removed,
        message: removed ? 'Group removed from monitoring' : 'Group was not being monitored'
      });
    } catch (error) {
      console.error('Error removing group from monitor:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to remove group'
      });
    }
  });

  // Fetch history for a specific monitored group
  router.post('/fetch-group-history', async (req, res) => {
    try {
      const { groupId, limit = 50 } = req.body;
      
      if (!groupId) {
        return res.status(400).json({
          success: false,
          error: 'Group ID is required'
        });
      }

      if (!whatsappManager.isGroupMonitored(groupId)) {
        return res.status(400).json({
          success: false,
          error: 'Group is not being monitored'
        });
      }

      const result = await whatsappManager.fetchHistoryForGroup(groupId, limit);
      
      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('Error fetching group history:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch history'
      });
    }
  });

  // Get messages for a specific group
  router.get('/group-messages/:groupId', (req, res) => {
    try {
      const { groupId } = req.params;
      const { grouped = 'true' } = req.query;
      
      if (!whatsappManager.isGroupMonitored(groupId)) {
        return res.status(400).json({
          success: false,
          error: 'Group is not being monitored'
        });
      }

      const messages = whatsappManager.getMessagesForGroup(groupId, grouped === 'true');
      const groupData = whatsappManager.getMonitoredGroups().find(g => g.id === groupId);
      
      res.json({
        success: true,
        groupId,
        groupName: groupData?.name,
        messages,
        count: messages.length
      });
    } catch (error) {
      console.error('Error fetching group messages:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch messages'
      });
    }
  });

  // Get statistics for all monitored groups
  router.get('/multi-group-statistics', (req, res) => {
    try {
      const statistics = whatsappManager.getMultiGroupStatistics();
      
      res.json({
        success: true,
        statistics,
        groupCount: Object.keys(statistics).length
      });
    } catch (error) {
      console.error('Error fetching multi-group statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch statistics'
      });
    }
  });

  // Batch add multiple groups
  router.post('/add-groups-batch', async (req, res) => {
    try {
      const { groupIds } = req.body;
      
      if (!Array.isArray(groupIds) || groupIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Group IDs array is required'
        });
      }

      const results = {
        successful: [],
        failed: []
      };

      for (const groupId of groupIds) {
        try {
          const group = await whatsappManager.addGroupToMonitor(groupId);
          results.successful.push({
            groupId,
            name: group.name
          });
        } catch (error) {
          results.failed.push({
            groupId,
            error: error.message
          });
        }
      }

      res.json({
        success: true,
        results,
        message: `Added ${results.successful.length} groups, ${results.failed.length} failed`
      });
    } catch (error) {
      console.error('Error in batch add groups:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add groups'
      });
    }
  });

  // Check if a group is monitored
  router.get('/is-monitored/:groupId', (req, res) => {
    try {
      const { groupId } = req.params;
      const isMonitored = whatsappManager.isGroupMonitored(groupId);
      
      res.json({
        success: true,
        groupId,
        isMonitored
      });
    } catch (error) {
      console.error('Error checking if group is monitored:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check group status'
      });
    }
  });

  // Generate RSS feed for a specific group
  router.post('/generate-group-rss', async (req, res) => {
    try {
      const { groupId } = req.body;
      
      if (!groupId) {
        return res.status(400).json({
          success: false,
          error: 'Group ID is required'
        });
      }

      if (!whatsappManager.isGroupMonitored(groupId)) {
        return res.status(400).json({
          success: false,
          error: 'Group is not being monitored'
        });
      }

      // This would need to be implemented in RSSManager
      // For now, we'll just return a success message
      res.json({
        success: true,
        message: 'RSS feed generation triggered',
        groupId,
        rssUrl: `/rss/group/${groupId}/feed.xml`
      });
    } catch (error) {
      console.error('Error generating group RSS:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate RSS feed'
      });
    }
  });

  return router;
};