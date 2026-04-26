import { addQuestions, searchQuestions } from "../services/aiService.js";
import Question from "../models/Question.js";
import logger from "../utils/logger.js";

/**
 * @desc    Add questions to the question bank (MongoDB + ChromaDB vector store)
 * @route   POST /api/questions/add
 * @access  Private
 */
export const addQuestionsToBank = async (req, res, next) => {
  try {
    const { questions } = req.body;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      res.status(400);
      throw new Error("Please provide an array of questions");
    }

    // Basic validation on question objects
    for (const q of questions) {
      if (!q.text || !q.subject) {
        res.status(400);
        throw new Error("Each question must have text and a subject");
      }
    }

    logger.info(`User ${req.user?._id || "unknown"} is contributing ${questions.length} questions`);

    // 1. Save to MongoDB (persistent store)
    const mongoDocs = questions.map((q) => ({
      text: q.text,
      subject: q.subject,
      marks: q.marks || null,
      difficulty: q.difficulty || "medium",
      topic: q.topic || null,
      bloom_level: q.bloom_level || null,
      co: q.co || null,
    }));
    await Question.insertMany(mongoDocs, { ordered: false });
    logger.info(`Saved ${mongoDocs.length} contributed questions to MongoDB`);

    // 2. Push to ChromaDB vector store (for RAG)
    const result = await addQuestions(questions);

    res.status(200).json({
      success: true,
      message: result.message || "Questions successfully contributed to the bank",
      added: result.added,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Search the question bank vector store
 * @route   GET /api/questions/search
 * @access  Private
 */
export const searchQuestionBank = async (req, res, next) => {
  try {
    const { query, top_k, subject } = req.query;

    if (!query) {
      res.status(400);
      throw new Error("Search query is required");
    }

    const topKNumber = top_k ? parseInt(top_k, 10) : 5;

    logger.info(`User ${req.user?._id || "unknown"} is searching for: "${query}"`);

    const result = await searchQuestions(query, topKNumber, subject);

    res.status(200).json({
      success: true,
      query: result.query,
      total: result.total,
      results: result.results || [],
    });
  } catch (error) {
    next(error);
  }
};
