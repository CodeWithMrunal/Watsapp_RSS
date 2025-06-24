// src/pages/MonitorPage.jsx
import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Alert } from 'react-bootstrap';
import { useSocket } from '../contexts/SocketContext';
import { useWhatsApp } from '../contexts/WhatsAppContext';
import WhatsAppLogin from '../components/whatsapp/WhatsAppLogin';
import GroupSelection from '../components/groups/GroupSelection';
import UserFilter from '../components/filters/UserFilter';
import MessageDisplay from '../components/messages/MessageDisplay';
import ConnectionStatus from '../components/whatsapp/ConnectionStatus';

function MonitorPage() {
  const { socket, connected } = useSocket();
  const { 
    isWhatsAppAuthenticated, 
    isReady, 
    selectedGroup, 
    status 
  } = useWhatsApp();
  
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');

  // Render different components based on state
  const renderContent = () => {
    if (!connected) {
      return (
        <Alert variant="warning">
          <i className="fas fa-exclamation-triangle me-2"></i>
          Connecting to server...
        </Alert>
      );
    }

    if (!isWhatsAppAuthenticated) {
      return <WhatsAppLogin />;
    }

    if (!selectedGroup) {
      return <GroupSelection />;
    }

    return (
      <>
        <UserFilter 
          selectedUser={selectedUser}
          onUserSelected={setSelectedUser}
        />
        <MessageDisplay 
          messages={messages}
          selectedUser={selectedUser}
        />
      </>
    );
  };

  return (
    <Container fluid className="monitor-page py-4">
      <Row>
        <Col lg={12}>
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h1 className="h3">WhatsApp Monitor</h1>
            <ConnectionStatus status={status} isReady={isReady} />
          </div>

          {error && (
            <Alert variant="danger" dismissible onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {renderContent()}
        </Col>
      </Row>
    </Container>
  );
}

export default MonitorPage;