import React, { useState, useEffect } from 'react';
import { Card, Button, Badge, ListGroup, Alert, Spinner, Form, Row, Col, Tab, Tabs } from 'react-bootstrap';
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

  const handleFetchHistory = async (groupId, limit = 50) => {
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

  const renderGroupTab = (group) => {
    const messages = selectedGroupMessages[group.id] || [];
    const stats = statistics[group.id];
    const isFetching = fetchingHistory[group.id];

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
          <Card.Header className="d-flex justify-content-between align-items-center">
            <div>
              <h6 className="mb-0">{group.name}</h6>
              <small className="text-muted">
                Added: {moment(group.addedAt).fromNow()}
              </small>
            </div>
            <div>
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
                    Fetch History
                  </>
                )}
              </Button>
              <Button
                variant="success"
                size="sm"
                className="me-2"
                onClick={() => window.open(`/rss/groups/${group.id}/feed.xml`, '_blank')}
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
            </div>
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
                  {messages.map((msgGroup, index) => (
                    <ListGroup.Item key={`${msgGroup.id}-${index}`}>
                      <div className="d-flex justify-content-between align-items-start">
                        <div>
                          <h6 className="mb-1">{msgGroup.author}</h6>
                          <p className="mb-1">
                            {msgGroup.messages?.[0]?.body || `[${msgGroup.messages?.[0]?.type || 'media'}]`}
                          </p>
                          <small className="text-muted">
                            {moment(msgGroup.timestamp * 1000).format('MMM DD, HH:mm')}
                            {msgGroup.messages?.length > 1 && (
                              <Badge bg="secondary" className="ms-2">
                                {msgGroup.messages.length} messages
                              </Badge>
                            )}
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
          <Card.Header>
            <h6 className="mb-0">Combined View - All Monitored Groups</h6>
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
              onClick={() => window.open('/rss/combined/feed.xml', '_blank')}
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
    </div>
  );
}

export default MultiGroupMonitor;