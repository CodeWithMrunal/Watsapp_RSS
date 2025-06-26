import React, { useState, useEffect } from 'react';
import { Card, ProgressBar, Alert, Button } from 'react-bootstrap';

function WhatsAppLoadingProgress({ socket, onFullyLoaded }) {
  const [loadingState, setLoadingState] = useState({
    groupsLoaded: 0,
    totalGroups: 0,
    isFullyLoaded: false,
    state: 'initializing',
    estimatedTimeRemaining: null
  });
  const [showDetails, setShowDetails] = useState(true);

  useEffect(() => {
    if (!socket) return;

    const handleLoadingProgress = (data) => {
      setLoadingState(data);
      
      if (data.isFullyLoaded && onFullyLoaded) {
        onFullyLoaded();
      }
    };

    const handleFullyLoaded = (data) => {
      setLoadingState(prev => ({
        ...prev,
        isFullyLoaded: true,
        state: 'ready',
        groupsLoaded: data.groupsAvailable
      }));
      
      if (onFullyLoaded) {
        onFullyLoaded();
      }
    };

    socket.on('loading_progress', handleLoadingProgress);
    socket.on('whatsapp_fully_loaded', handleFullyLoaded);

    return () => {
      socket.off('loading_progress', handleLoadingProgress);
      socket.off('whatsapp_fully_loaded', handleFullyLoaded);
    };
  }, [socket, onFullyLoaded]);

  if (loadingState.isFullyLoaded && !showDetails) {
    return null;
  }

  const progress = loadingState.totalGroups > 0 
    ? (loadingState.groupsLoaded / loadingState.totalGroups) * 100 
    : 0;

  const formatTime = (seconds) => {
    if (!seconds) return '';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h6 className="mb-0">
            <i className="fab fa-whatsapp text-success me-2"></i>
            WhatsApp Loading Progress
          </h6>
          {loadingState.isFullyLoaded && (
            <Button
              variant="link"
              size="sm"
              onClick={() => setShowDetails(false)}
              className="p-0"
            >
              <i className="fas fa-times"></i>
            </Button>
          )}
        </div>

        {!loadingState.isFullyLoaded ? (
          <>
            <Alert variant="info" className="small py-2 px-3">
              <i className="fas fa-info-circle me-2"></i>
              WhatsApp is loading your chats. This typically takes 3-5 minutes for large accounts.
            </Alert>

            <div className="mb-3">
              <div className="d-flex justify-content-between mb-1">
                <small className="text-muted">
                  Groups loaded: {loadingState.groupsLoaded}
                  {loadingState.totalGroups > 0 && ` / ${loadingState.totalGroups}`}
                </small>
                {loadingState.estimatedTimeRemaining && (
                  <small className="text-muted">
                    Est. time: {formatTime(loadingState.estimatedTimeRemaining)}
                  </small>
                )}
              </div>
              <ProgressBar 
                now={progress} 
                animated 
                striped 
                variant={loadingState.state === 'loading' ? 'primary' : 'success'}
              />
            </div>

            <div className="text-center">
              <small className="text-muted">
                {loadingState.state === 'loading' && (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </span>
                    Loading your WhatsApp groups...
                  </>
                )}
                {loadingState.state === 'initializing' && 'Initializing WhatsApp...'}
              </small>
            </div>
          </>
        ) : (
          <Alert variant="success" className="mb-0 py-2">
            <i className="fas fa-check-circle me-2"></i>
            WhatsApp fully loaded! {loadingState.groupsLoaded} groups available.
          </Alert>
        )}
      </Card.Body>
    </Card>
  );
}

export default WhatsAppLoadingProgress;