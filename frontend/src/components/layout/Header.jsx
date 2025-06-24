// src/components/layout/Header.jsx
import React from 'react';
import { Navbar, Nav, Container, Dropdown, Badge } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWhatsApp } from '../../contexts/WhatsAppContext';

function Header({ onToggleSidebar }) {
  const { user, logout } = useAuth();
  const { isWhatsAppAuthenticated, selectedGroup } = useWhatsApp();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <Navbar bg="dark" variant="dark" expand="lg" sticky="top">
      <Container fluid>
        <button
          className="btn btn-link text-white d-lg-none"
          onClick={onToggleSidebar}
        >
          <i className="fas fa-bars"></i>
        </button>

        <Navbar.Brand as={Link} to="/" className="ms-2">
          <i className="fab fa-whatsapp text-success me-2"></i>
          WhatsApp Monitor
        </Navbar.Brand>

        <Nav className="me-auto">
          <Nav.Link as={Link} to="/">
            <i className="fas fa-tachometer-alt me-1"></i>
            Dashboard
          </Nav.Link>
          <Nav.Link as={Link} to="/monitor">
            <i className="fas fa-desktop me-1"></i>
            Monitor
            {isWhatsAppAuthenticated && (
              <Badge bg="success" className="ms-2">Connected</Badge>
            )}
          </Nav.Link>
          <Nav.Link as={Link} to="/settings">
            <i className="fas fa-cog me-1"></i>
            Settings
          </Nav.Link>
        </Nav>

        <Nav>
          {selectedGroup && (
            <div className="text-white me-3 d-flex align-items-center">
              <small>
                <i className="fas fa-users me-1"></i>
                {selectedGroup.name}
              </small>
            </div>
          )}

          <Dropdown align="end">
            <Dropdown.Toggle variant="link" className="text-white text-decoration-none">
              <i className="fas fa-user-circle me-1"></i>
              {user?.username}
            </Dropdown.Toggle>

            <Dropdown.Menu>
              <Dropdown.Item as={Link} to="/profile">
                <i className="fas fa-user me-2"></i>
                Profile
              </Dropdown.Item>
              <Dropdown.Item as={Link} to="/settings">
                <i className="fas fa-cog me-2"></i>
                Settings
              </Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item onClick={handleLogout}>
                <i className="fas fa-sign-out-alt me-2"></i>
                Logout
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </Nav>
      </Container>
    </Navbar>
  );
}

export default Header;