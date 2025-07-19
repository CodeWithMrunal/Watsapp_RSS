// backend/routes/rssViewRoutes.js
const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const xml2js = require('xml2js');

module.exports = (whatsappManager, rssManager) => {
  // Helper function to parse RSS XML
  const parseRSSFeed = async (feedPath) => {
    try {
      const xmlContent = await fs.readFile(feedPath, 'utf8');
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlContent);
      return result;
    } catch (error) {
      console.error('Error parsing RSS feed:', error);
      return null;
    }
  };

  // Group-specific RSS web view
  router.get('/group/:groupId', async (req, res) => {
    const { groupId } = req.params;
    const feedPath = path.join(__dirname, '../../backend/rss/groups', groupId, 'feed.xml');
    
    if (!fs.existsSync(feedPath)) {
      // Try to generate the feed if it doesn't exist
      try {
        await rssManager.generateFromDatabase(groupId, { limit: 50 });
      } catch (error) {
        console.error('Error generating RSS feed:', error);
        return res.status(404).send('RSS feed not found for this group');
      }
    }

    try {
      const parsedFeed = await parseRSSFeed(feedPath);
      const groupData = whatsappManager.getMonitoredGroups().find(g => g.id === groupId);
      const groupName = groupData?.name || 'Unknown Group';

      let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RSS Feed - ${groupName}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        body { background-color: #f8f9fa; }
        .feed-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
        .feed-item { transition: transform 0.2s; }
        .feed-item:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
        .media-container img { max-width: 100%; height: auto; cursor: pointer; }
        .media-container video { max-width: 100%; height: auto; }
        .feed-actions { position: sticky; top: 20px; }
        .message-content { white-space: pre-wrap; word-wrap: break-word; }
        .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.9); }
        .modal-content { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); max-width: 90%; max-height: 90%; }
        .close { position: absolute; top: 15px; right: 35px; color: #f1f1f1; font-size: 40px; font-weight: bold; cursor: pointer; }
    </style>
</head>
<body>
    <div class="container-fluid">
        <div class="row">
            <div class="col-12">
                <div class="feed-header p-4 mb-4">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h1><i class="fas fa-rss me-2"></i>${groupName} - RSS Feed</h1>
                            <p class="mb-0 opacity-75">WhatsApp Group Message Feed</p>
                        </div>
                        <div>
                            <a href="/rss/groups/${groupId}/feed.xml" class="btn btn-light" target="_blank">
                                <i class="fas fa-code me-2"></i>View XML
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="row">
            <div class="col-lg-3">
                <div class="feed-actions">
                    <div class="card mb-3">
                        <div class="card-body">
                            <h5 class="card-title">Feed Info</h5>
                            <p class="mb-1"><strong>Group:</strong> ${groupName}</p>
                            <p class="mb-1"><strong>Items:</strong> ${parsedFeed?.rss?.channel?.[0]?.item?.length || 0}</p>
                            <p class="mb-0"><strong>Last Updated:</strong> ${new Date().toLocaleString()}</p>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-body">
                            <h5 class="card-title">Subscribe</h5>
                            <div class="input-group">
                                <input type="text" class="form-control" value="${req.protocol}://${req.get('host')}/rss/groups/${groupId}/feed.xml" readonly>
                                <button class="btn btn-outline-secondary" onclick="copyToClipboard(this)">
                                    <i class="fas fa-copy"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="col-lg-9">
                <div class="feed-items">`;

      // Add feed items
      const items = parsedFeed?.rss?.channel?.[0]?.item || [];
      
      if (items.length === 0) {
        html += `
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle me-2"></i>
                        No messages in this feed yet. Messages will appear here as they are received.
                    </div>`;
      } else {
        items.forEach((item, index) => {
          const title = item.title?.[0] || 'No title';
          const description = item.description?.[0] || '';
          const date = item.pubDate?.[0] ? new Date(item.pubDate[0]).toLocaleString() : '';
          const guid = item.guid?.[0] || index;
          
          html += `
                    <div class="card feed-item mb-3" id="item-${guid}">
                        <div class="card-body">
                            <h5 class="card-title">${title}</h5>
                            <p class="text-muted small mb-2">
                                <i class="far fa-clock me-1"></i>${date}
                            </p>
                            <div class="message-content">
                                ${description}
                            </div>
                        </div>
                    </div>`;
        });
      }

      html += `
                </div>
            </div>
        </div>
    </div>

    <div id="imageModal" class="modal">
        <span class="close" onclick="closeModal()">&times;</span>
        <img class="modal-content" id="modalImg">
    </div>

    <script>
        function copyToClipboard(button) {
            const input = button.previousElementSibling;
            input.select();
            document.execCommand('copy');
            button.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => {
                button.innerHTML = '<i class="fas fa-copy"></i>';
            }, 2000);
        }

        function openImageModal(img) {
            const modal = document.getElementById('imageModal');
            const modalImg = document.getElementById('modalImg');
            modal.style.display = 'block';
            modalImg.src = img.src;
        }

        function closeModal() {
            document.getElementById('imageModal').style.display = 'none';
        }

        // Click handler for images
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('.media-container img').forEach(img => {
                img.onclick = function() { openImageModal(this); };
            });
        });

        // Auto-refresh every 30 seconds
        setTimeout(() => location.reload(), 30000);
    </script>
