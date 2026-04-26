"""
Centralised configuration — loaded once from environment variables.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# ── LLM ───────────────────────────────────────────────────────────
GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
LLM_MODEL: str = os.getenv("LLM_MODEL", "gemini-2.0-flash")

# ── ChromaDB ──────────────────────────────────────────────────────
CHROMA_PERSIST_DIR: str = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")

# ── Server ────────────────────────────────────────────────────────
HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))
