import React, { useState, useEffect } from 'react';
import { Card, ListGroup, Button, Spinner, Alert, Badge, Form, InputGroup } from 'react-bootstrap';
import axios from 'axios';

const API_BASE = 'http://localhost:3001';

function GroupSelection({ onGroupSelected, onLogout }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await axios.get(`${API_BASE}/api/groups`);
      setGroups(response.data);
    } catch (error) {
      setError('Failed to fetch WhatsApp groups');
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
      setError('Failed to select group');
      console.error('Error selecting group:', error);
    }
  };

  const filteredGroups = groups.filter(group =>
    group.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <Card className="text-center">
        <Card.Body>
          <Spinner animation="border" variant="primary" className="mb-3" />
          <p className="text-muted">Loading your WhatsApp groups...</p>
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
          <Alert variant="danger" className="mb-3">
            {error}
            <Button
              variant="outline-danger"
              size="sm"
              className="ms-2"
              onClick={fetchGroups}
            >
              Retry
            </Button>
          </Alert>
        )}

        {groups.length > 0 && (
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
        )}

        {groups.length === 0 && !loading ? (
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
        </div>
      </Card.Body>
    </Card>
  );
}

export default GroupSelection;