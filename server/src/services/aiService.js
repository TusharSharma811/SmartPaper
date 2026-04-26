import axios from "axios";
import FormData from "form-data";
import logger from "../utils/logger.js";

// ── AI Service Client ────────────────────────────────────────────
const AI_SERVICE_URL = () =>
  process.env.AI_SERVICE_URL || "http://localhost:8000";
const AI_TIMEOUT = 180_000; // 180 seconds (PDF + generation can be slow)
const MAX_RETRIES = 1;

/**
 * Call the Python AI service to generate a question paper.
 *
 * Sends a multipart form with all fields + optional syllabus PDF.
 * The AI service handles the PDF directly — no separate extraction step.
 *
 * @param {Object}  payload
 * @param {string}  payload.subject
 * @param {string}  payload.difficulty
 * @param {Array}   payload.pattern
 * @param {string}  [payload.exam]
 * @param {string}  [payload.subject_code]
 * @param {string}  [payload.duration]
 * @param {Array}   [payload.instructions]
 * @param {Buffer}  [payload.pdfBuffer]   — raw PDF file buffer
 * @param {string}  [payload.pdfFilename] — original filename
 * @returns {Object} — { metadata, instructions, sections }
 */
const generateQuestions = async ({
  subject,
  difficulty,
  pattern,
  exam,
  subject_code,
  duration,
  style,
  instructions,
  topics,
  pdfBuffer,
  pdfFilename,
}) => {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        logger.warn(`Retrying AI service (attempt ${attempt + 1})`);
      }

      const form = new FormData();
      form.append("subject", subject);
      form.append("difficulty", difficulty);
      form.append("pattern", JSON.stringify(pattern));
      if (style) form.append("style", style);

      if (exam) form.append("exam", exam);
      if (subject_code) form.append("subject_code", subject_code);
      if (duration) form.append("duration", duration);
      if (instructions && instructions.length > 0) {
        form.append("instructions", JSON.stringify(instructions));
      }

      if (topics && topics.length > 0) {
        form.append("topics", JSON.stringify(topics));
      }

      // Attach syllabus PDF directly — the AI service sends it to the LLM
      if (pdfBuffer) {
        form.append("syllabus_pdf", pdfBuffer, {
          filename: pdfFilename || "syllabus.pdf",
          contentType: "application/pdf",
        });
      }

      const response = await axios.post(
        `${AI_SERVICE_URL()}/generate-paper`,
        form,
        {
          timeout: AI_TIMEOUT,
          headers: form.getHeaders(),
        }
      );

      logger.info("AI service responded successfully");
      return response.data;
    } catch (error) {
      lastError = error;
      const msg = error.response?.data?.detail || error.message;
      logger.error(`AI service call failed (attempt ${attempt + 1}): ${msg}`);
    }
  }

  const err = new Error(
    `AI service unavailable after ${MAX_RETRIES + 1} attempts: ${lastError.message}`
  );
  err.statusCode = 502;
  throw err;
};

/**
 * Add an array of questions to the question bank vector store.
 */
const addQuestions = async (questions) => {
  try {
    const response = await axios.post(
      `${AI_SERVICE_URL()}/add-questions`,
      { questions },
      {
        timeout: AI_TIMEOUT,
        headers: { "Content-Type": "application/json" },
      }
    );
    logger.info(`Added ${response.data.added} questions to vector store`);
    return response.data;
  } catch (error) {
    const msg = error.response?.data?.detail || error.message;
    logger.error(`Failed to add questions: ${msg}`);
    const err = new Error(`AI service failed to add questions: ${msg}`);
    err.statusCode = error.response?.status || 502;
    throw err;
  }
};

/**
 * Search the question bank vector store.
 */
const searchQuestions = async (query, topK = 5, subject = null) => {
  try {
    const params = new URLSearchParams({
      query,
      top_k: topK.toString(),
    });
    if (subject) {
      params.append("subject", subject);
    }

    const response = await axios.get(
      `${AI_SERVICE_URL()}/search?${params.toString()}`,
      { timeout: AI_TIMEOUT }
    );
    return response.data;
  } catch (error) {
    const msg = error.response?.data?.detail || error.message;
    logger.error(`Search failed: ${msg}`);
    const err = new Error(`AI service failed during search: ${msg}`);
    err.statusCode = error.response?.status || 502;
    throw err;
  }
};

/**
 * Validate Bloom's and CO assignments via the Python AI service.
 *
 * @param {string}  subject   — subject name
 * @param {Array}   sections  — full sections array from the paper
 * @returns {Object} — validation result with corrections
 */
