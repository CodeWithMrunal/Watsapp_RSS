import React, { useState, useEffect } from 'react';
import { Alert, Badge } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';

function MultiUserStatus({ socket }) {
  const [activeUsers, setActiveUsers] = useState(0);
  const [queuePosition, setQueuePosition] = useState(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!socket) return;

    const handleStatus = (status) => {
      if (status.initializing && !status.ready) {
        // User is in initialization queue
        setQueuePosition(status.queuePosition || 'pending');
      } else {
        setQueuePosition(null);
      }
    };

    const handleServerStats = (stats) => {
      setActiveUsers(stats.activeUsers || 0);
    };

    socket.on('status', handleStatus);
    socket.on('server_stats', handleServerStats);

    // Request server stats periodically
    const interval = setInterval(() => {
      socket.emit('get_server_stats');
    }, 5000);

    return () => {
      socket.off('status', handleStatus);
      socket.off('server_stats', handleServerStats);
      clearInterval(interval);
    };
  }, [socket]);

  if (queuePosition) {
    return (
      <Alert variant="warning" className="mb-3">
        <div className="d-flex align-items-center">
          <div className="spinner-border spinner-border-sm me-2" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <div>
            <strong>Initializing WhatsApp Connection</strong>
            <div className="small">
              Your connection is being set up. This may take a few moments...
              {queuePosition !== 'pending' && ` (Position in queue: ${queuePosition})`}
            </div>
          </div>
        </div>
      </Alert>
    );
  }

  if (activeUsers > 1) {
    return (
      <Alert variant="info" className="mb-3 d-flex justify-content-between align-items-center">
        <div>
          <strong>Multi-User Mode Active</strong>
          <div className="small">
            {activeUsers} users are currently connected. Each has their own WhatsApp instance.
          </div>
        </div>
        <Badge bg="primary" pill>{activeUsers} Active</Badge>
      </Alert>
    );
  }

  return null;
}

export default MultiUserStatus;