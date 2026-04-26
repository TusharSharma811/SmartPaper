import { useState, useCallback } from 'react'
import Navbar from '../components/Navbar'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'

export default function QuestionBankPage() {
  const { api } = useAuth()
  const toast = useToast()
  const [activeTab, setActiveTab] = useState('add') // 'add' | 'bulk'


  // Add State
  const [addForm, setAddForm] = useState({ text: '', subject: '', marks: 5, difficulty: 'medium', topic: '' })
  const [isAdding, setIsAdding] = useState(false)
  const [addedCount, setAddedCount] = useState(0) // track how many the user has contributed this session

  // Bulk Add State
  const [bulkQuestions, setBulkQuestions] = useState('')
  const [bulkSubject, setBulkSubject] = useState('')
  const [bulkDifficulty, setBulkDifficulty] = useState('medium')
  const [bulkMarks, setBulkMarks] = useState(5)
  const [isBulkAdding, setIsBulkAdding] = useState(false)


  // ── Single Add Handler ────────────────────────────────────────
  const handleAddQuestion = useCallback(async (e) => {
    e.preventDefault()

    if (!addForm.text.trim()) {
      toast.warning('Please enter the question text.')
      return
    }
    if (!addForm.subject.trim()) {
      toast.warning('Please enter a subject for this question.')
      return
    }

    setIsAdding(true)

    try {
      const { data } = await api.post('/questions/add', {
        questions: [addForm]
      })

      if (data.success) {
        toast.success('Question contributed to the bank! 🎉')
        setAddedCount(prev => prev + 1)
        setAddForm({ ...addForm, text: '', topic: '' }) // Keep subject/marks/diff for faster entry
      } else {
        throw new Error(data.error || 'Failed to add question')
      }
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Failed to add question.')
    } finally {
      setIsAdding(false)
    }
  }, [addForm, api, toast])

  // ── Bulk Add Handler ──────────────────────────────────────────
  const handleBulkAdd = useCallback(async (e) => {
    e.preventDefault()

    if (!bulkSubject.trim()) {
      toast.warning('Please enter a subject for the questions.')
      return
    }

    // Parse: one question per line
    const lines = bulkQuestions
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)

    if (lines.length === 0) {
      toast.warning('Please enter at least one question (one per line).')
      return
    }

    setIsBulkAdding(true)

    try {
      const questions = lines.map(text => ({
        text,
        subject: bulkSubject,
        difficulty: bulkDifficulty,
        marks: bulkMarks,
      }))

      const { data } = await api.post('/questions/add', { questions })

      if (data.success) {
        toast.success(`${lines.length} questions contributed to the bank! 🎉`)
        setAddedCount(prev => prev + lines.length)
        setBulkQuestions('')
      } else {
        throw new Error(data.error || 'Failed to add questions')
      }
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Bulk add failed.')
    } finally {
      setIsBulkAdding(false)
    }
  }, [bulkQuestions, bulkSubject, bulkDifficulty, bulkMarks, api, toast])

  // Count preview for bulk
  const bulkLineCount = bulkQuestions.split('\n').filter(l => l.trim().length > 0).length

  return (
    <div style={{ minHeight: '100vh' }} className="bg-grid">
      <Navbar />

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 24px' }}>
        {/* Page Header */}
        <div className="animate-fade-in" style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '8px', letterSpacing: '-0.03em' }}>
            <span className="gradient-text">📚 Question Bank</span>
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', maxWidth: '500px', margin: '0 auto', lineHeight: 1.6 }}>
            Contribute questions to improve generated paper quality — every question helps the system learn
          </p>
        </div>

        {/* Contribution Stats Badge */}
        {addedCount > 0 && (
          <div className="animate-slide-up" style={{
            textAlign: 'center',
            marginBottom: '24px',
          }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 20px',
              borderRadius: '24px',
              background: 'var(--success-bg)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: 'var(--success)',
            }}>
              🏆 You've contributed {addedCount} question{addedCount !== 1 ? 's' : ''} this session
            </span>
          </div>
        )}

        {/* Tabs */}
        <div className="animate-slide-up" style={{
          display: 'flex',
          backgroundColor: 'var(--bg-card)',
          padding: '4px',
          borderRadius: '14px',
          marginBottom: '24px',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
        }}>
          {[
            { id: 'add', label: '✏️ Add Single', color: 'var(--success)' },
            { id: 'bulk', label: '📋 Bulk Add', color: '#8b5cf6' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: '11px 0',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: activeTab === tab.id ? tab.color : 'transparent',
                color: activeTab === tab.id ? 'white' : 'var(--text-secondary)',
                fontWeight: 600,
                fontSize: '0.88rem',
                cursor: 'pointer',
                transition: 'all 0.25s ease',
                fontFamily: 'inherit',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main Content Card */}
        <div className="glass-card animate-slide-up" style={{ padding: '32px', minHeight: '400px' }}>


          {/* ── ADD SINGLE TAB ──────────────────────────────────── */}
          {activeTab === 'add' && (
            <div>
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '4px', color: 'var(--text-primary)' }}>
                  ✏️ Contribute a Question
                </h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Add a question to the shared bank — it helps generate better papers for everyone
                </p>
              </div>

              <form onSubmit={handleAddQuestion} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div>
                  <label className="form-label">Question Text <span style={{ color: 'var(--error)' }}>*</span></label>
                  <textarea
                    className="input-field"
                    rows="4"
                    placeholder="e.g., Explain the difference between process and thread with examples."
                    value={addForm.text}
                    onChange={(e) => setAddForm({ ...addForm, text: e.target.value })}
                    required
                    disabled={isAdding}
                    style={{ resize: 'vertical', minHeight: '100px' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label className="form-label">Subject <span style={{ color: 'var(--error)' }}>*</span></label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g., Operating Systems"
                      value={addForm.subject}
                      onChange={(e) => setAddForm({ ...addForm, subject: e.target.value })}
                      required
                      disabled={isAdding}
                    />
                  </div>
                  <div>
                    <label className="form-label">Topic <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g., Concurrency"
                      value={addForm.topic}
                      onChange={(e) => setAddForm({ ...addForm, topic: e.target.value })}
                      disabled={isAdding}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label className="form-label">Difficulty</label>
                    <select
                      className="input-field"
                      value={addForm.difficulty}
                      onChange={(e) => setAddForm({ ...addForm, difficulty: e.target.value })}
                      disabled={isAdding}
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Marks</label>
                    <input
                      type="number"
                      className="input-field"
                      min="1"
                      max="100"
                      value={addForm.marks}
                      onChange={(e) => setAddForm({ ...addForm, marks: Number(e.target.value) })}
                      disabled={isAdding}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn-primary"
                  style={{
                    marginTop: '8px',
                    padding: '14px',
                    fontSize: '0.95rem',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                  }}
                  disabled={isAdding}
                >
                  {isAdding ? (
                    <><div className="spinner"></div> Saving...</>
                  ) : (
                    '✅ Contribute Question'
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ── BULK ADD TAB ────────────────────────────────────── */}
          {activeTab === 'bulk' && (
            <div>
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '4px', color: 'var(--text-primary)' }}>
                  📋 Bulk Contribute Questions
                </h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Paste multiple questions — one per line — to add them all at once
                </p>
              </div>

              <form onSubmit={handleBulkAdd} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                {/* Shared metadata */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                  <div>
                    <label className="form-label">Subject <span style={{ color: 'var(--error)' }}>*</span></label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g., Data Structures"
                      value={bulkSubject}
                      onChange={(e) => setBulkSubject(e.target.value)}
                      required
                      disabled={isBulkAdding}
                    />
                  </div>
                  <div>
                    <label className="form-label">Difficulty</label>
                    <select
                      className="input-field"
                      value={bulkDifficulty}
                      onChange={(e) => setBulkDifficulty(e.target.value)}
                      disabled={isBulkAdding}
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Marks Each</label>
                    <input
                      type="number"
                      className="input-field"
                      min="1"
                      max="100"
                      value={bulkMarks}
                      onChange={(e) => setBulkMarks(Number(e.target.value))}
                      disabled={isBulkAdding}
                    />
                  </div>
                </div>

                {/* Bulk textarea */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label className="form-label" style={{ margin: 0 }}>Questions <span style={{ color: 'var(--error)' }}>*</span></label>
                    {bulkLineCount > 0 && (
                      <span style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: 'var(--accent)',
                        background: 'rgba(99, 102, 241, 0.08)',
                        padding: '2px 10px',
                        borderRadius: '10px',
                      }}>
                        {bulkLineCount} question{bulkLineCount !== 1 ? 's' : ''} detected
                      </span>
                    )}
                  </div>
                  <textarea
                    className="input-field"
                    rows="10"
                    placeholder={"Paste one question per line, e.g.:\n\nDefine a binary search tree and list its properties.\nExplain the working of Dijkstra's algorithm with an example.\nCompare BFS and DFS traversal techniques.\nWhat is the time complexity of quicksort in the worst case?"}
                    value={bulkQuestions}
                    onChange={(e) => setBulkQuestions(e.target.value)}
                    required
                    disabled={isBulkAdding}
                    style={{ resize: 'vertical', minHeight: '180px', lineHeight: 1.8, fontFamily: 'inherit' }}
                  />
                </div>

                {/* Info hint */}
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '14px 16px',
                  borderRadius: '10px',
                  background: 'rgba(99, 102, 241, 0.04)',
                  border: '1px solid rgba(99, 102, 241, 0.1)',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                }}>
                  <span style={{ fontSize: '1rem' }}>💡</span>
                  <div>
                    <strong>Tip:</strong> Each line becomes one question in the bank. Empty lines are ignored.
                    All questions will share the subject, difficulty, and marks you set above.
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn-primary"
                  style={{
                    padding: '14px',
                    fontSize: '0.95rem',
                    background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                  }}
                  disabled={isBulkAdding || bulkLineCount === 0}
                >
                  {isBulkAdding ? (
                    <><div className="spinner"></div> Adding {bulkLineCount} questions...</>
                  ) : (
                    `📤 Contribute ${bulkLineCount || 0} Question${bulkLineCount !== 1 ? 's' : ''}`
                  )}
                </button>
              </form>
            </div>
          )}

        </div>

        {/* How it works section */}
        <div className="animate-slide-up" style={{ marginTop: '32px' }}>
          <div className="glass-card" style={{ padding: '28px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
              💡 How the Question Bank works
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              {[
                {
                  icon: '📝',
                  title: 'Contribute',
                  desc: 'Add questions from past exams, textbooks, or your own. One at a time or in bulk.',
                },
                {
                  icon: '🧠',
                  title: 'System Learns',
                  desc: 'Questions are embedded and stored in a knowledge base for intelligent search.',
                },
                {
                  icon: '📄',
                  title: 'Better Papers',
                  desc: 'When generating papers, similar questions from the bank are used for style & topic inspiration.',
                },
              ].map((item, idx) => (
                <div key={idx} style={{
                  padding: '16px',
                  borderRadius: '12px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>{item.icon}</div>
                  <p style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '4px' }}>{item.title}</p>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
