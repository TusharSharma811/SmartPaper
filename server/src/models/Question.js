import mongoose from "mongoose";

// ── Standalone Question schema (for seeded / manually added questions) ──
const questionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    subject: { type: String, required: true, index: true },
    marks: { type: Number, default: null },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    topic: { type: String, default: null },
    bloom_level: {
      type: String,
      enum: ["K1", "K2", "K3", "K4", "K5", "K6"],
      default: null,
    },
    co: { type: Number, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Question", questionSchema);
