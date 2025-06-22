import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Alert, Button } from 'react-bootstrap';
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
  const [isReady, setIsReady] = useState(false); // ADD THIS
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

    newSocket.on('disconnected', (reason) => {
      console.log('WhatsApp disconnected:', reason);
      setStatus('disconnected');
      setIsAuthenticated(false);
      setIsReady(false); // ADD THIS
      setSelectedGroup(null);
      setSelectedUser(null);
      setMessages([]);
    });

    // ADD: Listen for ready event
    newSocket.on('ready', () => {
      console.log('WhatsApp client is ready!');
      setIsReady(true);
      setStatus('ready');
      setError('');
    });

    newSocket.on('authenticated', () => {
      setIsAuthenticated(true);
      setStatus('authenticated');
      setError('');
      // Don't set ready here, wait for ready event
    });

    newSocket.on('auth_failure', (msg) => {
      setError(`Authentication failed: ${msg}`);
      setIsAuthenticated(false);
      setIsReady(false); // ADD THIS
    });

    newSocket.on('new_message', (messageGroup) => {
      setMessages(prev => [messageGroup, ...prev]);
    });

    // UPDATE: Handle status with ready state
    newSocket.on('status', (statusData) => {
      setIsAuthenticated(statusData.authenticated);
      setIsReady(statusData.ready || false); // ADD THIS
      if (statusData.selectedGroup) {
        setSelectedGroup({ name: statusData.selectedGroup });
      }
      setSelectedUser(statusData.selectedUser);
    });

    // ADD: Handle loading progress
    newSocket.on('loading_progress', ({ percent, message }) => {
      console.log(`Loading: ${percent}% - ${message}`);
      // You could show this in UI if needed
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
      setIsReady(response.data.ready || false); // ADD THIS
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

  // Go back functions
  const handleGoBackToGroups = () => {
    setSelectedGroup(null);
    setSelectedUser(null);
    setMessages([]);
  };

  const handleGoBackToUserFilter = () => {
    setSelectedUser(null);
    setMessages([]);
  };

  const handleLogout = async () => {
    try {
      await axios.post(`${API_BASE}/api/logout`);
      
      // Reset all state immediately
      setIsAuthenticated(false);
      setIsReady(false); // ADD THIS
      setSelectedGroup(null);
      setSelectedUser(null);
      setMessages([]);
      setStatus('disconnected');
      setError('');
      
      console.log('✅ Logout successful, state reset');
      
    } catch (error) {
      console.error('Error logging out:', error);
      setError('Failed to logout properly');
      
      // Force reset state even if logout call fails
      setIsAuthenticated(false);
      setIsReady(false); // ADD THIS
      setSelectedGroup(null);
      setSelectedUser(null);
      setMessages([]);
      setStatus('disconnected');
    }
  };

  const renderCurrentStep = () => {
    if (!isAuthenticated) {
      return <WhatsAppLogin socket={socket} />;
    }
    
    if (!selectedGroup) {
      return (
        <GroupSelection 
          onGroupSelected={handleGroupSelected}
          onLogout={handleLogout}
          isReady={isReady} // ADD THIS PROP
          socket={socket} // ADD THIS PROP
        />
      );
    }
    
    return (
      <>
        <UserFilter 
          selectedGroup={selectedGroup}
          selectedUser={selectedUser}
          onUserSelected={handleUserSelected}
          onFetchHistory={handleFetchHistory}
          onGoBack={handleGoBackToGroups}
        />
        <MessageDisplay 
          messages={messages}
          showGrouped={showGrouped}
          onToggleGrouping={handleToggleGrouping}
          selectedUser={selectedUser}
          selectedGroup={selectedGroup}
          onGoBackToUserFilter={handleGoBackToUserFilter}
        />
      </>
    );
  };

  // UPDATE: Get status text
  const getStatusText = () => {
    if (isReady) return 'WhatsApp Ready';
    if (isAuthenticated) return 'Initializing...';
    if (status === 'connected') return 'Server Connected';
    return 'Disconnected';
  };

  // UPDATE: Get status color
  const getStatusColor = () => {
    if (isReady) return 'bg-success';
    if (isAuthenticated) return 'bg-warning';
    if (status === 'connected') return 'bg-info';
    return 'bg-danger';
  };

  return (
    <Container fluid className="app-container">
      <Row className="justify-content-center">
        <Col lg={10} xl={8}>
          <div className="app-header text-center mb-4">
            <h1 className="display-4 text-primary">WhatsApp Monitor</h1>
            <div className="status-indicator">
              <span className={`badge ${getStatusColor()}`}>
                {getStatusText()}
              </span>
              {isAuthenticated && (
                <Button
                  variant="outline-danger"
                  size="sm"
                  className="ms-2"
                  onClick={handleLogout}
                  title="Disconnect WhatsApp"
                >
                  <i className="fas fa-sign-out-alt"></i>
                </Button>
              )}
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