"""
Centralised configuration — loaded once from environment variables.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# ── LLM ───────────────────────────────────────────────────────────
GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
LLM_MODEL: str = os.getenv("LLM_MODEL", "gemini-2.0-flash")

# Hugging Face paraphrasing layer
ENABLE_HF_PARAPHRASER: bool = os.getenv("ENABLE_HF_PARAPHRASER", "true").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
HF_PARAPHRASER_MODEL: str = os.getenv(
    "HF_PARAPHRASER_MODEL",
    "Vamsi/T5_Paraphrase_Paws",
)
HF_PARAPHRASER_BATCH_SIZE: int = int(os.getenv("HF_PARAPHRASER_BATCH_SIZE", "4"))
HF_PARAPHRASER_MAX_NEW_TOKENS: int = int(os.getenv("HF_PARAPHRASER_MAX_NEW_TOKENS", "96"))
HF_PARAPHRASER_MIN_INPUT_CHARS: int = int(os.getenv("HF_PARAPHRASER_MIN_INPUT_CHARS", "25"))

# ── ChromaDB ──────────────────────────────────────────────────────
CHROMA_PERSIST_DIR: str = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")

# ── Server ────────────────────────────────────────────────────────
HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))
