"""
Centralised configuration — loaded once from environment variables.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# ── LLM ───────────────────────────────────────────────────────────
GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
LLM_MODEL: str = os.getenv("LLM_MODEL", "gemini-2.0-flash")

# ── FAISS Vector Store ───────────────────────────────────────────
FAISS_INDEX_DIR: str = os.getenv("FAISS_INDEX_DIR", "./faiss_index")

# ── MongoDB (for syncing questions into FAISS) ───────────────────
MONGO_URI: str = os.getenv("MONGO_URI", "mongodb://localhost:27017/ai_question_paper")

# ── Hugging Face (paraphrasing) ──────────────────────────────────
HUGGINGFACE_API_KEY: str = os.getenv("HUGGINGFACE_API_KEY", "")
PARAPHRASE_MODEL: str = os.getenv("PARAPHRASE_MODEL", "")

# ── Server ────────────────────────────────────────────────────────
HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))

# ── LFU Question Deduplication ───────────────────────────────────
LFU_ENABLED: bool = os.getenv("LFU_ENABLED", "true").lower() in ("true", "1", "yes")
LFU_DECAY_HALF_LIFE_DAYS: float = float(os.getenv("LFU_DECAY_HALF_LIFE_DAYS", "7"))
LFU_PENALTY_WEIGHT: float = float(os.getenv("LFU_PENALTY_WEIGHT", "0.5"))
LFU_RESET_AFTER_DAYS: int = int(os.getenv("LFU_RESET_AFTER_DAYS", "30"))
LFU_EFFECTIVE_COUNT_THRESHOLD: float = float(os.getenv("LFU_EFFECTIVE_COUNT_THRESHOLD", "0.3"))
LFU_MAX_EXPECTED_USES: int = int(os.getenv("LFU_MAX_EXPECTED_USES", "20"))