const validateAnalysis = async (subject, sections) => {
  try {
    const response = await axios.post(
      `${AI_SERVICE_URL()}/validate-analysis`,
      { subject, sections },
      {
        timeout: AI_TIMEOUT,
        headers: { "Content-Type": "application/json" },
      }
    );
    logger.info("Validation completed successfully");
    return response.data;
  } catch (error) {
    const msg = error.response?.data?.detail || error.message;
    logger.error(`Validation failed: ${msg}`);
    const err = new Error(`AI validation failed: ${msg}`);
    err.statusCode = error.response?.status || 502;
    throw err;
  }
};

/**
 * Detect subject names/codes from a syllabus PDF via the Python AI service.
 *
 * @param {Buffer} pdfBuffer — raw PDF file buffer
 * @param {string} pdfFilename — original filename
 * @returns {Object} — { subjects: [{ name, subject_code }], total_subjects }
 */
const detectSubjects = async (pdfBuffer, pdfFilename) => {
  try {
    const form = new FormData();
    form.append("syllabus_pdf", pdfBuffer, {
      filename: pdfFilename || "syllabus.pdf",
      contentType: "application/pdf",
    });

    const response = await axios.post(
      `${AI_SERVICE_URL()}/detect-subjects`,
      form,
      {
        timeout: AI_TIMEOUT,
        headers: form.getHeaders(),
      }
    );
    logger.info("Subject detection completed successfully");
    return response.data;
  } catch (error) {
    // Provide actionable error messages
    let msg;
    let statusCode;

    if (error.code === "ECONNREFUSED" || error.code === "ECONNRESET" || error.code === "ENOTFOUND") {
      msg = "AI service is not running. Please start the Python AI service (uvicorn) on port 8000.";
      statusCode = 503;
    } else if (error.response?.status === 404) {
      msg = "AI service endpoint /detect-subjects not found. Please restart the AI service to load the latest routes.";
      statusCode = 502;
    } else {
      msg = error.response?.data?.detail || error.message;
      statusCode = error.response?.status || 502;
    }

    logger.error(`Subject detection failed: ${msg}`);
    const err = new Error(`AI subject detection failed: ${msg}`);
    err.statusCode = statusCode;
    throw err;
  }
};

/**
 * Extract units/modules from a syllabus PDF via the Python AI service.
 *
 * @param {string} subject   — subject name
 * @param {Buffer} pdfBuffer — raw PDF file buffer
 * @param {string} pdfFilename — original filename
 * @returns {Object} — { subject, total_units, units: [...] }
 */
const extractUnits = async (subject, pdfBuffer, pdfFilename) => {
  try {
    const form = new FormData();
    form.append("subject", subject);
    form.append("syllabus_pdf", pdfBuffer, {
      filename: pdfFilename || "syllabus.pdf",
      contentType: "application/pdf",
    });

    const response = await axios.post(
      `${AI_SERVICE_URL()}/extract-units`,
      form,
      {
        timeout: AI_TIMEOUT,
        headers: form.getHeaders(),
      }
    );
    logger.info("Unit extraction completed successfully");
    return response.data;
  } catch (error) {
    const msg = error.response?.data?.detail || error.message;
    logger.error(`Unit extraction failed: ${msg}`);
    const err = new Error(`AI unit extraction failed: ${msg}`);
    err.statusCode = error.response?.status || 502;
    throw err;
  }
};

/**
 * Analyze an uploaded question paper PDF via the Python AI service.
 * Parses the PDF into structured JSON with sections, questions, blooms, and COs.
 *
 * @param {string} subject    — subject name
 * @param {Buffer} pdfBuffer  — raw PDF file buffer
 * @param {string} pdfFilename — original filename
 * @returns {Object} — { metadata, instructions, sections }
 */
const analyzePaperPDF = async (subject, pdfBuffer, pdfFilename) => {
  try {
    const form = new FormData();
    form.append("subject", subject || "Unknown");
    form.append("syllabus_pdf", pdfBuffer, {
      filename: pdfFilename || "paper.pdf",
      contentType: "application/pdf",
    });

    const response = await axios.post(
      `${AI_SERVICE_URL()}/analyze-paper-pdf`,
      form,
      {
        timeout: AI_TIMEOUT,
        headers: form.getHeaders(),
      }
    );
    logger.info("Paper PDF analysis completed successfully");
    return response.data;
  } catch (error) {
    const msg = error.response?.data?.detail || error.message;
    logger.error(`Paper PDF analysis failed: ${msg}`);
    const err = new Error(`AI paper analysis failed: ${msg}`);
    err.statusCode = error.response?.status || 502;
    throw err;
  }
};

export { generateQuestions, addQuestions, searchQuestions, validateAnalysis, detectSubjects, extractUnits, analyzePaperPDF };
