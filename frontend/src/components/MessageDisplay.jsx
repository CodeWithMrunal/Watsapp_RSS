import React, { useState } from 'react';
import { Card, Button, Badge, Form, Alert, ListGroup, Collapse } from 'react-bootstrap';
import moment from 'moment';

function MessageDisplay({ messages, showGrouped, onToggleGrouping, selectedUser, selectedGroup, onGoBackToUserFilter }) {
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [previewMedia, setPreviewMedia] = useState(null);

  const handleMediaClick = (msg) => {
    console.log('Media clicked:', msg);
    if (msg.mediaPath) {
      const mediaUrl = msg.mediaPath.startsWith('http') 
        ? msg.mediaPath 
        : `http://localhost:3001/${msg.mediaPath.replace(/\\/g, '/')}`;
      setPreviewMedia({ ...msg, src: mediaUrl });
    } else if (msg.mediaMetadata?.path) {
      const mediaUrl = msg.mediaMetadata.path.startsWith('http')
        ? msg.mediaMetadata.path
        : `http://localhost:3001/${msg.mediaMetadata.path.replace(/\\/g, '/')}`;
      setPreviewMedia({
        ...msg,
        src: mediaUrl,
        mediaPath: msg.mediaMetadata.path,
        type: msg.type
      });
    } else {
      console.log("No media path found in message:", msg);
    }
  };

  const closePreview = () => setPreviewMedia(null);

  const toggleGroupExpansion = (groupId) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    setExpandedGroups(newExpanded);
  };

  const formatTimestamp = (timestamp) => {
    return moment(timestamp * 1000).format('MMM DD, YYYY HH:mm');
  };

  const getMessageTypeIcon = (type, hasMedia) => {
    if (hasMedia) {
      switch (type) {
        case 'image':
          return <i className="fas fa-image text-success"></i>;
        case 'video':
          return <i className="fas fa-video text-info"></i>;
        case 'audio':
        case 'ptt':
          return <i className="fas fa-microphone text-warning"></i>;
        case 'document':
          return <i className="fas fa-file text-secondary"></i>;
        default:
          return <i className="fas fa-paperclip text-muted"></i>;
      }
    }
    return <i className="fas fa-comment text-primary"></i>;
  };

  const getUserDisplayName = (author) => {
    if (!author) return 'Unknown';
    // Extract phone number from author ID and format it
    const phoneNumber = author.replace('@c.us', '');
    return phoneNumber.includes('+') ? phoneNumber : `+${phoneNumber}`;
  };

  const getMediaUrl = (message) => {
    if (message.mediaPath) {
      return message.mediaPath.startsWith('http') 
        ? message.mediaPath 
        : `http://localhost:3001/${message.mediaPath.replace(/\\/g, '/')}`;
    } else if (message.mediaMetadata?.path) {
      return message.mediaMetadata.path.startsWith('http')
        ? message.mediaMetadata.path
        : `http://localhost:3001/${message.mediaMetadata.path.replace(/\\/g, '/')}`;
    }
    return null;
  };

  const renderMessageGroup = (group) => {
    const isExpanded = expandedGroups.has(group.id);
    const hasMultipleMessages = group.messages && group.messages.length > 1;

    return (
      <Card key={group.id} className="message-group-card mb-3">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div className="d-flex align-items-center">
            <div className="user-avatar me-3">
              <div className="avatar-circle bg-primary text-white">
                {getUserDisplayName(group.author).charAt(0)}
              </div>
            </div>
            <div>
              <h6 className="mb-0">{getUserDisplayName(group.author)}</h6>
              <small className="text-muted">
                {formatTimestamp(group.timestamp)}
              </small>
            </div>
          </div>
          <div className="d-flex align-items-center">
            {hasMultipleMessages && (
              <Badge bg="info" className="me-2">
                {group.messages.length} messages
              </Badge>
            )}
            {hasMultipleMessages && (
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => toggleGroupExpansion(group.id)}
              >
                {isExpanded ? (
                  <i className="fas fa-chevron-up"></i>
                ) : (
                  <i className="fas fa-chevron-down"></i>
                )}
              </Button>
            )}
          </div>
        </Card.Header>
        <Card.Body>
          {!hasMultipleMessages ? (
            // Single message display
            <div className="single-message">
              <div className="d-flex align-items-start">
                <div className="me-2">
                  {getMessageTypeIcon(group.messages[0].type, group.messages[0].hasMedia)}
                </div>
                <div className="message-content">
                  {group.messages[0].body ? (
                    <p className="mb-0">{group.messages[0].body}</p>
                  ) : group.messages[0].hasMedia ? (
                    <>
                      <span
                        className="text-primary clickable"
                        onClick={() => handleMediaClick(group.messages[0])}
                        style={{ cursor: 'pointer' }}
                      >
                        [Click to view {group.messages[0].type}]
                      </span>
                      {group.messages[0].type === 'image' && getMediaUrl(group.messages[0]) && (
                        <img
                          src={getMediaUrl(group.messages[0])}
                          alt="media"
                          className="thumbnail mt-1"
                          onClick={() => handleMediaClick(group.messages[0])}
                          style={{ maxWidth: '200px', cursor: 'pointer', borderRadius: '4px' }}
                        />
                      )}
                    </>
                  ) : (
                    <p className="mb-0 text-muted font-italic">
                      [Media: {group.messages[0].type}]
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            // Multiple messages display
            <div>
              {/* Show first message */}
              <div className="d-flex align-items-start mb-2">
                <div className="me-2">
                  {getMessageTypeIcon(group.messages[0].type, group.messages[0].hasMedia)}
                </div>
                <div className="message-content">
                  {group.messages[0].body ? (
                    <p className="mb-0">{group.messages[0].body}</p>
                  ) : (
                    <p className="mb-0 text-muted font-italic">
                      [Media: {group.messages[0].type}]
                    </p>
                  )}
                </div>
              </div>

              {/* Collapsible additional messages */}
              <Collapse in={isExpanded}>
                <div>
                  {group.messages.slice(1).map((message, index) => (
                    <div key={index} className="d-flex align-items-start mb-2 additional-message">
                      <div className="me-2">
                        {getMessageTypeIcon(message.type, message.hasMedia)}
                      </div>
                      <div className="message-content">
                        <small className="text-muted d-block">
                          {formatTimestamp(message.timestamp)}
                        </small>
                        {message.body ? (
                          <p className="mb-0">{message.body}</p>
                        ) : message.hasMedia ? (
                          <>
                            <span
                              className="text-primary clickable"
                              onClick={() => handleMediaClick(message)}
                              style={{ cursor: 'pointer' }}
                            >
                              [Click to view {message.type}]
                            </span>
                            {message.type === 'image' && getMediaUrl(message) && (
                              <img
                                src={getMediaUrl(message)}
                                alt="media"
                                className="thumbnail mt-1"
                                onClick={() => handleMediaClick(message)}
                                style={{ maxWidth: '200px', cursor: 'pointer', borderRadius: '4px' }}
                              />
                            )}
                            {message.type === 'video' && getMediaUrl(message) && (
                              <video
                                src={getMediaUrl(message)}
                                className="thumbnail mt-1"
                                onClick={() => handleMediaClick(message)}
                                style={{ maxWidth: '200px', cursor: 'pointer', borderRadius: '4px' }}
                                muted
                              />
                            )}
                          </>
                        ) : (
                          <p className="mb-0 text-muted font-italic">
                            [Media: {message.type}]
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Collapse>
            </div>
          )}
        </Card.Body>
      </Card>
    );
  };

  const renderIndividualMessages = () => {
    const allMessages = messages.flatMap(group =>
      group.messages ? group.messages : [group]
    );

    return allMessages.map((message, index) => (
      <Card key={`${message.id}-${index}`} className="message-card mb-2">
        <Card.Body className="py-2">
          <div className="d-flex align-items-start">
            <div className="user-avatar me-3">
              <div className="avatar-circle-sm bg-secondary text-white">
                {getUserDisplayName(message.author).charAt(0)}
              </div>
            </div>
            <div className="flex-grow-1">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <h6 className="mb-0 text-primary">
                  {getUserDisplayName(message.author)}
                </h6>
                <small className="text-muted">
                  {formatTimestamp(message.timestamp)}
                </small>
              </div>
              <div className="d-flex align-items-start">
                <div className="me-2">
                  {getMessageTypeIcon(message.type, message.hasMedia)}
                </div>
                <div className="message-content">
                  {message.body ? (
                    <p className="mb-0">{message.body}</p>
                  ) : message.hasMedia ? (
                    <>
                      <span
                        className="text-primary clickable"
                        onClick={() => handleMediaClick(message)}
                        style={{ cursor: 'pointer' }}
                      >
                        [Click to view {message.type}]
                      </span>
                      {message.type === 'image' && getMediaUrl(message) && (
                        <img
                          src={getMediaUrl(message)}
                          alt="media"
                          className="thumbnail mt-1"
                          onClick={() => handleMediaClick(message)}
                          style={{ maxWidth: '200px', cursor: 'pointer', borderRadius: '4px' }}
                        />
                      )}
                      {message.type === 'video' && getMediaUrl(message) && (
                        <video
                          src={getMediaUrl(message)}
                          className="thumbnail mt-1"
                          onClick={() => handleMediaClick(message)}
                          style={{ maxWidth: '200px', cursor: 'pointer', borderRadius: '4px' }}
                          muted
                        />
                      )}
                    </>
                  ) : (
                    <p className="mb-0 text-muted font-italic">
                      [Media: {message.type}]
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card.Body>
      </Card>
    ));
  };

  return (
    <Card className="message-display-card">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <div>
          <h5 className="mb-0">
            <i className="fas fa-comments me-2"></i>
            Messages
            {selectedUser && (
              <Badge bg="info" className="ms-2">
                Filtered
              </Badge>
            )}
          </h5>
          {selectedGroup && (
            <small className="text-muted d-block">
              Group: {selectedGroup.name}
              {selectedUser && ` | User: ${selectedUser}`}
            </small>
          )}
        </div>
        <div className="d-flex align-items-center">
          {selectedUser && (
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={onGoBackToUserFilter}
              className="me-2"
              title="Clear user filter"
            >
              <i className="fas fa-user-times me-1"></i>
              Clear Filter
            </Button>
          )}
          <Form.Check
            type="switch"
            id="group-toggle"
            label="Group Messages"
            checked={showGrouped}
            onChange={onToggleGrouping}
            className="me-3"
          />
          <Badge bg="primary" pill>
            {messages.length} {showGrouped ? 'groups' : 'messages'}
          </Badge>
        </div>
      </Card.Header>
      <Card.Body className="messages-container">
        {messages.length === 0 ? (
          <Alert variant="info" className="text-center">
            <i className="fas fa-inbox me-2"></i>
            No messages to display. Click "Fetch History" to load past messages or wait for new ones.
          </Alert>
        ) : (
          <div className="messages-list">
            {showGrouped ? (
              <div className="grouped-messages">
                {messages.map(renderMessageGroup)}
              </div>
            ) : (
              <div className="individual-messages">
                {renderIndividualMessages()}
              </div>
            )}
          </div>
        )}

        {messages.length > 0 && (
          <div className="mt-3 text-center">
            <small className="text-muted">
              <i className="fas fa-rss me-1"></i>
              RSS feed is automatically updated with new messages
            </small>
          </div>
        )}

        {previewMedia && (
          <div className="media-preview-overlay" onClick={closePreview} style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}>
            <div className="media-preview-content" onClick={(e) => e.stopPropagation()} style={{
              maxWidth: '90%',
              maxHeight: '90%',
              position: 'relative'
            }}>
              <button className="btn btn-danger mb-3" onClick={closePreview} style={{
                position: 'absolute',
                top: -40,
                right: 0,
                zIndex: 10000
              }}>
                Close
              </button>

              {previewMedia.type === 'image' && (
                <img src={previewMedia.src} alt="Preview" style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '8px' }} />
              )}

              {previewMedia.type === 'video' && previewMedia.src && (
                <video
                  src={previewMedia.src}
                  controls
                  autoPlay
                  style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '8px' }}
                />
              )}

              {previewMedia.type === 'audio' && previewMedia.src && (
                <audio
                  src={previewMedia.src}
                  controls
                  autoPlay
                  style={{ width: '100%' }}
                />
              )}

              {previewMedia.type === 'ptt' && previewMedia.src && (
                <audio
                  src={previewMedia.src}
                  controls
                  autoPlay
                  style={{ width: '100%' }}
                />
              )}

              {!['image', 'video', 'audio', 'ptt'].includes(previewMedia.type) && (
                <p className="text-white">Preview not supported for this media type.</p>
              )}
            </div>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

export default MessageDisplay;