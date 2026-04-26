import { useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'

export default function LoginForm() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const toast = useToast()

  const [form, setForm] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  // Single handler — avoids recreating callbacks per field
  const handleChange = useCallback((e) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }, [])

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()

    // Client-side validation
    if (!form.email.trim()) {
      toast.warning('Please enter your email address.')
      return
    }
    if (!form.password) {
      toast.warning('Please enter your password.')
      return
    }

    setLoading(true)

    try {
      await login(form.email, form.password)
      toast.success('Welcome back! Redirecting...')
      // Small delay so the toast is visible before navigating
      setTimeout(() => navigate('/'), 400)
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Login failed'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [form, login, navigate, toast])

  return (
    <div className="animate-fade-in" style={{ width: '100%', maxWidth: '440px' }}>
      <div className="glass-card" style={{ padding: '44px 40px 36px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '60px',
            height: '60px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, var(--gradient-start), var(--gradient-end))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '26px',
            margin: '0 auto 16px',
            boxShadow: '0 8px 24px var(--accent-glow)',
          }}>
            📝
          </div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: '6px', letterSpacing: '-0.02em' }}>
            Welcome back
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Sign in to continue to <span style={{ color: 'var(--accent)', fontWeight: 600 }}>SmartPaper</span>
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          <div style={{ marginBottom: '20px' }}>
            <label className="form-label" htmlFor="login-email">Email Address</label>
            <input
              id="login-email"
              name="email"
              type="email"
              className="input-field"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com"
              required
              disabled={loading}
              autoComplete="email"
              autoFocus
            />
          </div>

          <div style={{ marginBottom: '28px' }}>
            <label className="form-label" htmlFor="login-password">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                className="input-field"
                value={form.password}
                onChange={handleChange}
                placeholder="••••••••"
                required
                minLength={6}
                disabled={loading}
                autoComplete="current-password"
                style={{ paddingRight: '48px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontSize: '1.1rem',
                  padding: '4px',
                  lineHeight: 1,
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                tabIndex={-1}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary"
            style={{
              width: '100%',
              padding: '14px',
              fontSize: '0.95rem',
              ...(loading ? {} : { animation: 'pulse-glow 3s infinite' }),
            }}
            disabled={loading}
          >
            {loading ? (
              <>
                <div className="spinner"></div>
                Signing in...
              </>
            ) : (
              '🚀 Sign In'
            )}
          </button>
        </form>

        <div className="divider"></div>

        <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
            Create one →
          </Link>
        </p>
      </div>

      {/* Footer tagline */}
      <p style={{
        textAlign: 'center',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        marginTop: '20px',
        opacity: 0.7,
      }}>
        AI-Powered Question Paper Generator
      </p>
    </div>
  )
}
