import React, { useState, useEffect } from 'react';
import { Card, Button, Spinner, Alert } from 'react-bootstrap';
import axios from 'axios';

const API_BASE = 'http://localhost:3001';

function WhatsAppLogin({ socket }) {
  const [qrCode, setQrCode] = useState('');
  const [isInitializing, setIsInitializing] = useState(false);
  const [isWaitingForScan, setIsWaitingForScan] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (socket) {
      // Clear previous state when socket changes
      setQrCode('');
      setIsWaitingForScan(false);
      setIsInitializing(false);
      setError('');

      const handleQR = (qrDataUrl) => {
        console.log('📱 QR code received');
        setQrCode(qrDataUrl);
        setIsWaitingForScan(true);
        setIsInitializing(false);
        setError('');
      };

      const handleAuthenticated = () => {
        console.log('✅ WhatsApp authenticated');
        setQrCode('');
        setIsWaitingForScan(false);
        setIsInitializing(false);
        setError('');
      };

      const handleAuthFailure = (msg) => {
        console.error('❌ Authentication failed:', msg);
        setError(`Authentication failed: ${msg}`);
        setIsInitializing(false);
        setIsWaitingForScan(false);
        setQrCode('');
      };

      const handleDisconnected = (reason) => {
        console.log('🔌 WhatsApp disconnected:', reason);
        setQrCode('');
        setIsWaitingForScan(false);
        setIsInitializing(false);
        
        // Only show error if it's not a user-initiated logout
        if (reason !== 'User logged out' && reason !== 'Logout error but state reset') {
          setError(`Disconnected: ${reason}`);
        }
      };

      socket.on('qr', handleQR);
      socket.on('authenticated', handleAuthenticated);
      socket.on('auth_failure', handleAuthFailure);
      socket.on('disconnected', handleDisconnected);

      return () => {
        socket.off('qr', handleQR);
        socket.off('authenticated', handleAuthenticated);
        socket.off('auth_failure', handleAuthFailure);
        socket.off('disconnected', handleDisconnected);
      };
    }
  }, [socket]);

  const handleInitialize = async () => {
    setIsInitializing(true);
    setError('');
    setQrCode('');
    setIsWaitingForScan(false);
    
    console.log('🚀 Initializing WhatsApp connection...');
    
    try {
      const response = await axios.post(`${API_BASE}/api/initialize`);
      console.log('✅ Initialize request sent successfully');
      
      // Don't set isInitializing to false here - let the QR event or error handle it
      
    } catch (error) {
      console.error('❌ Initialization error:', error);
      setError('Failed to initialize WhatsApp client');
      setIsInitializing(false);
    }
  };

  return (
    <div className="login-container">
      <Card className="login-card shadow-lg">
        <Card.Header className="bg-success text-white text-center">
          <h4 className="mb-0">
            <i className="fab fa-whatsapp me-2"></i>
            WhatsApp Login
          </h4>
        </Card.Header>
        <Card.Body className="text-center p-4">
          {error && (
            <Alert variant="danger" className="mb-3" dismissible onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {!qrCode && !isInitializing && !isWaitingForScan && (
            <div>
              <p className="text-muted mb-4">
                Connect your WhatsApp account to start monitoring messages
              </p>
              <Button
                variant="success"
                size="lg"
                onClick={handleInitialize}
                className="px-4"
              >
                <i className="fab fa-whatsapp me-2"></i>
                Connect WhatsApp
              </Button>
            </div>
          )}

          {isInitializing && (
            <div>
              <Spinner animation="border" variant="success" className="mb-3" />
              <p className="text-muted">Initializing WhatsApp connection...</p>
              <small className="text-muted d-block">This may take a few seconds...</small>
            </div>
          )}

          {qrCode && (
            <div>
              <p className="text-muted mb-3">
                Scan this QR code with your WhatsApp mobile app
              </p>
              <div className="qr-code-container mb-3">
                <img 
                  src={qrCode} 
                  alt="WhatsApp QR Code" 
                  className="img-fluid border rounded"
                  style={{ maxWidth: '300px' }}
                />
              </div>
              <div className="d-flex align-items-center justify-content-center">
                <Spinner animation="border" size="sm" variant="success" className="me-2" />
                <small className="text-muted">Waiting for scan...</small>
              </div>
              <div className="mt-3">
                <Button 
                  variant="outline-secondary" 
                  size="sm" 
                  onClick={handleInitialize}
                >
                  <i className="fas fa-redo me-1"></i>
                  Generate New QR Code
                </Button>
              </div>
            </div>
          )}

          <hr className="my-4" />
          <div className="instructions">
            <h6 className="text-muted mb-2">How to connect:</h6>
            <ol className="text-start text-muted small">
              <li>Open WhatsApp on your phone</li>
              <li>Go to Settings → Linked Devices</li>
              <li>Tap "Link a Device"</li>
              <li>Scan the QR code above</li>
            </ol>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}

export default WhatsAppLogin;