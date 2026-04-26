import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <nav style={{
      background: 'rgba(255, 255, 255, 0.95)',
      backdropFilter: 'blur(20px)',
      borderBottom: '1px solid var(--border)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      <div style={{
        maxWidth: '1280px',
        margin: '0 auto',
        padding: '0 24px',
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, var(--gradient-start), var(--gradient-end))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
          }}>
            📝
          </div>
          <div>
            <h1 style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              letterSpacing: '-0.03em',
            }}>
              <span className="gradient-text">SmartPaper</span>
            </h1>
          </div>
        </div>

        {/* Navigation Links */}
        {user && (
          <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
            <button 
              onClick={() => navigate('/')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-primary)',
                fontWeight: 500,
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              Dashboard
            </button>
            <button 
              onClick={() => navigate('/analysis')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                fontWeight: 500,
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              Analysis Tools
            </button>
            <button 
              onClick={() => navigate('/question-bank')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                fontWeight: 500,
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              Question Bank
            </button>
          </div>
        )}

        {/* User Info */}
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                {user.name}
              </p>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {user.email}
              </p>
            </div>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: 'var(--accent)',
            }}>
              {user.name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <button
              onClick={handleLogout}
              className="btn-secondary"
              style={{ padding: '8px 16px', fontSize: '0.8rem' }}
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
