import { Router } from "express";
import multer from "multer";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  generatePaper,
  getPapers,
  getPaperById,
  getPaperPDF,
  getAnalysis,
  validatePaperAnalysis,
  detectSubjectsFromPDF,
  extractUnitsFromPDF,
  analyzePaperPDFController,
  validateUploadedPaper,
  deletePaper,
} from "../controllers/paperController.js";

const router = Router();

// Configure multer for in-memory file uploads (max 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed."), false);
    }
  },
});

// All paper routes require authentication
router.use(authMiddleware);

// POST /api/papers/generate — generate a new question paper (multipart form)
router.post("/generate", upload.single("syllabus_pdf"), generatePaper);

// POST /api/papers/detect-subjects — detect subjects from syllabus PDF
router.post("/detect-subjects", upload.single("syllabus_pdf"), detectSubjectsFromPDF);

// POST /api/papers/extract-units — extract units from syllabus PDF
router.post("/extract-units", upload.single("syllabus_pdf"), extractUnitsFromPDF);

// POST /api/papers/analyze-pdf — analyze an uploaded question paper PDF
router.post("/analyze-pdf", upload.single("syllabus_pdf"), analyzePaperPDFController);

// POST /api/papers/validate-uploaded — AI validation for uploaded (non-DB) papers
router.post("/validate-uploaded", validateUploadedPaper);

// GET  /api/papers        — list all papers for the logged-in user
router.get("/", getPapers);

// GET  /api/papers/:id     — get full paper details
router.get("/:id", getPaperById);

// GET  /api/papers/:id/pdf — download PDF
router.get("/:id/pdf", getPaperPDF);

// GET  /api/papers/:id/analysis — bloom's + CO aggregation
router.get("/:id/analysis", getAnalysis);

// POST /api/papers/:id/validate — AI validation of bloom's + CO
router.post("/:id/validate", validatePaperAnalysis);

// DELETE /api/papers/:id — delete a paper
router.delete("/:id", deletePaper);

export default router;
