import { useState, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'

// Password strength checker
function getPasswordStrength(password) {
  if (!password) return { level: 0, label: '', color: '' }
  let score = 0
  if (password.length >= 6) score++
  if (password.length >= 10) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  if (score <= 1) return { level: 1, label: 'Weak', color: '#ef4444' }
  if (score <= 2) return { level: 2, label: 'Fair', color: '#f59e0b' }
  if (score <= 3) return { level: 3, label: 'Good', color: '#3b82f6' }
  return { level: 4, label: 'Strong', color: '#10b981' }
}

export default function RegistrationForm() {
  const navigate = useNavigate()
  const { register } = useAuth()
  const toast = useToast()

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)

  // Single handler — avoids recreating callbacks per field
  const handleChange = useCallback((e) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }, [])

  // Computed validation states (derived, no extra re-renders)
  const passwordStrength = useMemo(
    () => getPasswordStrength(form.password),
    [form.password]
  )

  const passwordsMatch = form.confirmPassword.length === 0 || form.password === form.confirmPassword
  const confirmTouched = form.confirmPassword.length > 0

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()

    // Client-side validations — show specific toasts
    if (!form.name.trim()) {
      toast.warning('Please enter your name.')
      return
    }

    if (!form.email.trim()) {
      toast.warning('Please enter your email address.')
      return
    }

    if (form.password.length < 6) {
      toast.warning('Password must be at least 6 characters.')
      return
    }

    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      await register(form.name, form.email, form.password)
      toast.success('Account created! Welcome to SmartPaper 🎉')
      setTimeout(() => navigate('/'), 400)
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Registration failed'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [form, register, navigate, toast])

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
            🎓
          </div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: '6px', letterSpacing: '-0.02em' }}>
            Create Account
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Join <span style={{ color: 'var(--accent)', fontWeight: 600 }}>SmartPaper</span> to start generating exam papers
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          <div style={{ marginBottom: '16px' }}>
            <label className="form-label" htmlFor="reg-name">Full Name</label>
            <input
              id="reg-name"
              name="name"
              type="text"
              className="input-field"
              value={form.name}
              onChange={handleChange}
              placeholder="John Doe"
              required
              disabled={loading}
              autoComplete="name"
              autoFocus
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label className="form-label" htmlFor="reg-email">Email Address</label>
            <input
              id="reg-email"
              name="email"
              type="email"
              className="input-field"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com"
              required
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label className="form-label" htmlFor="reg-password">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="reg-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                className="input-field"
                value={form.password}
                onChange={handleChange}
                placeholder="Min. 6 characters"
                required
                minLength={6}
                disabled={loading}
                autoComplete="new-password"
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

          {/* Password Strength Indicator */}
          {form.password.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                display: 'flex',
                gap: '4px',
                marginBottom: '4px',
              }}>
                {[1, 2, 3, 4].map(i => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      height: '3px',
                      borderRadius: '2px',
                      background: i <= passwordStrength.level
                        ? passwordStrength.color
                        : 'var(--border)',
                      transition: 'background 0.3s ease',
                    }}
                  />
                ))}
              </div>
              <p style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                color: passwordStrength.color,
                textAlign: 'right',
                transition: 'color 0.3s ease',
              }}>
                {passwordStrength.label}
              </p>
            </div>
          )}

          <div style={{ marginBottom: '24px' }}>
            <label className="form-label" htmlFor="reg-confirm">Confirm Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="reg-confirm"
                name="confirmPassword"
                type={showConfirm ? 'text' : 'password'}
                className="input-field"
                value={form.confirmPassword}
                onChange={handleChange}
                placeholder="••••••••"
                required
                disabled={loading}
                autoComplete="new-password"
                style={{
                  paddingRight: '48px',
                  borderColor: confirmTouched
                    ? (passwordsMatch ? 'var(--success)' : 'var(--error)')
                    : undefined,
                }}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
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
                {showConfirm ? '🙈' : '👁️'}
              </button>
            </div>
            {/* Real-time mismatch hint */}
            {confirmTouched && !passwordsMatch && (
              <p style={{
                fontSize: '0.75rem',
                color: 'var(--error)',
                marginTop: '6px',
                fontWeight: 500,
              }}>
                ✕ Passwords do not match
              </p>
            )}
            {confirmTouched && passwordsMatch && form.password.length >= 6 && (
              <p style={{
                fontSize: '0.75rem',
                color: 'var(--success)',
                marginTop: '6px',
                fontWeight: 500,
              }}>
                ✓ Passwords match
              </p>
            )}
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
                Creating account...
              </>
            ) : (
              '🚀 Create Account'
            )}
          </button>
        </form>

        <div className="divider"></div>

        <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
            Sign in →
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
        Smart Question Paper Generator
      </p>
    </div>
  )
}
