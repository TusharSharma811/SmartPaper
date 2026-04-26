import { useState, useRef, useEffect } from 'react'
import Navbar from '../components/Navbar'
import PaperPreviewModal from '../components/PaperPreviewModal'
import AnalysisCharts from '../components/AnalysisCharts'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'

// Subject is now auto-detected from the uploaded syllabus PDF

const normalizeTopics = (topics) => {
  if (Array.isArray(topics)) {
    return topics.map(topic => `${topic ?? ''}`.trim()).filter(Boolean)
  }
  if (typeof topics === 'string') {
    return topics
      .split(/[,;\n]+/)
      .map(topic => topic.trim())
      .filter(Boolean)
  }
  return []
}

const normalizeUnits = (units = []) =>
  (Array.isArray(units) ? units : []).map((unit, index) => ({
    unit_number: Number(unit?.unit_number) || index + 1,
    title: unit?.title || `Unit ${index + 1}`,
    topics: normalizeTopics(unit?.topics),
  }))

const normalizeDetectedSubjects = (payload) => {
  const rawSubjects = Array.isArray(payload?.subjects) && payload.subjects.length > 0
    ? payload.subjects
    : ((payload?.detected_subject || payload?.subject || (payload?.units || []).length > 0)
      ? [{
          name: payload?.detected_subject || payload?.subject || '',
          subject_code: payload?.detected_subject_code || '',
          units: payload?.units || [],
        }]
      : [])

  return rawSubjects
    .map((item, index) => ({
      id: `${item?.subject_code || item?.name || 'subject'}-${index}`,
      name: `${item?.name || item?.subject || item?.detected_subject || ''}`.trim(),
      subject_code: `${item?.subject_code || item?.detected_subject_code || ''}`.trim(),
      units: normalizeUnits(item?.units),
    }))
    .filter(item => item.name || item.units.length > 0)
}

const DEFAULT_PATTERN = [
  { section: 'A', questions: 10, marksEach: 2, questionType: 'single' },
  { section: 'B', questions: 5, marksEach: 6, questionType: 'single' },
  { section: 'C', questions: 2, marksEach: 10, questionType: 'single' },
]