</body>
</html>`;

      res.send(html);
    } catch (error) {
      console.error('Error generating RSS view:', error);
      res.status(500).send('Error generating RSS view');
    }
  });

  // Combined RSS web view
  router.get('/combined', async (req, res) => {
    const feedPath = path.join(__dirname, '../../backend/rss/combined/feed.xml');
    
    // Generate combined feed if it doesn't exist
    if (!fs.existsSync(feedPath)) {
      try {
        const monitoredGroupIds = whatsappManager.getMonitoredGroups().map(g => g.id);
        if (monitoredGroupIds.length > 0) {
          await rssManager.generateCombinedFeed(monitoredGroupIds);
        }
      } catch (error) {
        console.error('Error generating combined feed:', error);
      }
    }

    try {
      const parsedFeed = await parseRSSFeed(feedPath);
      const monitoredGroups = whatsappManager.getMonitoredGroups();

      let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Combined RSS Feed - All Groups</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        body { background-color: #f8f9fa; }
        .feed-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
        .feed-item { transition: transform 0.2s; }
        .feed-item:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
        .media-container img { max-width: 100%; height: auto; cursor: pointer; }
        .media-container video { max-width: 100%; height: auto; }
        .feed-actions { position: sticky; top: 20px; }
        .message-content { white-space: pre-wrap; word-wrap: break-word; }
        .group-badge { font-size: 0.8rem; }
        .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.9); }
        .modal-content { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); max-width: 90%; max-height: 90%; }
        .close { position: absolute; top: 15px; right: 35px; color: #f1f1f1; font-size: 40px; font-weight: bold; cursor: pointer; }
    </style>
</head>
<body>
    <div class="container-fluid">
        <div class="row">
            <div class="col-12">
                <div class="feed-header p-4 mb-4">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h1><i class="fas fa-layer-group me-2"></i>Combined RSS Feed</h1>
                            <p class="mb-0 opacity-75">All Monitored WhatsApp Groups</p>
                        </div>
                        <div>
                            <a href="/rss/combined/feed.xml" class="btn btn-light" target="_blank">
                                <i class="fas fa-code me-2"></i>View XML
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="row">
            <div class="col-lg-3">
                <div class="feed-actions">
                    <div class="card mb-3">
                        <div class="card-body">
                            <h5 class="card-title">Feed Info</h5>
                            <p class="mb-1"><strong>Groups:</strong> ${monitoredGroups.length}</p>
                            <p class="mb-1"><strong>Items:</strong> ${parsedFeed?.rss?.channel?.[0]?.item?.length || 0}</p>
                            <p class="mb-0"><strong>Last Updated:</strong> ${new Date().toLocaleString()}</p>
                        </div>
                    </div>
                    
                    <div class="card mb-3">
                        <div class="card-body">
                            <h5 class="card-title">Monitored Groups</h5>`;

      if (monitoredGroups.length === 0) {
        html += '<p class="text-muted">No groups are being monitored.</p>';
      } else {
        html += '<ul class="list-unstyled mb-0">';
        monitoredGroups.forEach(g => {
          html += `
                                <li class="mb-1">
                                    <a href="/api/rss-view/group/${g.id}" target="_blank">
                                        <i class="fas fa-users me-1"></i>${g.name}
                                    </a>
                                </li>`;
        });
        html += '</ul>';
      }

      html += `
                        </div>
                    </div>
                    
                    <div class="card">
                        <div class="card-body">
                            <h5 class="card-title">Subscribe</h5>
                            <div class="input-group">
                                <input type="text" class="form-control" value="${req.protocol}://${req.get('host')}/rss/combined/feed.xml" readonly>
                                <button class="btn btn-outline-secondary" onclick="copyToClipboard(this)">
                                    <i class="fas fa-copy"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="col-lg-9">
                <div class="feed-items">`;

      // Add feed items
      const items = parsedFeed?.rss?.channel?.[0]?.item || [];
      
      if (items.length === 0) {
        html += `
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle me-2"></i>
                        No messages in the combined feed yet. Add groups to monitor and fetch their history.
                    </div>`;
      } else {
        items.forEach((item, index) => {
          const title = item.title?.[0] || 'No title';
          const description = item.description?.[0] || '';
          const date = item.pubDate?.[0] ? new Date(item.pubDate[0]).toLocaleString() : '';
          const guid = item.guid?.[0] || index;
          
          // Extract group name from description if available
          const groupMatch = description.match(/📱 ([^<]+)</);
          const groupName = groupMatch ? groupMatch[1] : 'Unknown Group';
          
          html += `
                    <div class="card feed-item mb-3" id="item-${guid}">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start mb-2">
                                <h5 class="card-title mb-0">${title}</h5>
                                <span class="badge bg-info group-badge">${groupName}</span>
                            </div>
                            <p class="text-muted small mb-2">
                                <i class="far fa-clock me-1"></i>${date}
                            </p>
                            <div class="message-content">
                                ${description}
                            </div>
                        </div>
                    </div>`;
        });
      }

      html += `
                </div>
            </div>
        </div>
    </div>

    <div id="imageModal" class="modal">
        <span class="close" onclick="closeModal()">&times;</span>
        <img class="modal-content" id="modalImg">
    </div>

    <script>
        function copyToClipboard(button) {
            const input = button.previousElementSibling;
            input.select();
            document.execCommand('copy');
            button.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => {
                button.innerHTML = '<i class="fas fa-copy"></i>';
            }, 2000);
        }

        function openImageModal(img) {
            const modal = document.getElementById('imageModal');
            const modalImg = document.getElementById('modalImg');
            modal.style.display = 'block';
            modalImg.src = img.src;
        }

        function closeModal() {
            document.getElementById('imageModal').style.display = 'none';
        }

        // Click handler for images
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('.media-container img').forEach(img => {
                img.onclick = function() { openImageModal(this); };
            });
        });

        // Auto-refresh every 30 seconds
        setTimeout(() => location.reload(), 30000);
    </script>
</body>
</html>`;

      res.send(html);
    } catch (error) {
      console.error('Error generating combined RSS view:', error);
      res.status(500).send('Error generating RSS view');
    }
  });

  // Legacy single group RSS view (redirect to main)
  router.get('/', (req, res) => {
    res.redirect('/');
  });

  return router;
};