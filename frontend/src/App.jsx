import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Alert } from 'react-bootstrap';
import io from 'socket.io-client';
import axios from 'axios';
import WhatsAppLogin from './components/WhatsAppLogin';
import GroupSelection from './components/GroupSelection';
import UserFilter from './components/UserFilter';
import MessageDisplay from './components/MessageDisplay';
import './App.css';

const API_BASE = 'http://localhost:3001';

function App() {
  const [socket, setSocket] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [showGrouped, setShowGrouped] = useState(true);
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState('');

  useEffect(() => {
    // Initialize socket connection
    const newSocket = io(API_BASE);
    setSocket(newSocket);

    // Socket event listeners
    newSocket.on('connect', () => {
      setStatus('connected');
      setError('');
    });

    newSocket.on('disconnect', () => {
      setStatus('disconnected');
    });

    newSocket.on('authenticated', () => {
      setIsAuthenticated(true);
      setStatus('authenticated');
      setError('');
    });

    newSocket.on('auth_failure', (msg) => {
      setError(`Authentication failed: ${msg}`);
      setIsAuthenticated(false);
    });

    newSocket.on('new_message', (messageGroup) => {
      setMessages(prev => [messageGroup, ...prev]);
    });

    newSocket.on('status', (statusData) => {
      setIsAuthenticated(statusData.authenticated);
      if (statusData.selectedGroup) {
        setSelectedGroup({ name: statusData.selectedGroup });
      }
      setSelectedUser(statusData.selectedUser);
    });

    // Check initial status
    checkStatus();

    return () => {
      newSocket.close();
    };
  }, []);

  const checkStatus = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/status`);
      setIsAuthenticated(response.data.authenticated);
      if (response.data.selectedGroup) {
        setSelectedGroup({ name: response.data.selectedGroup });
      }
      setSelectedUser(response.data.selectedUser);
    } catch (error) {
      console.error('Error checking status:', error);
    }
  };

  const handleGroupSelected = (group) => {
    setSelectedGroup(group);
    setMessages([]);
    setSelectedUser(null);
  };

  const handleUserSelected = (user) => {
    setSelectedUser(user);
    setMessages([]);
  };

  const handleFetchHistory = async (limit) => {
    try {
      const response = await axios.post(`${API_BASE}/api/fetch-history`, { limit });
      setMessages(response.data.messages);
    } catch (error) {
      setError('Failed to fetch message history');
      console.error('Error fetching history:', error);
    }
  };

  const handleToggleGrouping = () => {
    setShowGrouped(!showGrouped);
  };

  const renderCurrentStep = () => {
    if (!isAuthenticated) {
      return <WhatsAppLogin socket={socket} />;
    }
    
    if (!selectedGroup) {
      return <GroupSelection onGroupSelected={handleGroupSelected} />;
    }
    
    return (
      <>
        <UserFilter 
          selectedGroup={selectedGroup}
          selectedUser={selectedUser}
          onUserSelected={handleUserSelected}
          onFetchHistory={handleFetchHistory}
        />
        <MessageDisplay 
          messages={messages}
          showGrouped={showGrouped}
          onToggleGrouping={handleToggleGrouping}
          selectedUser={selectedUser}
        />
      </>
    );
  };

  return (
    <Container fluid className="app-container">
      <Row className="justify-content-center">
        <Col lg={10} xl={8}>
          <div className="app-header text-center mb-4">
            <h1 className="display-4 text-primary">WhatsApp Monitor</h1>
            <div className="status-indicator">
              <span className={`badge ${
                status === 'authenticated' ? 'bg-success' : 
                status === 'connected' ? 'bg-warning' : 'bg-danger'
              }`}>
                {status === 'authenticated' ? 'WhatsApp Connected' :
                 status === 'connected' ? 'Server Connected' : 'Disconnected'}
              </span>
            </div>
          </div>

          {error && (
            <Alert variant="danger" dismissible onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {selectedGroup && (
            <Alert variant="info" className="text-center">
              <strong>Monitoring:</strong> {selectedGroup.name}
              {selectedUser && (
                <span className="ms-2">
                  | <strong>User:</strong> {selectedUser}
                </span>
              )}
            </Alert>
          )}

          {renderCurrentStep()}
        </Col>
      </Row>
    </Container>
  );
}

export default App;