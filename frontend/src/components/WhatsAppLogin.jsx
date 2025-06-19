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
      socket.on('qr', (qrDataUrl) => {
        setQrCode(qrDataUrl);
        setIsWaitingForScan(true);
        setIsInitializing(false);
      });

      socket.on('authenticated', () => {
        setQrCode('');
        setIsWaitingForScan(false);
        setIsInitializing(false);
      });

      socket.on('auth_failure', (msg) => {
        setError(`Authentication failed: ${msg}`);
        setIsInitializing(false);
        setIsWaitingForScan(false);
      });
    }

    return () => {
      if (socket) {
        socket.off('qr');
        socket.off('authenticated');
        socket.off('auth_failure');
      }
    };
  }, [socket]);

  const handleInitialize = async () => {
    setIsInitializing(true);
    setError('');
    
    try {
      await axios.post(`${API_BASE}/api/initialize`);
    } catch (error) {
      setError('Failed to initialize WhatsApp client');
      setIsInitializing(false);
      console.error('Initialization error:', error);
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
            <Alert variant="danger" className="mb-3">
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