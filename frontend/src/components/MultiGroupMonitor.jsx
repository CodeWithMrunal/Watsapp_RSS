import React, { useState, useEffect } from 'react';
import { Card, Button, Badge, ListGroup, Alert, Spinner, Form, Row, Col, Tab, Tabs, ButtonGroup, Collapse } from 'react-bootstrap';
import axios from 'axios';
import moment from 'moment';

const API_BASE = 'http://localhost:3001';

function MultiGroupMonitor({ socket, onGoBack }) {
  const [monitoredGroups, setMonitoredGroups] = useState([]);
  const [availableGroups, setAvailableGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedGroupMessages, setSelectedGroupMessages] = useState({});
  const [activeTab, setActiveTab] = useState('all');
  const [fetchingHistory, setFetchingHistory] = useState({});
  const [statistics, setStatistics] = useState({});
  const [historyLimits, setHistoryLimits] = useState({});
  const [showGrouped, setShowGrouped] = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});
  const [previewMedia, setPreviewMedia] = useState(null);

  useEffect(() => {
    loadData();
    setupSocketListeners();

    return () => {
      if (socket) {
        socket.off('new_message');
        socket.off('group_added');
        socket.off('group_removed');
      }
    };
  }, [socket]);

  const setupSocketListeners = () => {
    if (!socket) return;

    socket.on('new_message', (data) => {
      const { groupId, groupName, messageGroup } = data;
      
      // Update messages for the specific group
      setSelectedGroupMessages(prev => ({
        ...prev,
        [groupId]: [messageGroup, ...(prev[groupId] || [])]
      }));
    });

    socket.on('group_added', (groupData) => {
      setMonitoredGroups(prev => [...prev, groupData]);
      // Set default values for new group
      setHistoryLimits(prev => ({ ...prev, [groupData.id]: 50 }));
      setShowGrouped(prev => ({ ...prev, [groupData.id]: true }));
      
      // Update available groups to reflect monitored status
      setAvailableGroups(prev => 
        prev.map(g => g.id === groupData.id ? { ...g, isMonitored: true } : g)
      );
    });

    socket.on('group_removed', ({ groupId }) => {
      setMonitoredGroups(prev => prev.filter(g => g.id !== groupId));
      setSelectedGroupMessages(prev => {
        const newMessages = { ...prev };
        delete newMessages[groupId];
        return newMessages;
      });
      // Clean up state for removed group
      setHistoryLimits(prev => {
        const newLimits = { ...prev };
        delete newLimits[groupId];
        return newLimits;
      });
      setShowGrouped(prev => {
        const newGrouped = { ...prev };
        delete newGrouped[groupId];
        return newGrouped;
      });
      // Update available groups
      setAvailableGroups(prev => 
        prev.map(g => g.id === groupId ? { ...g, isMonitored: false } : g)
      );
    });
  };

  const loadData = async () => {
    setLoading(true);
    try {
      // Load monitored groups
      const monitoredRes = await axios.get(`${API_BASE}/api/multi-group/monitored-groups`);
      setMonitoredGroups(monitoredRes.data.groups);
      
      // Initialize state for each monitored group
      monitoredRes.data.groups.forEach(group => {
        if (!historyLimits[group.id]) {
          setHistoryLimits(prev => ({ ...prev, [group.id]: 50 }));
        }
        if (showGrouped[group.id] === undefined) {
          setShowGrouped(prev => ({ ...prev, [group.id]: true }));
        }
      });

      // Load all available groups
      const groupsRes = await axios.get(`${API_BASE}/api/groups`);
      setAvailableGroups(groupsRes.data);

      // Load statistics
      const statsRes = await axios.get(`${API_BASE}/api/multi-group/multi-group-statistics`);
      setStatistics(statsRes.data.statistics);

      setError('');
    } catch (err) {
      setError('Failed to load data');
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddGroup = async (groupId) => {
    try {
      await axios.post(`${API_BASE}/api/multi-group/add-group`, { groupId });
      // Socket will handle the update
    } catch (err) {
      setError(`Failed to add group: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleRemoveGroup = async (groupId) => {
    try {
      await axios.post(`${API_BASE}/api/multi-group/remove-group`, { groupId });
      // Socket will handle the update
    } catch (err) {
      setError(`Failed to remove group: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleFetchHistory = async (groupId) => {
    const limit = historyLimits[groupId] || 50;
    setFetchingHistory(prev => ({ ...prev, [groupId]: true }));
    try {
      const res = await axios.post(`${API_BASE}/api/multi-group/fetch-group-history`, {
        groupId,
        limit
      });
      
      setSelectedGroupMessages(prev => ({
        ...prev,
        [groupId]: res.data.messages
      }));
    } catch (err) {
      setError(`Failed to fetch history: ${err.response?.data?.error || err.message}`);
    } finally {
      setFetchingHistory(prev => ({ ...prev, [groupId]: false }));
    }
  };

  const handleMediaClick = (msg) => {
    console.log('Media clicked:', msg);
    if (msg.mediaPath) {
      // Ensure proper URL format
      const mediaUrl = msg.mediaPath.startsWith('http') 
        ? msg.mediaPath 
        : `${API_BASE}/${msg.mediaPath.replace(/\\/g, '/')}`;
      setPreviewMedia({ 
        ...msg, 
        src: mediaUrl
      });
    } else if (msg.mediaMetadata?.path) {
      // Handle new media metadata format
      const mediaUrl = msg.mediaMetadata.path.startsWith('http')
        ? msg.mediaMetadata.path
        : `${API_BASE}/${msg.mediaMetadata.path.replace(/\\/g, '/')}`;
      setPreviewMedia({
        ...msg,
        src: mediaUrl,
        mediaPath: msg.mediaMetadata.path
      });
    } else {
      console.log("No media path found in message");
    }
  };

  const closePreview = () => setPreviewMedia(null);

  const toggleGroupExpansion = (groupId, messageGroupId) => {
    const key = `${groupId}-${messageGroupId}`;
    setExpandedGroups(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const getMessageTypeIcon = (type, hasMedia) => {
    if (hasMedia) {
      switch (type) {
        case 'image':
          return <i className="fas fa-image text-success"></i>;
        case 'video':
          return <i className="fas fa-video text-info"></i>;
        case 'audio':
        case 'ptt':
          return <i className="fas fa-microphone text-warning"></i>;
        case 'document':
          return <i className="fas fa-file text-secondary"></i>;
        default:
          return <i className="fas fa-paperclip text-muted"></i>;
      }
    }
    return <i className="fas fa-comment text-primary"></i>;
  };

  const renderMessageGroup = (msgGroup, groupId) => {
    const key = `${groupId}-${msgGroup.id}`;
    const isExpanded = expandedGroups[key];
    const hasMultipleMessages = msgGroup.messages && msgGroup.messages.length > 1;

    return (
      <ListGroup.Item key={`${msgGroup.id}-${Date.now()}`}>
        <div className="d-flex justify-content-between align-items-start">
          <div className="flex-grow-1">
            <div className="d-flex align-items-center mb-1">
              <h6 className="mb-0 me-2">{msgGroup.author}</h6>
              {hasMultipleMessages && (
                <Badge bg="secondary" pill>{msgGroup.messages.length} messages</Badge>
              )}
            </div>
            
            {/* First message always visible */}
            <div className="mb-1">
              {msgGroup.messages?.[0]?.body ? (
                <p className="mb-0">{msgGroup.messages[0].body}</p>
              ) : msgGroup.messages?.[0]?.hasMedia ? (
                <div>
                  <span className="text-primary" style={{ cursor: 'pointer' }}
                    onClick={() => handleMediaClick(msgGroup.messages[0])}>
                    {getMessageTypeIcon(msgGroup.messages[0].type, true)} View {msgGroup.messages[0].type}
                  </span>
                  {msgGroup.messages[0].type === 'image' && msgGroup.messages[0].mediaPath && (
                    <img
                      src={`${API_BASE}/${msgGroup.messages[0].mediaPath.replace(/\\/g, '/')}`}
                      alt="media"
                      className="d-block mt-1"
                      onClick={() => handleMediaClick(msgGroup.messages[0])}
                      style={{ maxWidth: '200px', cursor: 'pointer', borderRadius: '4px' }}
                    />
                  )}
                </div>
              ) : (
                <span className="text-muted">[{msgGroup.messages?.[0]?.type || 'message'}]</span>
              )}
            </div>

            {/* Expandable additional messages */}
            {hasMultipleMessages && (
              <>
                <Collapse in={isExpanded}>
                  <div>
                    {msgGroup.messages.slice(1).map((message, index) => (
                      <div key={index} className="mt-2 ps-3 border-start">
                        <small className="text-muted d-block">
                          {moment(message.timestamp * 1000).format('HH:mm')}
                        </small>
                        {message.body ? (
                          <p className="mb-0">{message.body}</p>
                        ) : message.hasMedia ? (
                          <div>
                            <span className="text-primary" style={{ cursor: 'pointer' }}
                              onClick={() => handleMediaClick(message)}>
                              {getMessageTypeIcon(message.type, true)} View {message.type}
                            </span>
                            {message.type === 'image' && message.mediaPath && (
                              <img
                                src={`${API_BASE}/${message.mediaPath.replace(/\\/g, '/')}`}
                                alt="media"
                                className="d-block mt-1"
                                onClick={() => handleMediaClick(message)}
                                style={{ maxWidth: '200px', cursor: 'pointer', borderRadius: '4px' }}
                              />
                            )}
                          </div>
                        ) : (
                          <span className="text-muted">[{message.type || 'message'}]</span>
                        )}
                      </div>
                    ))}
                  </div>
                </Collapse>
                <Button
                  variant="link"
                  size="sm"
                  className="p-0 mt-1"
                  onClick={() => toggleGroupExpansion(groupId, msgGroup.id)}
                >
                  {isExpanded ? 'Show less' : 'Show more'}
                </Button>
              </>
            )}
            
            <small className="text-muted d-block mt-1">
              {moment(msgGroup.timestamp * 1000).format('MMM DD, HH:mm')}
            </small>
          </div>
        </div>
      </ListGroup.Item>
    );
  };

  const renderIndividualMessages = (messages, groupId) => {
    const allMessages = messages.flatMap(group =>
      group.messages ? group.messages : [group]
    );

    return allMessages.map((message, index) => (
      <ListGroup.Item key={`${message.id}-${index}`}>
        <div className="d-flex justify-content-between align-items-start">
          <div className="flex-grow-1">
            <div className="d-flex align-items-center mb-1">
              <h6 className="mb-0">{message.author}</h6>
              <small className="text-muted ms-2">
                {moment(message.timestamp * 1000).format('HH:mm')}
              </small>
            </div>
            {message.body ? (
              <p className="mb-0">{message.body}</p>
            ) : message.hasMedia ? (
              <div>
                <span className="text-primary" style={{ cursor: 'pointer' }}
                  onClick={() => handleMediaClick(message)}>
                  {getMessageTypeIcon(message.type, true)} View {message.type}
                </span>
                {message.type === 'image' && message.mediaPath && (
                  <img
                    src={`${API_BASE}/${message.mediaPath.replace(/\\/g, '/')}`}
                    alt="media"
                    className="d-block mt-1"
                    onClick={() => handleMediaClick(message)}
                    style={{ maxWidth: '200px', cursor: 'pointer', borderRadius: '4px' }}
                  />
                )}
                {message.type === 'video' && message.mediaPath && (
                  <video
                    src={`${API_BASE}/${message.mediaPath.replace(/\\/g, '/')}`}
                    className="d-block mt-1"
                    onClick={() => handleMediaClick(message)}
                    style={{ maxWidth: '200px', cursor: 'pointer', borderRadius: '4px' }}
                    muted
                  />
                )}
              </div>
            ) : (
              <span className="text-muted">[{message.type || 'message'}]</span>
            )}
          </div>
        </div>
      </ListGroup.Item>
    ));
  };

  const renderGroupTab = (group) => {
    const messages = selectedGroupMessages[group.id] || [];
    const stats = statistics[group.id];
    const isFetching = fetchingHistory[group.id];
    const limit = historyLimits[group.id] || 50;
    const isGrouped = showGrouped[group.id] !== false;

    return (
      <Tab eventKey={group.id} title={
        <span>
          {group.name}
          {messages.length > 0 && (
            <Badge bg="primary" className="ms-2">{messages.length}</Badge>
          )}
        </span>
      } key={group.id}>
        <Card className="mt-3">
          <Card.Header>
            <Row className="align-items-center">
              <Col md={4}>
                <h6 className="mb-0">{group.name}</h6>
                <small className="text-muted">
                  Added: {moment(group.addedAt).fromNow()}
                </small>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-0">
                  <Form.Label className="small mb-1">History Limit:</Form.Label>
                  <Form.Control
                    as="select"
                    size="sm"
                    value={limit}
                    onChange={(e) => setHistoryLimits(prev => ({ 
                      ...prev, 
                      [group.id]: parseInt(e.target.value) 
                    }))}
                  >
                    <option value={25}>25 messages</option>
                    <option value={50}>50 messages</option>
                    <option value={100}>100 messages</option>
                    <option value={200}>200 messages</option>
                    <option value={300}>300 messages</option>
                    <option value={500}>500 messages</option>
                    <option value={1000}>1000 messages</option>
                    <option value={2000}>2000 messages</option>
                  </Form.Control>
                </Form.Group>
              </Col>
              <Col md={4} className="text-end">
                <Form.Check
                  type="switch"
                  id={`group-toggle-${group.id}`}
                  label="Group Messages"
                  checked={isGrouped}
                  onChange={() => setShowGrouped(prev => ({ ...prev, [group.id]: !isGrouped }))}
                  className="d-inline-block me-3"
                />
                <Button
                  variant="info"
                  size="sm"
                  className="me-2"
                  onClick={() => handleFetchHistory(group.id)}
                  disabled={isFetching}
                >
                  {isFetching ? (
                    <Spinner animation="border" size="sm" />
                  ) : (
                    <>
                      <i className="fas fa-history me-1"></i>
                      Fetch
                    </>
                  )}
                </Button>
                <Button
                  variant="success"
                  size="sm"
                  className="me-2"
                  onClick={() => window.open(`${API_BASE}/api/rss-view/group/${group.id}`, '_blank')}
                  title="View RSS Feed"
                >
                  <i className="fas fa-rss"></i>
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleRemoveGroup(group.id)}
                >
                  <i className="fas fa-times"></i>
                </Button>
              </Col>
            </Row>
          </Card.Header>
          <Card.Body>
            {stats && (
              <div className="stats-summary mb-3">
                <Row>
                  <Col md={3}>
                    <div className="text-center">
                      <h5>{stats.summary?.messageCount || 0}</h5>
                      <small className="text-muted">Total Messages</small>
                    </div>
                  </Col>
                  <Col md={3}>
                    <div className="text-center">
                      <h5>{stats.summary?.participantCount || 0}</h5>
                      <small className="text-muted">Participants</small>
                    </div>
                  </Col>
                  <Col md={3}>
                    <div className="text-center">
                      <h5>{stats.stats?.mediaStats?.total || 0}</h5>
                      <small className="text-muted">Media Files</small>
                    </div>
                  </Col>
                  <Col md={3}>
                    <div className="text-center">
                      <h5>{Object.keys(stats.stats?.messageTypes || {}).length}</h5>
                      <small className="text-muted">Message Types</small>
                    </div>
                  </Col>
                </Row>
              </div>
            )}

            <div className="messages-container" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {messages.length === 0 ? (
                <Alert variant="info">
                  No messages loaded. Click "Fetch History" to load messages.
                </Alert>
              ) : (
                <ListGroup variant="flush">
                  {isGrouped 
                    ? messages.map(msgGroup => renderMessageGroup(msgGroup, group.id))
                    : renderIndividualMessages(messages, group.id)
                  }
                </ListGroup>
              )}
            </div>
          </Card.Body>
        </Card>
      </Tab>
    );
  };

  const renderAllGroupsTab = () => {
    const allMessages = [];
    
    // Combine all messages from all groups
    Object.entries(selectedGroupMessages).forEach(([groupId, messages]) => {
      const group = monitoredGroups.find(g => g.id === groupId);
      messages.forEach(msg => {
        allMessages.push({
          ...msg,
          groupId,
          groupName: group?.name || 'Unknown Group'
        });
      });
    });

    // Sort by timestamp
    allMessages.sort((a, b) => b.timestamp - a.timestamp);

    return (
      <Tab eventKey="all" title={
        <span>
          All Groups
          {allMessages.length > 0 && (
            <Badge bg="success" className="ms-2">{allMessages.length}</Badge>
          )}
        </span>
      }>
        <Card className="mt-3">
          <Card.Header className="d-flex justify-content-between align-items-center">
            <h6 className="mb-0">Combined View - All Monitored Groups</h6>
            <Button
              variant="success"
              size="sm"
              onClick={() => window.open(`${API_BASE}/api/rss-view/combined`, '_blank')}
              title="View Combined RSS Feed"
            >
              <i className="fas fa-rss me-1"></i>
              View Combined Feed
            </Button>
          </Card.Header>
          <Card.Body>
            <div className="messages-container" style={{ maxHeight: '500px', overflowY: 'auto' }}>
              {allMessages.length === 0 ? (
                <Alert variant="info">
                  No messages from any monitored groups. Start monitoring groups and fetch their history.
                </Alert>
              ) : (
                <ListGroup variant="flush">
                  {allMessages.slice(0, 100).map((msgGroup, index) => (
                    <ListGroup.Item key={`all-${msgGroup.id}-${index}`}>
                      <div className="d-flex justify-content-between align-items-start">
                        <div className="flex-grow-1">
                          <div className="d-flex align-items-center mb-1">
                            <Badge bg="info" className="me-2">{msgGroup.groupName}</Badge>
                            <h6 className="mb-0">{msgGroup.author}</h6>
                          </div>
                          <p className="mb-1">
                            {msgGroup.messages?.[0]?.body || `[${msgGroup.messages?.[0]?.type || 'media'}]`}
                          </p>
                          <small className="text-muted">
                            {moment(msgGroup.timestamp * 1000).format('MMM DD, HH:mm')}
                          </small>
                        </div>
                      </div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </div>
          </Card.Body>
        </Card>
      </Tab>
    );
  };

  if (loading) {
    return (
      <Card className="text-center">
        <Card.Body className="py-5">
          <Spinner animation="border" variant="primary" className="mb-3" />
          <p className="text-muted">Loading multi-group monitor...</p>
        </Card.Body>
      </Card>
    );
  }

  return (
    <div className="multi-group-monitor">
      <Card className="mb-4">
        <Card.Header className="bg-primary text-white d-flex justify-content-between align-items-center">
          <h5 className="mb-0">
            <i className="fas fa-layer-group me-2"></i>
            Multi-Group Monitor
          </h5>
          <div>
            <Button
              variant="success"
              size="sm"
              className="me-2"
              onClick={() => window.open(`${API_BASE}/api/rss-view/combined`, '_blank')}
              title="Combined RSS Feed"
            >
              <i className="fas fa-rss me-1"></i>
              Combined Feed
            </Button>
            <Button
              variant="outline-light"
              size="sm"
              onClick={onGoBack}
            >
              <i className="fas fa-arrow-left me-1"></i>
              Back
            </Button>
          </div>
        </Card.Header>
        <Card.Body>
          {error && (
            <Alert variant="danger" dismissible onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          <Row>
            <Col md={4}>
              <Card>
                <Card.Header>
                  <h6 className="mb-0">Available Groups</h6>
                </Card.Header>
                <Card.Body style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  <ListGroup variant="flush">
                    {availableGroups
                      .filter(g => !g.isMonitored)
                      .map(group => (
                        <ListGroup.Item 
                          key={group.id}
                          className="d-flex justify-content-between align-items-center"
                        >
                          <div>
                            <h6 className="mb-0">{group.name}</h6>
                            <small className="text-muted">
                              {group.participantCount} members
                            </small>
                          </div>
                          <Button
                            variant="success"
                            size="sm"
                            onClick={() => handleAddGroup(group.id)}
                          >
                            <i className="fas fa-plus"></i>
                          </Button>
                        </ListGroup.Item>
                      ))}
                  </ListGroup>
                  {availableGroups.filter(g => !g.isMonitored).length === 0 && (
                    <p className="text-muted text-center mb-0">
                      All groups are being monitored
                    </p>
                  )}
                </Card.Body>
              </Card>
            </Col>

            <Col md={8}>
              <Card>
                <Card.Header>
                  <div className="d-flex justify-content-between align-items-center">
                    <h6 className="mb-0">
                      Monitored Groups
                      <Badge bg="primary" className="ms-2">
                        {monitoredGroups.length}
                      </Badge>
                    </h6>
                    <Button
                      variant="info"
                      size="sm"
                      onClick={loadData}
                    >
                      <i className="fas fa-sync"></i>
                    </Button>
                  </div>
                </Card.Header>
                <Card.Body className="p-0">
                  {monitoredGroups.length === 0 ? (
                    <Alert variant="info" className="m-3">
                      No groups are being monitored. Add groups from the left panel.
                    </Alert>
                  ) : (
                    <Tabs
                      activeKey={activeTab}
                      onSelect={setActiveTab}
                      className="mb-0"
                    >
                      {renderAllGroupsTab()}
                      {monitoredGroups.map(group => renderGroupTab(group))}
                    </Tabs>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <div className="mt-3 text-center">
            <small className="text-muted">
              <i className="fas fa-info-circle me-1"></i>
              Messages are updated in real-time. Each group has its own RSS feed.
            </small>
          </div>
        </Card.Body>
      </Card>

      {/* Media Preview Modal */}
      {previewMedia && (
        <div className="media-preview-overlay" onClick={closePreview} style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div className="media-preview-content" onClick={(e) => e.stopPropagation()} style={{
            maxWidth: '90%',
            maxHeight: '90%',
            position: 'relative'
          }}>
            <Button 
              variant="danger" 
              onClick={closePreview}
              style={{ position: 'absolute', top: -40, right: 0 }}
            >
              Close
            </Button>

            {previewMedia.type === 'image' && (
              <img 
                src={previewMedia.src} 
                alt="Preview" 
                style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '8px' }} 
              />
            )}

            {previewMedia.type === 'video' && previewMedia.src && (
              <video
                src={previewMedia.src}
                controls
                autoPlay
                style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '8px' }}
              />
            )}

            {previewMedia.type === 'audio' && previewMedia.src && (
              <audio
                src={previewMedia.src}
                controls
                autoPlay
                style={{ width: '100%' }}
              />
            )}

            {!['image', 'video', 'audio'].includes(previewMedia.type) && (
              <p className="text-white">Preview not supported for this media type.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default MultiGroupMonitor;