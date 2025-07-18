import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Alert, Button, ButtonGroup, Badge } from 'react-bootstrap';
import io from 'socket.io-client';
import axios from 'axios';
import WhatsAppLogin from './components/WhatsAppLogin';
import GroupSelection from './components/GroupSelection';
import UserFilter from './components/UserFilter';
import MessageDisplay from './components/MessageDisplay';
import MultiGroupMonitor from './components/MultiGroupMonitor';
import './App.css';

const API_BASE = 'http://localhost:3001';

function App() {
  const [socket, setSocket] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [showGrouped, setShowGrouped] = useState(true);
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState('');
  const [monitorMode, setMonitorMode] = useState('single'); // 'single' or 'multi'

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
      setIsReady(false);
      setSelectedGroup(null);
      setSelectedUser(null);
      setMessages([]);
    });

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
    });

    newSocket.on('auth_failure', (msg) => {
      setError(`Authentication failed: ${msg}`);
      setIsAuthenticated(false);
      setIsReady(false);
    });

    newSocket.on('new_message', (data) => {
      // Handle both single and multi-group message formats
      if (data.messageGroup) {
        // Multi-group format
        if (!selectedGroup || data.groupId === selectedGroup.id) {
          setMessages(prev => [data.messageGroup, ...prev]);
        }
      } else {
        // Legacy single group format
        setMessages(prev => [data, ...prev]);
      }
    });

    newSocket.on('status', (statusData) => {
      setIsAuthenticated(statusData.authenticated);
      setIsReady(statusData.ready || false);
      if (statusData.selectedGroup) {
        setSelectedGroup({ name: statusData.selectedGroup });
      }
      setSelectedUser(statusData.selectedUser);
    });

    newSocket.on('loading_progress', ({ percent, message }) => {
      console.log(`Loading: ${percent}% - ${message}`);
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
      setIsReady(response.data.ready || false);
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
    setMonitorMode('single');
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

  const handleGoBackToGroups = () => {
    setSelectedGroup(null);
    setSelectedUser(null);
    setMessages([]);
    setMonitorMode('single');
  };

  const handleGoBackToUserFilter = () => {
    setSelectedUser(null);
    setMessages([]);
  };

  const handleLogout = async () => {
    try {
      await axios.post(`${API_BASE}/api/logout`);
      
      setIsAuthenticated(false);
      setIsReady(false);
      setSelectedGroup(null);
      setSelectedUser(null);
      setMessages([]);
      setStatus('disconnected');
      setError('');
      setMonitorMode('single');
      
      console.log('✅ Logout successful, state reset');
      
    } catch (error) {
      console.error('Error logging out:', error);
      setError('Failed to logout properly');
      
      setIsAuthenticated(false);
      setIsReady(false);
      setSelectedGroup(null);
      setSelectedUser(null);
      setMessages([]);
      setStatus('disconnected');
      setMonitorMode('single');
    }
  };

  const renderMonitorModeSelector = () => {
    if (!isReady || monitorMode === 'multi') return null;
    
    return (
      <div className="text-center mb-4">
        <h6 className="text-muted mb-2">Choose Monitoring Mode:</h6>
        <ButtonGroup>
          <Button
            variant={monitorMode === 'single' ? 'primary' : 'outline-primary'}
            onClick={() => setMonitorMode('single')}
          >
            <i className="fas fa-user me-2"></i>
            Single Group Mode
          </Button>
          <Button
            variant={monitorMode === 'multi' ? 'primary' : 'outline-primary'}
            onClick={() => setMonitorMode('multi')}
          >
            <i className="fas fa-layer-group me-2"></i>
            Multi-Group Mode
          </Button>
        </ButtonGroup>
        <div className="mt-2">
          <small className="text-muted">
            {monitorMode === 'single' ? 
              'Monitor one group at a time with user filtering' : 
              'Monitor multiple groups simultaneously'
            }
          </small>
        </div>
      </div>
    );
  };

  const renderCurrentStep = () => {
    if (!isAuthenticated) {
      return <WhatsAppLogin socket={socket} />;
    }
    
    if (monitorMode === 'multi') {
      return (
        <MultiGroupMonitor 
          socket={socket}
          onGoBack={() => setMonitorMode('single')}
        />
      );
    }
    
    if (!selectedGroup) {
      return (
        <>
          {renderMonitorModeSelector()}
          <GroupSelection 
            onGroupSelected={handleGroupSelected}
            onLogout={handleLogout}
            isReady={isReady}
            socket={socket}
          />
        </>
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

  const getStatusText = () => {
    if (isReady) return 'WhatsApp Ready';
    if (isAuthenticated) return 'Initializing...';
    if (status === 'connected') return 'Server Connected';
    return 'Disconnected';
  };

  const getStatusColor = () => {
    if (isReady) return 'bg-success';
    if (isAuthenticated) return 'bg-warning';
    if (status === 'connected') return 'bg-info';
    return 'bg-danger';
  };

  return (
    <Container fluid className="app-container">
      <Row className="justify-content-center">
        <Col lg={10} xl={monitorMode === 'multi' ? 11 : 8}>
          <div className="app-header text-center mb-4">
            <h1 className="display-4 text-primary">
              WhatsApp Monitor
              {monitorMode === 'multi' && (
                <Badge bg="success" className="ms-2" style={{ fontSize: '0.4em' }}>
                  Multi-Group
                </Badge>
              )}
            </h1>
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

          {selectedGroup && monitorMode === 'single' && (
            <Alert variant="info" className="text-center">
              <strong>Monitoring:</strong> {selectedGroup.name}
              {selectedUser && (
                <span className="ms-2">
                  | <strong>User:</strong> {selectedUser}
                </span>
              )}
            </Alert>
          )}

          {selectedGroup && monitorMode === 'single' && (
            <div className="text-center mb-4">
              <Button
                variant="success"
                onClick={() => window.open('http://localhost:3001/api/rss-view', '_blank')}
              >
                <i className="fas fa-rss me-2"></i>
                View RSS Feed
              </Button>
            </div>
          )}

          {renderCurrentStep()}
        </Col>
      </Row>
    </Container>
  );
}

export default App;