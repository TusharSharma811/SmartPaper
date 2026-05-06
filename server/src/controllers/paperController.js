import QuestionPaper from "../models/QuestionPaper.js";
import Question from "../models/Question.js";
import { generateQuestions, addQuestions as pushToVectorStore, validateAnalysis, detectSubjects, extractUnits, analyzePaperPDF } from "../services/aiService.js";
import { generatePDF, getPDFPath } from "../services/pdfService.js";
import { aggregateBlooms, aggregateCOs } from "../utils/analysisUtils.js";
import logger from "../utils/logger.js";
import fs from "fs";
import path from "path";

// ── Async question harvester ─────────────────────────────────────
// Extracts individual questions from a generated paper and saves
// them to both MongoDB (Question collection) and FAISS (vector
// store) so they feed future RAG-based generation.
// Runs fire-and-forget — errors are logged but never block the user.

const saveGeneratedQuestionsAsync = (paper) => {
  // Wrap in an immediately-invoked async function so we don't
  // hold up the HTTP response.
  (async () => {
    try {
      const subject = paper.metadata?.subject || "Unknown";
      const sections = paper.sections || [];
      const questionsToSave = [];

      for (const section of sections) {
        for (const q of section.questions || []) {
          for (const sq of q.subquestions || []) {
            questionsToSave.push({
              text: sq.text,
              subject,
              marks: sq.marks || q.marks || null,
              difficulty: sq.difficulty || paper.difficulty || "medium",
              topic: sq.topic || null,
              bloom_level: sq.bloom_level || null,
              co: sq.co || null,
            });
          }
          // Also harvest choice-group options
          for (const opt of q.options || []) {
            questionsToSave.push({
              text: opt.text,
              subject,
              marks: opt.marks || q.marks || null,
              difficulty: opt.difficulty || paper.difficulty || "medium",
              topic: opt.topic || null,
              bloom_level: null,
              co: null,
            });
          }
        }
      }

      if (questionsToSave.length === 0) return;

      // 1. Save to MongoDB
      const inserted = await Question.insertMany(questionsToSave, { ordered: false });
      logger.info(`[QuestionHarvester] Saved ${inserted.length} questions to MongoDB from paper ${paper._id}`);

      // 2. Push to FAISS vector store (best-effort)
      try {
        await pushToVectorStore(
          questionsToSave.map((q) => ({
            text: q.text,
            subject: q.subject,
            marks: q.marks,
            difficulty: q.difficulty,
            topic: q.topic,
          }))
        );
        logger.info(`[QuestionHarvester] Pushed ${questionsToSave.length} questions to FAISS`);
      } catch (vecErr) {
        logger.warn(`[QuestionHarvester] FAISS push failed (questions still in MongoDB): ${vecErr.message}`);
      }
    } catch (err) {
      logger.error(`[QuestionHarvester] Failed to save generated questions: ${err.message}`);
    }
  })();
};

// ── Paper Controller ─────────────────────────────────────────────

/**
 * POST /api/papers/generate
 *
 * Generation flow:
 *   1. Parse multipart form data (subject, difficulty, pattern, syllabus PDF, etc.)
 *   2. Call AI service — sends the PDF directly to the LLM
 *   3. Save paper to MongoDB
 *   4. Generate PDF via Puppeteer
 *   5. Return paper data
 */
