import React, { useState, useEffect } from 'react';
import { Card, Form, Button, Row, Col, Alert, Spinner } from 'react-bootstrap';
import axios from 'axios';

const API_BASE = 'http://localhost:3001';

function UserFilter({ selectedGroup, selectedUser, onUserSelected, onFetchHistory }) {
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyLimit, setHistoryLimit] = useState(50);
  const [fetchingHistory, setFetchingHistory] = useState(false);

  useEffect(() => {
    if (selectedGroup) {
      fetchParticipants();
    }
  }, [selectedGroup]);

  const fetchParticipants = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await axios.get(`${API_BASE}/api/group-participants`);
      setParticipants(response.data);
    } catch (error) {
      setError('Failed to fetch group participants');
      console.error('Error fetching participants:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUserChange = async (userId) => {
    try {
      await axios.post(`${API_BASE}/api/select-user`, { userId });
      onUserSelected(userId === 'all' ? null : userId);
    } catch (error) {
      setError('Failed to select user filter');
      console.error('Error selecting user:', error);
    }
  };

  const handleFetchHistory = async () => {
    setFetchingHistory(true);
    try {
      await onFetchHistory(historyLimit);
    } catch (error) {
      setError('Failed to fetch message history');
    } finally {
      setFetchingHistory(false);
    }
  };

  return (
    <Card className="user-filter-card mb-4">
      <Card.Header className="bg-info text-white">
        <h5 className="mb-0">
          <i className="fas fa-filter me-2"></i>
          Message Filters & History
        </h5>
      </Card.Header>
      <Card.Body>
        {error && (
          <Alert variant="danger" className="mb-3">
            {error}
          </Alert>
        )}

        <Row>
          <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>
                <strong>Filter Messages By User:</strong>
              </Form.Label>
              {loading ? (
                <div className="text-center">
                  <Spinner animation="border" size="sm" />
                  <span className="ms-2">Loading participants...</span>
                </div>
              ) : (
                <Form.Control
                  as="select"
                  value={selectedUser || 'all'}
                  onChange={(e) => handleUserChange(e.target.value)}
                >
                  <option value="all">All Users</option>
                  {participants.map((participant) => (
                    <option key={participant.id} value={participant.id}>
                      {participant.name} {participant.isAdmin ? '(Admin)' : ''}
                    </option>
                  ))}
                </Form.Control>
              )}
              <Form.Text className="text-muted">
                Choose to monitor all messages or filter by specific user
              </Form.Text>
            </Form.Group>
          </Col>

          <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>
                <strong>Historical Messages Limit:</strong>
              </Form.Label>
              <Form.Control
                as="select"
                value={historyLimit}
                onChange={(e) => setHistoryLimit(parseInt(e.target.value))}
              >
                <option value={25}>25 messages</option>
                <option value={50}>50 messages</option>
                <option value={100}>100 messages</option>
                <option value={200}>200 messages</option>
                <option value={300}>300 messages</option>
              </Form.Control>
              <Form.Text className="text-muted">
                Number of past messages to fetch from the group
              </Form.Text>
            </Form.Group>
          </Col>
        </Row>

        <div className="d-flex justify-content-between align-items-center">
          <div className="current-settings">
            <small className="text-muted">
              <strong>Current Filter:</strong> {selectedUser ? 'Specific User' : 'All Users'} | 
              <strong> Group:</strong> {selectedGroup?.name}
            </small>
          </div>
          
          <Button
            variant="primary"
            onClick={handleFetchHistory}
            disabled={fetchingHistory}
            className="fetch-history-btn"
          >
            {fetchingHistory ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Fetching...
              </>
            ) : (
              <>
                <i className="fas fa-history me-2"></i>
                Fetch History
              </>
            )}
          </Button>
        </div>

        <hr className="my-3" />
        
        <div className="info-section">
          <h6 className="text-muted mb-2">
            <i className="fas fa-info-circle me-2"></i>
            How it works:
          </h6>
          <ul className="small text-muted mb-0">
            <li>Select "All Users" to monitor messages from everyone in the group</li>
            <li>Choose a specific user to filter messages from that person only</li>
            <li>Click "Fetch History" to load past messages based on your current filter</li>
            <li>New messages will appear in real-time and be added to the RSS feed</li>
            <li>Messages from the same user within 5 minutes are grouped together</li>
          </ul>
        </div>
      </Card.Body>
    </Card>
  );
}

export default UserFilter;