import React, { useState, useEffect } from 'react';
import { Card, ListGroup, Button, Spinner, Alert, Badge, Form, InputGroup } from 'react-bootstrap';
import axios from 'axios';
import WhatsAppLoadingProgress from '../whatsapp/WhatsAppLoadingProgress';

const API_BASE = 'http://localhost:3001';

function GroupSelection({ onGroupSelected, onLogout, isReady, socket }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isWhatsAppLoading, setIsWhatsAppLoading] = useState(true);
  const [canFetchGroups, setCanFetchGroups] = useState(false);

  useEffect(() => {
    // Only fetch groups when WhatsApp is ready AND loaded
    if (isReady && canFetchGroups) {
      fetchGroups();
    }
  }, [isReady, canFetchGroups]);

  const handleWhatsAppFullyLoaded = () => {
    console.log('WhatsApp fully loaded, enabling group fetch');
    setIsWhatsAppLoading(false);
    setCanFetchGroups(true);
  };

  const fetchGroups = async () => {
    if (!canFetchGroups && !isWhatsAppLoading) {
      setError('WhatsApp is still loading your chats. Please wait...');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const response = await axios.get(`${API_BASE}/api/groups`);
      setGroups(response.data);
      setError('');
      
      if (response.data.length === 0) {
        setError('No WhatsApp groups found. Make sure you\'re part of at least one group.');
      }
    } catch (error) {
      if (error.response?.data?.error?.includes('still loading')) {
        setError('WhatsApp is still loading your chats. This can take 3-5 minutes for large accounts.');
        setIsWhatsAppLoading(true);
        setCanFetchGroups(false);
      } else {
        setError(error.response?.data?.error || 'Failed to fetch WhatsApp groups');
      }
      console.error('Error fetching groups:', error);
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
      setError('Failed to select group. Please try again.');
      console.error('Error selecting group:', error);
    }
  };

  const handleRetry = () => {
    if (canFetchGroups) {
      fetchGroups();
    } else {
      setError('Please wait for WhatsApp to finish loading before retrying.');
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
          <h5 className="text-muted mb-2">Connecting to WhatsApp</h5>
          <p className="text-muted small">
            Establishing connection with WhatsApp Web...
          </p>
        </Card.Body>
      </Card>
    );
  }

  // Show loading progress if WhatsApp is still loading
  if (isWhatsAppLoading || !canFetchGroups) {
    return (
      <>
        <WhatsAppLoadingProgress 
          socket={socket} 
          onFullyLoaded={handleWhatsAppFullyLoaded}
        />
        
        <Card className="text-center">
          <Card.Body className="py-5">
            <div className="mb-3">
              <i className="fab fa-whatsapp text-success" style={{ fontSize: '3rem' }}></i>
            </div>
            <h5 className="text-muted mb-2">WhatsApp is Loading Your Chats</h5>
            <p className="text-muted">
              This process typically takes 3-5 minutes for accounts with many chats.
              <br />
              Please wait while WhatsApp loads all your groups...
            </p>
            <Button
              variant="outline-primary"
              size="sm"
              onClick={handleRetry}
              className="mt-3"
            >
              Check Status
            </Button>
          </Card.Body>
        </Card>
      </>
    );
  }

  return (
    <>
      {/* Show loading progress even after groups are loaded */}
      <WhatsAppLoadingProgress socket={socket} />
      
      <Card className="group-selection-card">
        <Card.Header className="bg-primary text-white d-flex justify-content-between align-items-center">
          <h5 className="mb-0">
            <i className="fas fa-users me-2"></i>
            Select WhatsApp Group to Monitor
          </h5>
          <div>
            <Button
              variant="outline-light"
              size="sm"
              onClick={handleRetry}
              className="me-2"
              title="Refresh groups"
              disabled={loading}
            >
              <i className="fas fa-sync-alt"></i>
            </Button>
            <Button
              variant="outline-light"
              size="sm"
              onClick={onLogout}
              title="Disconnect WhatsApp"
            >
              <i className="fas fa-sign-out-alt me-1"></i>
              Disconnect
            </Button>
          </div>
        </Card.Header>
        <Card.Body>
          {error && (
            <Alert variant="danger" className="mb-3">
              {error}
            </Alert>
          )}

          {loading ? (
            <div className="text-center py-5">
              <Spinner animation="border" variant="primary" className="mb-3" />
              <p className="text-muted">Loading your WhatsApp groups...</p>
            </div>
          ) : (
            <>
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
                  <Button
                    variant="outline-info"
                    size="sm"
                    className="ms-2"
                    onClick={handleRetry}
                  >
                    Refresh
                  </Button>
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
            </>
          )}
        </Card.Body>
      </Card>
    </>
  );
}

export default GroupSelection;