const generatePaper = async (req, res, next) => {
  try {
    const { subject, difficulty, exam, subject_code, duration, style, paperName, topics, max_marks, unit_topic_map } = req.body;
    let pattern;
    let instructions;

    // Parse pattern from JSON string (sent as form field)
    try {
      pattern = JSON.parse(req.body.pattern);
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid pattern format. Must be a valid JSON array.",
      });
    }

    // Parse optional instructions
    try {
      instructions = req.body.instructions
        ? JSON.parse(req.body.instructions)
        : null;
    } catch {
      instructions = null;
    }

    // ── Step 1: Validate required fields ─────────────────────────
    if (!subject || !difficulty || !pattern) {
      return res.status(400).json({
        success: false,
        error: "Subject, difficulty, and pattern are required.",
      });
    }

    if (!Array.isArray(pattern) || pattern.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Pattern must be a non-empty array of sections.",
      });
    }

    // Calculate total marks from pattern
    const calculatedMarks = pattern.reduce(
      (sum, s) => sum + (s.questions || 0) * (s.marksEach || 0),
      0
    );

    // Use user-provided max_marks if available, else fall back to calculated
    const totalMarks = max_marks ? parseInt(max_marks, 10) || calculatedMarks : calculatedMarks;

    if (totalMarks <= 0) {
      return res.status(400).json({
        success: false,
        error: "Total marks must be greater than 0.",
      });
    }

    // ── Step 2: Call AI service (PDF is sent directly) ───────────
    // Parse optional topics (selected unit topics from frontend)
    let topicsList = null;
    if (topics) {
      try {
        topicsList = JSON.parse(topics);
      } catch {
        topicsList = null;
      }
    }

    // Parse optional unit_topic_map (unit→topic mapping for CO assignment)
    let unitTopicMap = null;
    if (unit_topic_map) {
      try {
        unitTopicMap = JSON.parse(unit_topic_map);
      } catch {
        unitTopicMap = null;
      }
    }

    const aiResponse = await generateQuestions({
      subject,
      difficulty,
      pattern,
      exam,
      subject_code,
      duration,
      style,
      instructions,
      topics: topicsList,
      unitTopicMap,
      pdfBuffer: req.file ? req.file.buffer : null,
      pdfFilename: req.file ? req.file.originalname : null,
    });

    // ── Step 2.5: Normalize choice_group questions ──────────────────
    // The LLM sometimes puts choice data in subquestions instead of options.
    const normalizedSections = (aiResponse.sections || []).map((section) => {
      const normalizedQuestions = (section.questions || []).map((q) => {
        if (q.type === "choice_group") {
          // If options are missing or empty but subquestions have data, move them
          const hasValidOptions =
            Array.isArray(q.options) &&
            q.options.length > 0 &&
            q.options[0]?.text;
          const hasSubquestions =
            Array.isArray(q.subquestions) &&
            q.subquestions.length > 0 &&
            q.subquestions[0]?.text;

          if (!hasValidOptions && hasSubquestions) {
            // Move subquestions → options
            q.options = q.subquestions.map((sq) => ({
              label: sq.label || "",
              text: sq.text || "",
              marks: sq.marks || q.marks || 0,
              difficulty: sq.difficulty || "",
              topic: sq.topic || "",
              co: sq.co,
              bloom_level: sq.bloom_level,
            }));
            q.subquestions = [];
          }

          // Clean up any empty option objects
          if (Array.isArray(q.options)) {
            q.options = q.options.filter(
              (opt) => opt && (opt.text || opt.label)
            );
          }
        }
        return q;
      });
      return { ...section, questions: normalizedQuestions };
    });

    // ── Step 3: Save paper to MongoDB ────────────────────────────
    // Build metadata — always override max_marks with user-provided value
    const paperMetadata = aiResponse.metadata || {
      subject,
      exam: exam || "Examination",
      subject_code: subject_code || "",
      duration: duration || "3 Hours",
      style: style || "direct",
    };
    // Ensure user-provided max_marks is always used
    paperMetadata.max_marks = totalMarks;

    const paper = await QuestionPaper.create({
      name: paperName || "",
      metadata: paperMetadata,
      instructions: aiResponse.instructions || [],
      sections: normalizedSections,
      pattern,
      difficulty,
      createdBy: req.user._id,
    });

    // ── Step 4: Generate PDF ─────────────────────────────────────
    try {
      const pdfPath = await generatePDF(paper);
      paper.pdfUrl = pdfPath;
      await paper.save();
      logger.info(`PDF generated: ${pdfPath}`);
    } catch (pdfErr) {
      logger.error(`PDF generation failed: ${pdfErr.message}`);
    }

    logger.info(`Paper saved: ${paper._id}`);

    // ── Step 4.5: Async harvest questions into Question bank ────
    saveGeneratedQuestionsAsync(paper);

    // ── Step 4.5: Save locally to JSON ───────────────────────────
    try {
      const LOCAL_PAPERS_DIR = path.resolve("./local_papers");
      if (!fs.existsSync(LOCAL_PAPERS_DIR)) {
        fs.mkdirSync(LOCAL_PAPERS_DIR, { recursive: true });
      }
      const jsonPath = path.join(LOCAL_PAPERS_DIR, `${paper._id}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(paper.toObject(), null, 2), "utf8");
      logger.info(`Paper JSON saved locally: ${jsonPath}`);
    } catch (saveErr) {
      logger.error(`Failed to save local JSON: ${saveErr.message}`);
    }

    // ── Step 5: Return paper data ────────────────────────────────
    return res.status(201).json({
      success: true,
      data: paper,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/papers
 */
const getPapers = async (req, res, next) => {
  try {
    const papers = await QuestionPaper.find({ createdBy: req.user._id })
      .select("-sections")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, data: papers });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/papers/:id
 */
const getPaperById = async (req, res, next) => {
  try {
    const paper = await QuestionPaper.findById(req.params.id);
    if (!paper) {
      return res
        .status(404)
        .json({ success: false, error: "Paper not found." });
    }
    return res.status(200).json({ success: true, data: paper });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/papers/:id/pdf
 */
const getPaperPDF = async (req, res, next) => {
  try {
    const paper = await QuestionPaper.findById(req.params.id);
    if (!paper) {
      return res
        .status(404)
        .json({ success: false, error: "Paper not found." });
    }

    const filePath = getPDFPath(paper._id.toString());

    // Auto-regenerate PDF if missing or empty on disk
    let needsRegeneration = false;
    if (!paper.pdfUrl || !fs.existsSync(filePath)) {
      needsRegeneration = true;
    } else {
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        needsRegeneration = true;
      }
    }

    if (needsRegeneration) {
      logger.info(`PDF missing or empty for paper ${paper._id}, regenerating...`);
      try {
        const newPath = await generatePDF(paper);
        paper.pdfUrl = newPath;
        await paper.save();
        logger.info(`PDF regenerated: ${newPath}`);
      } catch (regenErr) {
        logger.error(`PDF regeneration failed: ${regenErr.message}`);
        return res
          .status(500)
          .json({ success: false, error: "PDF generation failed. Please try again later." });
      }
    }

    // Verify the file now exists and is non-empty
    if (!fs.existsSync(filePath)) {
      logger.error(`PDF file still missing after regeneration: ${filePath}`);
      return res
        .status(404)
        .json({ success: false, error: "PDF file not found on server." });
    }

    const pdfBuffer = fs.readFileSync(filePath);

    if (pdfBuffer.length === 0) {
      logger.error(`PDF file is zero bytes: ${filePath}`);
      return res
        .status(500)
        .json({ success: false, error: "PDF file is empty. Please try regenerating the paper." });
    }

    const subjectName = paper.metadata?.subject || "paper";
    const filename = `${subjectName.replace(/\s+/g, "_")}_paper_${paper._id}.pdf`;

    logger.info(`Serving PDF: ${filePath} (${pdfBuffer.length} bytes)`);

    // Use Express res.set() + res.send() instead of res.writeHead() + res.end()
    // to avoid bypassing middleware (compression, CORS, etc.)
    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": pdfBuffer.length,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    res.status(200).send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/papers/:id/analysis
 * Returns aggregated Bloom's and CO distribution.
 */
const getAnalysis = async (req, res, next) => {
  try {
    const paper = await QuestionPaper.findById(req.params.id);
    if (!paper) {
      return res
        .status(404)
        .json({ success: false, error: "Paper not found." });
    }

    const blooms_distribution = aggregateBlooms(paper);
    const co_distribution = aggregateCOs(paper);

    return res.status(200).json({
      success: true,
      data: { blooms_distribution, co_distribution },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/papers/:id/validate
 * Validate Bloom's and CO assignments using AI.
 */
const validatePaperAnalysis = async (req, res, next) => {
  try {
    const paper = await QuestionPaper.findById(req.params.id);
    if (!paper) {
      return res
        .status(404)
        .json({ success: false, error: "Paper not found." });
    }

    const subject = paper.metadata?.subject || "Unknown";
    const result = await validateAnalysis(subject, paper.sections || []);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/papers/detect-subjects
 * Detect subjects from an uploaded syllabus PDF.
 */
const detectSubjectsFromPDF = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Syllabus PDF file is required.",
      });
    }

    const result = await detectSubjects(
      req.file.buffer,
      req.file.originalname
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/papers/extract-units
 * Extract units from an uploaded syllabus PDF.
 */
const extractUnitsFromPDF = async (req, res, next) => {
  try {
    const subject = req.body.subject || "";
    if (!subject.trim()) {
      return res.status(400).json({
        success: false,
        error: "Subject selection is required before extracting units.",
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Syllabus PDF file is required.",
      });
    }

    const result = await extractUnits(
      subject,
      req.file.buffer,
      req.file.originalname
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/papers/analyze-pdf
 * Analyze an uploaded question paper PDF — parse it into structured JSON.
 */
const analyzePaperPDFController = async (req, res, next) => {
  try {
    const { subject } = req.body;
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Question paper PDF file is required.",
      });
    }

    const result = await analyzePaperPDF(
      subject || "Unknown",
      req.file.buffer,
      req.file.originalname
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/papers/validate-uploaded
 * Validate Bloom's and CO for an uploaded (non-DB) paper.
 * Receives { subject, sections } in JSON body and proxies to AI service.
 */
const validateUploadedPaper = async (req, res, next) => {
  try {
    const { subject, sections } = req.body;
    if (!sections || !Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Sections data is required for validation.",
      });
    }

    const result = await validateAnalysis(subject || "Unknown", sections);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/papers/:id
 * Delete a paper and its PDF file.
 */
const deletePaper = async (req, res, next) => {
  try {
    const paper = await QuestionPaper.findById(req.params.id);
    if (!paper) {
      return res
        .status(404)
        .json({ success: false, error: "Paper not found." });
    }

    // Ensure the paper belongs to the logged-in user
    if (paper.createdBy.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ success: false, error: "Not authorized to delete this paper." });
    }

    // Delete the PDF file from disk if it exists
    try {
      const filePath = getPDFPath(paper._id.toString());
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`PDF file deleted: ${filePath}`);
      }
    } catch (fileErr) {
      logger.warn(`Failed to delete PDF file: ${fileErr.message}`);
    }

    // Delete the local JSON copy if it exists
    try {
      const LOCAL_PAPERS_DIR = path.resolve("./local_papers");
      const jsonPath = path.join(LOCAL_PAPERS_DIR, `${paper._id}.json`);
      if (fs.existsSync(jsonPath)) {
        fs.unlinkSync(jsonPath);
        logger.info(`Local JSON deleted: ${jsonPath}`);
      }
    } catch (jsonErr) {
      logger.warn(`Failed to delete local JSON: ${jsonErr.message}`);
    }

    // Delete from MongoDB
    await QuestionPaper.findByIdAndDelete(req.params.id);
    logger.info(`Paper deleted: ${req.params.id}`);

    return res.status(200).json({ success: true, message: "Paper deleted successfully." });
  } catch (error) {
    next(error);
  }
};

export { generatePaper, getPapers, getPaperById, getPaperPDF, getAnalysis, validatePaperAnalysis, detectSubjectsFromPDF, extractUnitsFromPDF, analyzePaperPDFController, validateUploadedPaper, deletePaper };
