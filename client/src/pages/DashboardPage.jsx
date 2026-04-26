import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import PaperPreviewModal from '../components/PaperPreviewModal'
import AnalysisCharts from '../components/AnalysisCharts'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { api } = useAuth()
  const toast = useToast()
  
  const [papers, setPapers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloadingId, setDownloadingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  
  // Preview Modal State
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewPaper, setPreviewPaper] = useState(null)
  const [fetchingPreviewId, setFetchingPreviewId] = useState(null)

  // Analysis Modal State
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false)
  const [analysisPaper, setAnalysisPaper] = useState(null)
  const [fetchingAnalysisId, setFetchingAnalysisId] = useState(null)

  useEffect(() => {
    const fetchPapers = async () => {
      try {
        const { data } = await api.get('/papers')
        if (data.success) {
          setPapers(data.data)
        } else {
          setError(data.error || 'Failed to fetch papers')
        }
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'Error fetching papers')
      } finally {
        setLoading(false)
      }
    }
    fetchPapers()
  }, [api])

  const handleDownloadPDF = async (paperId, subject) => {
    setDownloadingId(paperId)
    try {
      const response = await api.get(`/papers/${paperId}/pdf`, {
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `${subject.replace(/\s+/g, '_')}_Question_Paper.pdf`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      toast.error('Failed to download PDF. The file might not be available.')
    } finally {
      setDownloadingId(null)
    }
  }

  const handlePreview = async (paperId) => {
    setFetchingPreviewId(paperId)
    try {
      const { data } = await api.get(`/papers/${paperId}`)
      if (data.success) {
        setPreviewPaper(data.data)
        setPreviewModalOpen(true)
      } else {
        toast.error(data.error || 'Failed to fetch paper for preview.')
      }
    } catch (err) {
      toast.error('Error fetching paper preview.')
    } finally {
      setFetchingPreviewId(null)
    }
  }

  const handleAnalysis = async (paperId) => {
    setFetchingAnalysisId(paperId)
    try {
      const { data } = await api.get(`/papers/${paperId}`)
      if (data.success) {
        setAnalysisPaper(data.data)
        setAnalysisModalOpen(true)
      } else {
        toast.error(data.error || 'Failed to fetch paper for analysis.')
      }
    } catch (err) {
      toast.error('Error fetching paper for analysis.')
    } finally {
      setFetchingAnalysisId(null)
    }
  }

  const handleDelete = async (paperId, paperName) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${paperName}"?\n\nThis will permanently remove the paper and its PDF. This action cannot be undone.`
    )
    if (!confirmed) return

    setDeletingId(paperId)
    try {
      const { data } = await api.delete(`/papers/${paperId}`)
      if (data.success) {
        setPapers(prev => prev.filter(p => p._id !== paperId))
        toast.success('Paper deleted successfully.')
      } else {
        toast.error(data.error || 'Failed to delete paper.')
      }
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Error deleting paper.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div style={{ minHeight: '100vh' }} className="bg-grid">
      <Navbar />

      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em', marginBottom: '8px' }}>
              <span className="gradient-text">Dashboard</span>
            </h1>
            <p style={{ color: 'var(--text-muted)' }}>View your previously generated question papers</p>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              className="btn-outline"
              onClick={() => navigate('/analysis')}
              style={{ padding: '12px 20px', whiteSpace: 'nowrap', borderColor: '#8b5cf6', color: '#8b5cf6' }}
            >
              📊 Analysis Tools
            </button>
            <button 
              className="btn-primary" 
              onClick={() => navigate('/generate')}
              style={{ padding: '12px 24px', whiteSpace: 'nowrap' }}
            >
              + Generate New Paper
            </button>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: '24px' }}>
            <span>⚠️</span> {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <div className="spinner-lg" style={{ borderTopColor: 'var(--accent)' }}></div>
          </div>
        ) : papers.length === 0 ? (
          <div className="glass-card" style={{ padding: '60px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', opacity: 0.5, marginBottom: '16px' }}>📄</div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              No papers generated yet
            </h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
              Create your first question paper now
            </p>
            <button 
              className="btn-primary" 
              onClick={() => navigate('/generate')}
            >
              Generate Paper
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
            {papers.map((paper) => (
              <div key={paper._id} className="glass-card animate-slide-up" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginBottom: '16px', flexGrow: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', gap: '8px' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word', margin: 0 }}>
                      {paper.name || paper.metadata?.subject || 'Question Paper'}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <span style={{ 
                        fontSize: '0.7rem', 
                        background: 'rgba(99, 102, 241, 0.1)', 
                        color: 'var(--accent)', 
                        padding: '4px 8px', 
                        borderRadius: '12px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}>
                        {paper.difficulty}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(paper._id, paper.name || paper.metadata?.subject || 'Question Paper')
                        }}
                        disabled={deletingId === paper._id}
                        title="Delete paper"
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: deletingId === paper._id ? 'not-allowed' : 'pointer',
                          fontSize: '0.9rem',
                          opacity: deletingId === paper._id ? 0.4 : 0.5,
                          padding: '4px',
                          borderRadius: '6px',
                          transition: 'all 0.2s',
                          lineHeight: 1,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'var(--error-bg)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.background = 'none' }}
                      >
                        {deletingId === paper._id ? (
                          <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', borderColor: 'var(--error)', borderTopColor: 'transparent' }}></div>
                        ) : (
                          '🗑️'
                        )}
                      </button>
                    </div>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Subject: {paper.metadata?.subject || 'N/A'}
                  </p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Exam: {paper.metadata?.exam || 'N/A'}
                  </p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Marks: {paper.metadata?.max_marks || '?'} | pattern: {paper.pattern?.length || 0} sections
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '12px' }}>
                    {new Date(paper.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
                
                <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button 
                    className="btn-outline" 
                    style={{ flex: 1, padding: '10px 0', fontSize: '0.85rem', minWidth: '70px' }}
                    onClick={() => handlePreview(paper._id)}
                    disabled={fetchingPreviewId === paper._id}
                  >
                    {fetchingPreviewId === paper._id ? (
                      <><div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px', borderColor: 'var(--accent)', borderTopColor: 'transparent' }}></div> ...</>
                    ) : (
                      '👁️ Preview'
                    )}
                  </button>
                  <button
                    className="btn-outline"
                    style={{ flex: 1, padding: '10px 0', fontSize: '0.85rem', minWidth: '70px', borderColor: '#8b5cf6', color: '#8b5cf6' }}
                    onClick={() => handleAnalysis(paper._id)}
                    disabled={fetchingAnalysisId === paper._id}
                  >
                    {fetchingAnalysisId === paper._id ? (
                      <><div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px', borderColor: '#8b5cf6', borderTopColor: 'transparent' }}></div> ...</>
                    ) : (
                      '📊 Analysis'
                    )}
                  </button>
                  <button 
                    className="btn-primary" 
                    style={{ flex: 1, padding: '10px 0', fontSize: '0.85rem', minWidth: '70px' }}
                    onClick={() => handleDownloadPDF(paper._id, paper.name || paper.metadata?.subject || 'paper')}
                    disabled={downloadingId === paper._id}
                  >
                    {downloadingId === paper._id ? (
                      <><div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }}></div> ...</>
                    ) : (
                      '📥 PDF'
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <PaperPreviewModal 
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        paper={previewPaper}
      />

      {/* Analysis Modal */}
      {analysisModalOpen && analysisPaper && (
        <div className="analysis-modal-overlay" onClick={() => setAnalysisModalOpen(false)}>
          <div className="analysis-modal-content animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="analysis-modal-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
                📊 {analysisPaper.name || analysisPaper.metadata?.subject || 'Paper'} — Analysis
              </h2>
              <button 
                onClick={() => setAnalysisModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)'
                }}
              >
                &times;
              </button>
            </div>
            <div className="analysis-modal-body">
              <AnalysisCharts paper={analysisPaper} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
