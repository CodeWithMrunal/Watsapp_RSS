import React, { useState, useEffect } from 'react';
import { Card, ListGroup, Button, Spinner, Alert, Badge, Form, InputGroup } from 'react-bootstrap';
import axios from 'axios';

const API_BASE = 'http://localhost:3001';

function GroupSelection({ onGroupSelected, onLogout, isReady, socket }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    // Only fetch groups when ready
    if (isReady) {
      fetchGroups();
    } else {
      // Show loading state while waiting for ready
      setLoading(true);
      setError('');
    }
  }, [isReady]);

  // ADD: Listen for ready state changes
  useEffect(() => {
    if (socket) {
      const handleNotReady = (data) => {
        console.log('Client not ready:', data.message);
        setError('WhatsApp is still initializing. Please wait...');
        // Retry after delay
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
        }, 2000);
      };

      socket.on('not_ready', handleNotReady);

      return () => {
        socket.off('not_ready', handleNotReady);
      };
    }
  }, [socket]);

  // ADD: Retry effect
  useEffect(() => {
    if (retryCount > 0 && isReady) {
      fetchGroups();
    }
  }, [retryCount, isReady]);

  const fetchGroups = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await axios.get(`${API_BASE}/api/groups`);
      setGroups(response.data);
      setError(''); // Clear any previous errors
    } catch (error) {
      // Handle 503 (Service Unavailable) specially
      if (error.response && error.response.status === 503) {
        console.log('WhatsApp not ready, will retry...');
        setError('WhatsApp is initializing. This may take a moment...');
        
        // Retry after 2 seconds
        setTimeout(() => {
          if (isReady) {
            fetchGroups();
          }
        }, 2000);
      } else {
        setError('Failed to fetch WhatsApp groups');
        console.error('Error fetching groups:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelectGroup = async (groupId, groupName) => {
    try {
      const response = await axios.post(`${API_BASE}/api/select-group`, { groupId });
      if (response.data.success) {
        onGroupSelected({ id: groupId, name: groupName });
      }
    } catch (error) {
      setError('Failed to select group');
      console.error('Error selecting group:', error);
    }
  };

  const filteredGroups = groups.filter(group =>
    group.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Show initializing state if not ready
  if (!isReady) {
    return (
      <Card className="text-center">
        <Card.Body className="py-5">
          <Spinner animation="border" variant="primary" className="mb-3" />
          <h5 className="text-muted mb-2">Initializing WhatsApp Connection</h5>
          <p className="text-muted small">
            This may take a few moments. Please wait while we establish the connection...
          </p>
          <div className="progress mt-3" style={{ height: '4px' }}>
            <div 
              className="progress-bar progress-bar-striped progress-bar-animated" 
              role="progressbar" 
              style={{ width: '100%' }}
            ></div>
          </div>
        </Card.Body>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="text-center">
        <Card.Body className="py-5">
          <Spinner animation="border" variant="primary" className="mb-3" />
          <p className="text-muted">Loading your WhatsApp groups...</p>
          <small className="text-muted">
            {groups.length > 0 ? `${groups.length} groups loaded...` : 'Fetching groups from WhatsApp...'}
          </small>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className="group-selection-card">
      <Card.Header className="bg-primary text-white d-flex justify-content-between align-items-center">
        <h5 className="mb-0">
          <i className="fas fa-users me-2"></i>
          Select WhatsApp Group to Monitor
        </h5>
        <Button
          variant="outline-light"
          size="sm"
          onClick={onLogout}
          title="Disconnect WhatsApp"
        >
          <i className="fas fa-sign-out-alt me-1"></i>
          Disconnect
        </Button>
      </Card.Header>
      <Card.Body>
        {error && (
          <Alert variant={error.includes('initializing') ? 'warning' : 'danger'} className="mb-3">
            <div className="d-flex align-items-center">
              {error.includes('initializing') && (
                <Spinner animation="border" size="sm" className="me-2" />
              )}
              <span>{error}</span>
            </div>
            {!error.includes('initializing') && (
              <Button
                variant="outline-danger"
                size="sm"
                className="ms-2"
                onClick={fetchGroups}
              >
                Retry
              </Button>
            )}
          </Alert>
        )}

        {groups.length > 0 && (
          <>
            <InputGroup className="mb-3">
              <InputGroup.Text>
                <i className="fas fa-search"></i>
              </InputGroup.Text>
              <Form.Control
                type="text"
                placeholder="Search groups..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </InputGroup>
            
            <div className="text-muted small mb-2">
              Showing {filteredGroups.length} of {groups.length} groups
            </div>
          </>
        )}

        {groups.length === 0 && !loading && !error ? (
          <Alert variant="info" className="text-center">
            <i className="fas fa-info-circle me-2"></i>
            No WhatsApp groups found. Make sure you're part of at least one group.
          </Alert>
        ) : (
          <ListGroup className="group-list">
            {filteredGroups.map((group) => (
              <ListGroup.Item
                key={group.id}
                className="d-flex justify-content-between align-items-center group-item"
                action
                onClick={() => handleSelectGroup(group.id, group.name)}
              >
                <div className="group-info">
                  <h6 className="mb-1">{group.name}</h6>
                  <small className="text-muted">
                    <i className="fas fa-user-friends me-1"></i>
                    {group.participantCount} members
                    {group.lastMessage && (
                      <span className="ms-2">
                        | Last activity: {new Date(group.timestamp * 1000).toLocaleDateString()}
                      </span>
                    )}
                  </small>
                </div>
                <div className="group-actions">
                  <Badge bg="secondary" pill>
                    {group.participantCount}
                  </Badge>
                  <i className="fas fa-arrow-right ms-2 text-primary"></i>
                </div>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}

        {filteredGroups.length === 0 && searchTerm && groups.length > 0 && (
          <Alert variant="warning" className="text-center">
            <i className="fas fa-search me-2"></i>
            No groups found matching "{searchTerm}"
          </Alert>
        )}

        <div className="mt-3 text-center">
          <small className="text-muted">
            Select a group to start monitoring messages and generate RSS feeds
          </small>
          {groups.length > 0 && (
            <div className="mt-2">
              <small className="text-success">
                <i className="fas fa-check-circle me-1"></i>
                Groups loaded from cache for faster access
              </small>
            </div>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}

export default GroupSelection;