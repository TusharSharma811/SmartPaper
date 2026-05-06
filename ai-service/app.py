"""
FastAPI entry point for the AI Question Paper Generator service.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import generate, questions, validate, units, analyze_pdf

logger = logging.getLogger(__name__)


# ── Startup / Shutdown ────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run MongoDB → FAISS sync and LFU cleanup on startup."""
    from rag.vector_store import sync_from_mongodb
    from rag.lfu_tracker import cleanup_stale_records

    logger.info("Starting MongoDB → FAISS sync...")
    count = sync_from_mongodb()
    logger.info("FAISS sync complete — %d questions loaded", count)

    logger.info("Running LFU stale-record cleanup...")
    reset_count = cleanup_stale_records()
    logger.info("LFU cleanup complete — %d records hard-reset", reset_count)

    yield  # App is running

    logger.info("AI service shutting down")


app = FastAPI(
    title="AI Question Paper Generator",
    description="RAG-powered question paper generation using LangChain + Google Gemini + FAISS",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────
app.include_router(generate.router)

app.include_router(questions.router)
app.include_router(validate.router)
app.include_router(units.router)
app.include_router(analyze_pdf.router)


# ── Health Check ──────────────────────────────────────────────────
@app.get("/health")
async def health_check():
    from rag.vector_store import get_store
    from rag.lfu_tracker import get_stats as lfu_stats

    store = get_store()
    vector_count = store.index.ntotal if store else 0

    return {
        "status": "ok",
        "service": "ai-question-paper-generator",
        "vector_store": "faiss",
        "vector_count": vector_count,
        "lfu": lfu_stats(),
    }


# ── Run with: uvicorn app:app --reload --port 8000 ───────────────
if __name__ == "__main__":
    import uvicorn
    from config import HOST, PORT

    logging.basicConfig(level=logging.INFO)
    uvicorn.run("app:app", host=HOST, port=PORT, reload=True)