export default function GeneratorPage() {
  const { api } = useAuth()
  const toast = useToast()
  const fileInputRef = useRef(null)

  // Form state
  const [paperName, setPaperName] = useState('')
  const [examName, setExamName] = useState('')
  const [subjectCode, setSubjectCode] = useState('')
  const [duration, setDuration] = useState('3 Hours')
  const [subject, setSubject] = useState('')
  const [difficulty, setDifficulty] = useState('50') // 1 to 100 percentage
  const [questionStyle, setQuestionStyle] = useState('direct') // direct vs twisted
  const [pattern, setPattern] = useState(DEFAULT_PATTERN)
  const [syllabusFile, setSyllabusFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [detectedSubjects, setDetectedSubjects] = useState([])
  const [detectingSubjects, setDetectingSubjects] = useState(false)
  const [subjectDetectError, setSubjectDetectError] = useState('')

  // Unit selection state
  const [extractedUnits, setExtractedUnits] = useState([])
  const [selectedUnits, setSelectedUnits] = useState([])
  const [extractingUnits, setExtractingUnits] = useState(false)
  const [extractError, setExtractError] = useState('')

  // Generation state
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('Analyzing context...')
  const [error, setError] = useState('')
  const [downloadingPDF, setDownloadingPDF] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [generatedPaper, setGeneratedPaper] = useState(null)

  // Cycle loading messages when loading is true
  useEffect(() => {
    let interval;
    if (loading) {
      const messages = [
        "Analyzing syllabus context...",
        "Structuring section patterns...",
        "Generating questions and choices...",
        "Formatting paper document...",
        "Finalizing..."
      ];
      let i = 0;
      setLoadingText(messages[i]);
      interval = setInterval(() => {
        i = (i + 1) % messages.length;
        setLoadingText(messages[i]);
      }, 3500); // changes every 3.5s
    }
    return () => clearInterval(interval);
  }, [loading]);

  const totalMarks = pattern.reduce((sum, s) => sum + s.questions * s.marksEach, 0)

  const updatePattern = (index, field, value) => {
    const newPattern = [...pattern]
    newPattern[index] = { ...newPattern[index], [field]: parseInt(value) || 0 }
    setPattern(newPattern)
  }

  const toggleSectionChoice = (index) => {
    const newPattern = [...pattern]
    newPattern[index].questionType = newPattern[index].questionType === 'choice_group' ? 'single' : 'choice_group'
    setPattern(newPattern)
  }

  const addSection = () => {
    if (pattern.length >= 10) {
      toast.warning('Maximum 10 sections allowed.')
      return
    }
    const nextLabel = String.fromCharCode(65 + pattern.length)
    setPattern([...pattern, { section: nextLabel, questions: 5, marksEach: 5 }])
  }

  const removeSection = (indexToRemove) => {
    if (pattern.length <= 1) {
      toast.warning('You must have at least one section.')
      return
    }
    const newPattern = pattern.filter((_, idx) => idx !== indexToRemove)
    const relabeledPattern = newPattern.map((sec, idx) => ({
      ...sec,
      section: String.fromCharCode(65 + idx)
    }))
    setPattern(relabeledPattern)
  }

  // File handling
  const handleFileSelect = (file) => {
    if (file && file.type === 'application/pdf') {
      setSyllabusFile(file)
      setError('')
      setSubject('')
      setSubjectCode('')
      setDetectedSubjects([])
      setSubjectDetectError('')
      setExtractedUnits([])
      setSelectedUnits([])
      setExtractError('')
      handleDetectSubjects(file)
    } else if (file) {
      toast.error('Please upload a PDF file only.')
    }
  }

  const selectDetectedSubject = (selectedSubjectName, subjectsList = detectedSubjects) => {
    const subjectName = `${selectedSubjectName ?? ''}`.trim()
    if (!subjectName) {
      setSubject('')
      setSubjectCode('')
      return null
    }

    const nextSubject = subjectsList.find(item => item.name === subjectName) || null
    if (!nextSubject) return null

    setSubject(nextSubject.name)
    setSubjectCode(nextSubject.subject_code || '')
    return nextSubject
  }

  const handleDetectSubjects = async (file) => {
    setDetectingSubjects(true)
    setSubjectDetectError('')
    setDetectedSubjects([])
    setExtractingUnits(false)
    setExtractError('')
    setExtractedUnits([])
    setSelectedUnits([])
    try {
      const formData = new FormData()
      formData.append('syllabus_pdf', file)

      const { data } = await api.post('/papers/detect-subjects', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      })

      const subjectsFromPdf = normalizeDetectedSubjects(data.data)
      if (data.success && subjectsFromPdf.length > 0) {
        setDetectedSubjects(subjectsFromPdf)

        if (subjectsFromPdf.length === 1) {
          const onlySubject = selectDetectedSubject(subjectsFromPdf[0].name, subjectsFromPdf)
          setDetectingSubjects(false)
          if (onlySubject?.name) {
            await handleExtractUnits(file, onlySubject.name)
            return
          }
        }
      } else {
        setSubjectDetectError('No subjects could be detected from this PDF.')
        toast.warning('No subjects could be detected from this PDF.')
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to detect subjects'
      setSubjectDetectError(msg)
      toast.error(msg)
    } finally {
      setDetectingSubjects(false)
    }
  }

  // Extract units from syllabus PDF
  const handleExtractUnits = async (file, selectedSubject = subject) => {
    const subjectName = `${selectedSubject ?? ''}`.trim()
    if (!subjectName) return

    setExtractingUnits(true)
    setExtractError('')
    setExtractedUnits([])
    setSelectedUnits([])
    try {
      const formData = new FormData()
      formData.append('subject', subjectName)
      formData.append('syllabus_pdf', file)

      const { data } = await api.post('/papers/extract-units', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      })

      if (data.success && data.data?.units?.length > 0) {
        const normalizedUnits = normalizeUnits(data.data.units)
        setExtractedUnits(normalizedUnits)
        setSelectedUnits(normalizedUnits.map(unit => unit.unit_number))
        if (data.data.detected_subject) {
          setSubject(data.data.detected_subject)
        }
        if (data.data.detected_subject_code) {
          setSubjectCode(data.data.detected_subject_code)
        }
      } else {
        setExtractError(`No units could be extracted for ${subjectName}.`)
        toast.warning(`No units could be extracted for ${subjectName}.`)
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to extract units'
      setExtractError(msg)
      toast.error(msg)
    } finally {
      setExtractingUnits(false)
    }
  }

  const handleSubjectChange = (e) => {
    const nextSubject = e.target.value
    if (detectedSubjects.length > 0) {
      const detectedSubject = selectDetectedSubject(nextSubject)
      setExtractError('')
      setExtractedUnits([])
      setSelectedUnits([])
      if (syllabusFile && detectedSubject?.name) {
        handleExtractUnits(syllabusFile, detectedSubject.name)
      }
      return
    }
    setSubject(nextSubject)
  }

  // Toggle a specific unit
  const toggleUnit = (unitNum) => {
    setSelectedUnits(prev =>
      prev.includes(unitNum)
        ? prev.filter(n => n !== unitNum)
        : [...prev, unitNum]
    )
  }

  // Select / deselect all units
  const toggleAllUnits = () => {
    if (selectedUnits.length === extractedUnits.length) {
      setSelectedUnits([])
    } else {
      setSelectedUnits(extractedUnits.map(u => u.unit_number))
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    handleFileSelect(file)
  }

  // Generate paper
  const handleGenerate = async () => {
    // Validate: syllabus PDF is mandatory
    if (!syllabusFile) {
      toast.error('Please upload a syllabus PDF before generating.')
      return
    }

    if (detectingSubjects) {
      toast.warning('Please wait until subject detection is complete.')
      return
    }

    // Validate: subject is required
    if (!subject.trim()) {
      toast.error('Subject name is required. Upload a syllabus to auto-detect or enter manually.')
      return
    }

    // Validate: if units were extracted, at least 1 must be selected
    if (extractedUnits.length > 0 && selectedUnits.length === 0) {
      toast.error('Please select at least 1 unit for paper generation.')
      return
    }

    setError('')
    setLoading(true)
    setShowPreview(false)

    try {
      const formData = new FormData()
      if (paperName) formData.append('paperName', paperName)
      if (examName) formData.append('exam', examName)
      if (subjectCode) formData.append('subject_code', subjectCode)
      if (duration) formData.append('duration', duration)
      formData.append('subject', subject)
      
      // Determine descriptive difficulty string
      const numDiff = parseInt(difficulty, 10)
      let diffDesc = 'Moderate'
      if (numDiff <= 25) diffDesc = 'Very Easy'
      else if (numDiff <= 45) diffDesc = 'Easy'
      else if (numDiff <= 65) diffDesc = 'Moderate'
      else if (numDiff <= 85) diffDesc = 'Hard'
      else diffDesc = 'Very Hard'
      
      formData.append('difficulty', `${diffDesc} (${numDiff}%)`)
      
      formData.append('style', questionStyle)
      formData.append('pattern', JSON.stringify(pattern))
      if (syllabusFile) {
        formData.append('syllabus_pdf', syllabusFile)
      }

      // Pass selected unit topics to the AI
      if (extractedUnits.length > 0 && selectedUnits.length > 0) {
        const selectedTopics = extractedUnits
          .filter(u => selectedUnits.includes(u.unit_number))
          .flatMap(u => u.topics)
        if (selectedTopics.length > 0) {
          formData.append('topics', JSON.stringify(selectedTopics))
        }
      }

      const { data } = await api.post('/papers/generate', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 180000,
      })

      if (data.success) {
        setGeneratedPaper(data.data)
        toast.success('Question paper generated successfully!')
      } else {
        throw new Error(data.error || 'Generation failed')
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to generate paper'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  // Download PDF
  const handleDownloadPDF = async () => {
    if (!generatedPaper) return
    setDownloadingPDF(true)
    try {
      const paperId = generatedPaper._id
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
      toast.error('Failed to download PDF. Please try again.')
    } finally {
      setDownloadingPDF(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh' }} className="bg-grid">
      <Navbar />

      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '40px 24px' }}>
        {/* Page Header */}
        <div className="animate-fade-in" style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '8px', letterSpacing: '-0.03em' }}>
            <span className="gradient-text">Generate Question Paper</span>
          </h1>
        </div>

        {/* Main Content Layout - Flex Container */}
        <div className="generator-layout-container">
          
          {/* Center Column: Generator Form & Results */}
          <div className="generator-form-col centered">
            {/* Form Card */}
            <div className="glass-card animate-slide-up" style={{ padding: '32px' }}>
              {/* Error */}
              {error && (
                <div className="alert alert-error" style={{ marginBottom: '24px' }}>
                  <span>⚠️</span> {error}
                </div>
              )}

              {/* Paper Name / Exam Settings */}
              <div style={{ marginBottom: '24px' }}>
                <label className="form-label">Title / Document Name <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. Midterm_2026_DataStructures"
                  value={paperName}
                  onChange={(e) => setPaperName(e.target.value)}
                  disabled={loading}
                  style={{ marginBottom: '12px' }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Exam Header <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. END SEMESTER EXAMINATION"
                      value={examName}
                      onChange={(e) => setExamName(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Subject Code <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. BCS301"
                      value={subjectCode}
                      onChange={(e) => setSubjectCode(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Duration <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. 3 Hours"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                </div>
              </div>

              {/* Subject - auto-detected from syllabus */}
              <div style={{ marginBottom: '24px' }}>
                <label className="form-label">
                  Subject
                  {detectedSubjects.length > 0 && subject && (
                    <span style={{
                      marginLeft: '8px',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      color: 'var(--success)',
                      background: 'rgba(16, 185, 129, 0.08)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                    }}>
                      Auto-detected
                    </span>
                  )}
                </label>
                {detectingSubjects ? (
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Detecting subjects from syllabus..."
                    value=""
                    disabled
                  />
                ) : detectedSubjects.length > 0 ? (
                  <select
                    className="input-field"
                    value={subject}
                    onChange={handleSubjectChange}
                    disabled={loading || extractingUnits || detectingSubjects}
                    style={{
                      borderColor: !subject.trim() && syllabusFile && !extractingUnits ? 'var(--warning)' : undefined,
                    }}
                  >
                    {detectedSubjects.length > 1 && (
                      <option value="">Select detected subject</option>
                    )}
                    {detectedSubjects.map(item => (
                      <option key={item.id} value={item.name}>
                        {item.name}{item.subject_code ? ` (${item.subject_code})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="input-field"
                    placeholder={syllabusFile ? 'Upload detected. Waiting for subject detection...' : 'Upload syllabus to auto-detect subject'}
                    value={subject}
                    onChange={handleSubjectChange}
                    disabled={loading}
                    style={{
                      borderColor: !subject.trim() && syllabusFile && !extractingUnits ? 'var(--warning)' : undefined,
                    }}
                  />
                )}
                {detectedSubjects.length > 1 && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                    Select one of the {detectedSubjects.length} subjects detected in this PDF. Units will load after selection.
                  </p>
                )}
                {subjectDetectError && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--error)', marginTop: '6px' }}>
                    {subjectDetectError}
                  </p>
                )}
                {!syllabusFile && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                    Upload a syllabus PDF below - the subject name will be auto-detected
                  </p>
                )}
              </div>

              {/* Syllabus Upload - REQUIRED */}
              <div style={{ marginBottom: '24px' }}>
                <label className="form-label">
                  Upload Syllabus PDF <span style={{ color: 'var(--error)', fontWeight: 600 }}>*</span>
                </label>
                <div
                  className={`drop-zone ${dragOver ? 'drag-over' : ''} ${syllabusFile ? 'has-file' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    style={{ display: 'none' }}
                    onChange={(e) => handleFileSelect(e.target.files[0])}
                  />
                  {syllabusFile ? (
                    <div>
                      <span style={{ fontSize: '1.5rem' }}>✅</span>
                      <p style={{ marginTop: '8px', fontWeight: 500, color: 'var(--success)' }}>
                        {syllabusFile.name}
                      </p>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {(syllabusFile.size / 1024).toFixed(1)} KB • Click to change
                      </p>
                    </div>
                  ) : (
                    <div>
                      <span style={{ fontSize: '2rem', opacity: 0.5 }}>📄</span>
                      <p style={{ marginTop: '8px', color: 'var(--text-secondary)' }}>
                        Drag & drop a PDF here, or click to browse
                      </p>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        The syllabus PDF will be sent directly to the AI for context
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Unit Selector - shown after syllabus extraction */}
              {syllabusFile && (
                <div style={{ marginBottom: '24px' }}>
                  {detectingSubjects ? (
                    <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px', borderColor: 'var(--accent)', borderTopColor: 'transparent' }}></div>
                      <div>
                        <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Detecting subjects from syllabus...</p>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>AI is identifying all subjects present in the PDF</p>
                      </div>
                    </div>
                  ) : detectedSubjects.length > 1 && !subject ? (
                    <div className="glass-card" style={{ padding: '20px' }}>
                      <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Select a subject to continue</p>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Unit extraction will start after you choose one of the detected subjects above.
                      </p>
                    </div>
                  ) : extractingUnits ? (
                    <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px', borderColor: 'var(--accent)', borderTopColor: 'transparent' }}></div>
                      <div>
                        <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Extracting units for {subject || 'selected subject'}...</p>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>AI is analyzing the selected subject section of the PDF</p>
                      </div>
                    </div>
                  ) : extractError ? (
                    <div className="alert alert-error" style={{ marginBottom: '0' }}>
                      <span>⚠️</span> {extractError}
                    </div>
                  ) : extractedUnits.length > 0 ? (
                    <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
                      <div style={{
                        padding: '12px 16px',
                        background: 'var(--bg-secondary)',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            📚 Syllabus Units ({extractedUnits.length} found)
                          </span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '8px' }}>
                            {subject ? `Showing units for ${subject}` : 'Select units to generate questions from'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={toggleAllUnits}
                          style={{
                            background: 'none',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            padding: '4px 12px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            color: selectedUnits.length === extractedUnits.length ? 'var(--accent)' : 'var(--text-secondary)',
                            fontFamily: 'inherit',
                          }}
                        >
                          {selectedUnits.length === extractedUnits.length ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>
                      <div style={{ padding: '8px 0' }}>
                        {extractedUnits.map((unit) => {
                          const isSelected = selectedUnits.includes(unit.unit_number)
                          return (
                            <label
                              key={unit.unit_number}
                              className="unit-selector-item"
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '10px',
                                padding: '10px 16px',
                                cursor: 'pointer',
                                transition: 'background 0.15s ease',
                                background: isSelected ? 'rgba(99, 102, 241, 0.04)' : 'transparent',
                                borderBottom: '1px solid var(--border)',
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = isSelected ? 'rgba(99, 102, 241, 0.07)' : 'var(--bg-input)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = isSelected ? 'rgba(99, 102, 241, 0.04)' : 'transparent'}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleUnit(unit.unit_number)}
                                style={{
                                  width: '16px',
                                  height: '16px',
                                  marginTop: '2px',
                                  accentColor: 'var(--accent)',
                                  cursor: 'pointer',
                                }}
                              />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    background: isSelected ? 'var(--accent)' : 'var(--bg-input)',
                                    color: isSelected ? '#fff' : 'var(--text-secondary)',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    transition: 'all 0.2s',
                                  }}>
                                    UNIT {unit.unit_number}
                                  </span>
                                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                    {unit.title}
                                  </span>
                                </div>
                                {unit.topics?.length > 0 && (
                                  <p style={{
                                    fontSize: '0.75rem',
                                    color: 'var(--text-muted)',
                                    marginTop: '4px',
                                    lineHeight: 1.5,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}>
                                    {unit.topics.join(' • ')}
                                  </p>
                                )}
                              </div>
                            </label>
                          )
                        })}
                      </div>
                      {/* Status bar: unit count + warning if none selected */}
                      <div style={{
                        padding: '8px 16px',
                        background: selectedUnits.length === 0 ? 'rgba(239, 68, 68, 0.06)' : 'rgba(99, 102, 241, 0.04)',
                        fontSize: '0.8rem',
                        color: selectedUnits.length === 0 ? 'var(--error)' : 'var(--accent)',
                        fontWeight: 500,
                        textAlign: 'center',
                      }}>
                        {selectedUnits.length === 0 ? (
                          '⚠️ Select at least 1 unit to generate the paper'
                        ) : selectedUnits.length === extractedUnits.length ? (
                          `✅ All ${extractedUnits.length} units selected`
                        ) : (
                          `✨ ${selectedUnits.length} of ${extractedUnits.length} units selected — questions will focus on these units only`
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Difficulty Slider */}
              <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Difficulty Level</label>
                  <span style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600 }}>
                    {difficulty <= 25 && 'Very Easy'}
                    {difficulty > 25 && difficulty <= 45 && 'Easy'}
                    {difficulty > 45 && difficulty <= 65 && 'Moderate'}
                    {difficulty > 65 && difficulty <= 85 && 'Hard'}
                    {difficulty > 85 && 'Very Hard'}
                    {` (${difficulty}%)`}
                  </span>
                </div>
                <div style={{ padding: '0 10px' }}>
                  <input 
                    type="range" 
                    min="1" 
                    max="100" 
                    value={difficulty} 
                    onChange={(e) => setDifficulty(e.target.value)} 
                    disabled={loading}
                    style={{
                      width: '100%',
                      cursor: 'pointer',
                      accentColor: 'var(--accent)'
                    }}
                  />
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    marginTop: '8px',
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    fontWeight: 500
                  }}>
                    <span>Easy</span>
                    <span>Moderate</span>
                    <span>Hard</span>
                  </div>
                </div>
              </div>

              {/* Question Style */}
              <div style={{ marginBottom: '28px' }}>
                <label className="form-label">Question Style</label>
                <div style={{ display: 'flex', gap: '12px' }}>
                  {[
                    { id: 'direct', label: 'Direct', desc: 'Straightforward & definitional' },
                    { id: 'twisted', label: 'Twisted', desc: 'Analytical & scenario-based' }
                  ].map(styleOpt => (
                    <button
                      key={styleOpt.id}
                      type="button"
                      onClick={() => setQuestionStyle(styleOpt.id)}
                      disabled={loading}
                      style={{
                        flex: 1,
                        padding: '14px',
                        borderRadius: '10px',
                        border: questionStyle === styleOpt.id
                          ? '2px solid var(--accent)'
                          : '1px solid var(--border)',
                        background: questionStyle === styleOpt.id
                          ? 'rgba(99, 102, 241, 0.08)'
                          : 'var(--bg-input)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ 
                        fontWeight: questionStyle === styleOpt.id ? 700 : 500,
                        color: questionStyle === styleOpt.id ? 'var(--accent-hover)' : 'var(--text-primary)',
                        marginBottom: '4px',
                        fontSize: '0.95rem'
                      }}>
                        {styleOpt.id === 'direct' ? '🎯 ' : '🧩 '}{styleOpt.label}
                      </div>
                      <div style={{ 
                        fontSize: '0.75rem', 
                        color: 'var(--text-muted)' 
                      }}>
                        {styleOpt.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="divider"></div>

              {/* Exam Pattern */}
              <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Exam Pattern Configuration</label>
                  <span style={{
                    padding: '4px 12px',
                    borderRadius: '20px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    background: 'linear-gradient(135deg, var(--gradient-start), var(--gradient-end))',
                    color: 'white',
                  }}>
                    Total: {totalMarks} marks
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {pattern.map((sec, idx) => (
                    <div
                      key={sec.section}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '100px 1fr 1fr auto auto',
                        gap: '12px',
                        alignItems: 'center',
                        padding: '16px',
                        borderRadius: '10px',
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div>
                        <span style={{
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                        }}>
                          Section {sec.section}
                        </span>
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                          Questions
                        </label>
                        <input
                          type="number"
                          className="input-field"
                          style={{ padding: '8px 12px' }}
                          value={sec.questions}
                          onChange={(e) => updatePattern(idx, 'questions', e.target.value)}
                          min={1}
                          max={50}
                          disabled={loading}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                          Marks Each
                        </label>
                        <input
                          type="number"
                          className="input-field"
                          style={{ padding: '8px 12px' }}
                          value={sec.marksEach}
                          onChange={(e) => updatePattern(idx, 'marksEach', e.target.value)}
                          min={1}
                          max={50}
                          disabled={loading}
                        />
                      </div>
                      <div style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                        paddingTop: '18px',
                        marginRight: '12px'
                      }}>
                        = {sec.questions * sec.marksEach}m
                      </div>
                      <div style={{ paddingTop: '18px' }}>
                         <button
                            type="button"
                            onClick={() => removeSection(idx)}
                            disabled={loading || pattern.length <= 1}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: pattern.length <= 1 ? 'var(--text-muted)' : 'var(--error)',
                              cursor: pattern.length <= 1 ? 'not-allowed' : 'pointer',
                              fontSize: '1rem',
                            }}
                            title="Remove Section"
                         >
                           ✖
                         </button>
                      </div>
                      
                      {/* Section Extras: Internal choice */}
                      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '16px', marginTop: '4px', paddingTop: '8px', borderTop: '1px dashed var(--border)' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            <input 
                              type="checkbox" 
                              checked={sec.questionType === 'choice_group'}
                              onChange={() => toggleSectionChoice(idx)}
                              disabled={loading}
                              style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                            />
                            Include Internal Choice (OR)
                          </label>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                   type="button"
                   onClick={addSection}
                   disabled={loading || pattern.length >= 10}
                   className="btn-secondary"
                   style={{
                     marginTop: '16px',
                     width: '100%',
                     padding: '10px',
                     fontSize: '0.85rem',
                     borderStyle: 'dashed',
                   }}
                >
                  + Add Section
                </button>
              </div>

              {/* Generate / Regenerate Button */}
              <button
                className="btn-primary"
                style={{
                  width: '100%',
                  padding: '16px',
                  fontSize: '1rem',
                  ...(loading ? {} : {
                    animation: 'pulse-glow 3s infinite',
                  }),
                }}
                onClick={handleGenerate}
                disabled={loading || !syllabusFile || !subject.trim() || detectingSubjects || extractingUnits || (extractedUnits.length > 0 && selectedUnits.length === 0)}
              >
                {loading ? (
                  <>
                    <div className="spinner"></div>
                    {loadingText || 'Generating...'}
                  </>
                ) : generatedPaper ? (
                  '🔄 Regenerate Question Paper'
                ) : (
                  '⚡ Generate Question Paper'
                )}
              </button>

              {loading && (
                <p style={{
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  marginTop: '12px',
                }}>
                  This may take up to 3 minutes depending on AI model and syllabus size...
                </p>
              )}
            </div>

            {/* Generated Paper Results Actions (Below Form) */}
            {generatedPaper && !loading && (
              <div className="animate-slide-up" style={{ marginTop: '24px' }}>
                <div className="glass-card" style={{
                  padding: '20px 24px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}>
                  <div>
                    <p style={{ fontWeight: 600, color: 'var(--success)', fontSize: '0.95rem' }}>
                      ✅ Paper generated successfully!
                    </p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {generatedPaper.metadata?.subject || subject} • {generatedPaper.metadata?.max_marks || totalMarks} marks
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      className="btn-outline"
                      onClick={() => setShowPreview(!showPreview)}
                    >
                      {showPreview ? '🔼 Hide Preview' : '👁️ Preview Paper'}
                    </button>
                    <button
                      className="btn-primary"
                      onClick={handleDownloadPDF}
                      disabled={downloadingPDF}
                      style={{ padding: '10px 20px' }}
                    >
                      {downloadingPDF ? (
                        <><div className="spinner"></div> Preparing...</>
                      ) : (
                        '📥 Download PDF'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Analysis Charts — rendered after generation */}
            {generatedPaper && !loading && (
              <AnalysisCharts paper={generatedPaper} />
            )}
          </div>
        </div>
      </div>

      {/* Paper Preview Modal */}
      <PaperPreviewModal
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
        paper={generatedPaper}
      />
    </div>
  )
}
