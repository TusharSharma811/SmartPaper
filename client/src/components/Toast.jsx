import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react'

// ── Toast Context ─────────────────────────────────────────────
const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const toastsRef = useRef([])

  // Keep ref in sync for dedup checks without causing re-renders
  toastsRef.current = toasts

  const addToast = useCallback((message, type = 'error', duration = 4500) => {
    // Deduplicate: if the same message+type is already showing, don't add again
    const isDuplicate = toastsRef.current.some(
      t => t.message === message && t.type === type
    )
    if (isDuplicate) return

    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type, duration }])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = {
    error: (msg, duration) => addToast(msg, 'error', duration),
    success: (msg, duration) => addToast(msg, 'success', duration),
    warning: (msg, duration) => addToast(msg, 'warning', duration),
    info: (msg, duration) => addToast(msg, 'info', duration),
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

// ── Toast Container ────────────────────────────────────────────
function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
      ))}
    </div>
  )
}

// ── Single Toast Item ──────────────────────────────────────────
function ToastItem({ toast, onDismiss }) {
  const [exiting, setExiting] = useState(false)
  const [progress, setProgress] = useState(100)
  const duration = toast.duration || 4500

  // Auto-dismiss timer
  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true)
    }, duration)

    return () => clearTimeout(timer)
  }, [duration])

  // Progress bar animation
  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - start
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)
      if (remaining <= 0) clearInterval(interval)
    }, 50)

    return () => clearInterval(interval)
  }, [duration])

  // Exit animation then remove
  useEffect(() => {
    if (exiting) {
      const exitTimer = setTimeout(onDismiss, 350)
      return () => clearTimeout(exitTimer)
    }
  }, [exiting, onDismiss])

  const icons = {
    error: '✕',
    success: '✓',
    warning: '⚠',
    info: 'ℹ',
  }

  const progressColors = {
    error: '#ef4444',
    success: '#10b981',
    warning: '#f59e0b',
    info: '#6366f1',
  }

  return (
    <div
      className={`toast toast-${toast.type} ${exiting ? 'toast-exit' : 'toast-enter'}`}
      role="alert"
    >
      <div className={`toast-icon toast-icon-${toast.type}`}>
        {icons[toast.type] || icons.info}
      </div>
      <p className="toast-message">{toast.message}</p>
      <button
        className="toast-close"
        onClick={() => setExiting(true)}
        aria-label="Dismiss"
      >
        ✕
      </button>
      {/* Progress bar */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        height: '2px',
        width: `${progress}%`,
        background: progressColors[toast.type] || progressColors.info,
        borderRadius: '0 0 12px 12px',
        transition: 'width 50ms linear',
        opacity: 0.5,
      }} />
    </div>
  )
}

export default ToastProvider
