import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Alert, Button } from 'react-bootstrap';
import io from 'socket.io-client';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import WhatsAppLogin from '../components/whatsapp/WhatsAppLogin';
import GroupSelection from '../components/groups/GroupSelection';
import UserFilter from '../components/filters/UserFilter';
import MessageDisplay from '../components/messages/MessageDisplay';

const API_BASE = 'http://localhost:3001';

function DashboardPage() {
  const [socket, setSocket] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [showGrouped, setShowGrouped] = useState(true);
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState('');
  
  const { user, logout } = useAuth();

  useEffect(() => {
    // Initialize socket connection with auth token
    const token = localStorage.getItem('token');
    const newSocket = io(API_BASE, {
      auth: { token }
    });
    
    setSocket(newSocket);

    // Socket event listeners
    newSocket.on('connect', () => {
      setStatus('connected');
      setError('');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      if (error.message === 'Authentication failed') {
        logout();
      }
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

    newSocket.on('new_message', (messageGroup) => {
      setMessages(prev => [messageGroup, ...prev]);
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
  }, [logout]);

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
  };

  const handleGoBackToUserFilter = () => {
    setSelectedUser(null);
    setMessages([]);
  };

  const handleWhatsAppLogout = async () => {
    try {
      await axios.post(`${API_BASE}/api/logout`);
      setIsAuthenticated(false);
      setIsReady(false);
      setSelectedGroup(null);
      setSelectedUser(null);
      setMessages([]);
      setStatus('disconnected');
      setError('');
      console.log('✅ WhatsApp logout successful');
    } catch (error) {
      console.error('Error logging out WhatsApp:', error);
      setError('Failed to logout WhatsApp properly');
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
          onLogout={handleWhatsAppLogout}
          isReady={isReady}
          socket={socket}
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
        <Col lg={10} xl={8}>
          <div className="app-header text-center mb-4">
            <h1 className="display-4 text-primary">WhatsApp Monitor</h1>
            <div className="status-indicator">
              <span className={`badge ${getStatusColor()}`}>
                {getStatusText()}
              </span>
              <span className="badge bg-info ms-2">
                {user?.username}
              </span>
              {isAuthenticated && (
                <Button
                  variant="outline-danger"
                  size="sm"
                  className="ms-2"
                  onClick={handleWhatsAppLogout}
                  title="Disconnect WhatsApp"
                >
                  <i className="fas fa-sign-out-alt"></i> Disconnect
                </Button>
              )}
              <Button
                variant="outline-secondary"
                size="sm"
                className="ms-2"
                onClick={logout}
                title="Logout from app"
              >
                <i className="fas fa-power-off"></i> Logout
              </Button>
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

export default DashboardPage;