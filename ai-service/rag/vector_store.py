"""
FAISS vector store for the question bank.

Stores questions with metadata (subject, marks, difficulty, topic) and
supports similarity search with optional subject post-filtering.

On startup, all questions from MongoDB are synced into the FAISS index.
New questions are added incrementally after each paper generation.
"""

import logging
import os
import json
from typing import List, Optional, Dict, Any

from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_core.documents import Document

from config import FAISS_INDEX_DIR, MONGO_URI

logger = logging.getLogger(__name__)

# ── Offline Embedding Model ──────────────────────────────────────
# Uses sentence-transformers/all-MiniLM-L6-v2 — runs 100% locally
# on CPU, no API key needed, ~80MB download on first use (cached).
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

# ── Singleton vector store instance ──────────────────────────────

_store: Optional[FAISS] = None
_embeddings: Optional[HuggingFaceEmbeddings] = None


def _get_embeddings() -> HuggingFaceEmbeddings:
    """Return the local embedding model instance (cached)."""
    global _embeddings
    if _embeddings is None:
        logger.info("Loading offline embedding model: %s", EMBEDDING_MODEL)
        _embeddings = HuggingFaceEmbeddings(
            model_name=EMBEDDING_MODEL,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
        logger.info("Embedding model loaded successfully")
    return _embeddings


def _index_path() -> str:
    """Return the FAISS index directory path."""
    return FAISS_INDEX_DIR


def get_store() -> Optional[FAISS]:
    """Return (and lazily load) the FAISS vector store. May be None if empty."""
    global _store
    if _store is None:
        index_dir = _index_path()
        if os.path.exists(os.path.join(index_dir, "index.faiss")):
            logger.info("Loading persisted FAISS index from %s", index_dir)
            _store = FAISS.load_local(
                index_dir,
                _get_embeddings(),
                allow_dangerous_deserialization=True,
            )
            logger.info("FAISS index loaded — %d vectors", _store.index.ntotal)
        else:
            logger.info("No persisted FAISS index found at %s — store is empty", index_dir)
    return _store


def _save_store() -> None:
    """Persist the FAISS index to disk."""
    if _store is not None:
        index_dir = _index_path()
        os.makedirs(index_dir, exist_ok=True)
        _store.save_local(index_dir)
        logger.info("FAISS index saved to %s (%d vectors)", index_dir, _store.index.ntotal)


# ── Public helpers ────────────────────────────────────────────────

def add_questions(questions: List[Dict[str, Any]]) -> int:
    """
    Add questions to the FAISS vector store.

    Each question dict should have at least:
      - text (str):     the question text
      - subject (str):  subject name

    Optional metadata fields: marks, difficulty, topic.

    Returns the number of questions added.
    """
    global _store

    if not questions:
        return 0

    documents: List[Document] = []
    for q in questions:
        meta: Dict[str, Any] = {"subject": q["subject"]}
        if q.get("marks") is not None:
            meta["marks"] = q["marks"]
        if q.get("difficulty"):
            meta["difficulty"] = q["difficulty"]
        if q.get("topic"):
            meta["topic"] = q["topic"]
        documents.append(Document(page_content=q["text"], metadata=meta))

    embeddings = _get_embeddings()

    if _store is None:
        # Create a new FAISS index from documents
        _store = FAISS.from_documents(documents, embeddings)
        logger.info("Created new FAISS index with %d documents", len(documents))
    else:
        # Add to existing index
        _store.add_documents(documents)
        logger.info("Added %d documents to existing FAISS index", len(documents))

    # Persist to disk
    _save_store()

    return len(documents)


def search(
    query: str,
    top_k: int = 5,
    subject: Optional[str] = None,
    apply_lfu: bool = False,
) -> List[Dict[str, Any]]:
    """
    Similarity search over the question bank.

    Since FAISS doesn't support native metadata filtering, we over-fetch
    and post-filter by subject when a subject filter is specified.

    When ``apply_lfu=True``, results are re-ranked using the LFU tracker
    so that frequently / recently used questions are penalised and sink
    to the bottom of the list.

    Returns a list of dicts with keys: text, subject, marks, difficulty, topic, score.
    """
    from config import LFU_ENABLED

    store = get_store()
    if store is None:
        logger.warning("FAISS store is empty — no results for search")
        return []

    # Over-fetch more aggressively when LFU re-ranking is active
    if apply_lfu and LFU_ENABLED:
        fetch_k = top_k * 5 if subject else top_k * 3
    else:
        fetch_k = top_k * 3 if subject else top_k

    try:
        results = store.similarity_search_with_score(query, k=fetch_k)
    except Exception as e:
        logger.error("FAISS search failed: %s", e)
        return []

    # ── Step 1: Subject post-filtering ──────────────────────────
    candidates: List[Dict[str, Any]] = []
    for doc, score in results:
        if subject and doc.metadata.get("subject", "").lower() != subject.lower():
            continue

        candidates.append({
            "text": doc.page_content,
            "subject": doc.metadata.get("subject", ""),
            "marks": doc.metadata.get("marks"),
            "difficulty": doc.metadata.get("difficulty"),
            "topic": doc.metadata.get("topic"),
            "score": round(float(score), 4),
        })

    # ── Step 2: LFU re-ranking ──────────────────────────────────
    if apply_lfu and LFU_ENABLED and candidates:
        try:
            from rag.lfu_tracker import get_usage_scores, compute_lfu_penalty

            texts = [c["text"] for c in candidates]
            usage_map = get_usage_scores(texts, subject=subject)

            for entry in candidates:
                usage = usage_map.get(entry["text"])
                if usage:
                    penalty = compute_lfu_penalty(
                        usage["use_count"], usage["last_used_at"]
                    )
                    entry["lfu_penalty"] = round(penalty, 4)
                    entry["effective_count"] = round(usage["effective_count"], 2)
                    # Higher score = worse match in FAISS L2, so add penalty
                    entry["score"] = round(entry["score"] + penalty, 4)
                else:
                    entry["lfu_penalty"] = 0.0
                    entry["effective_count"] = 0.0

            # Re-sort by adjusted score (lower = better)
            candidates.sort(key=lambda x: x["score"])

            logger.info(
                "LFU re-ranking applied — %d candidates, %d had penalties",
                len(candidates),
                sum(1 for c in candidates if c.get("lfu_penalty", 0) > 0),
            )
        except Exception as e:
            logger.warning("LFU re-ranking failed (using raw FAISS order): %s", e)

    # ── Step 3: Trim to top_k ───────────────────────────────────
    return candidates[:top_k]


# ── MongoDB → FAISS Sync ─────────────────────────────────────────

def sync_from_mongodb() -> int:
    """
    Load all questions from MongoDB's 'questions' collection into FAISS.

    This runs once at startup to ensure the FAISS index is populated
    with all existing questions from the database.

    Returns the number of questions synced.
    """
    global _store

    try:
        from pymongo import MongoClient

        logger.info("Connecting to MongoDB at %s for FAISS sync...", MONGO_URI)
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)

        # Force a connection check
        client.admin.command("ping")
        logger.info("MongoDB connection successful")

        db = client.get_default_database()
        collection = db["questions"]

        # Fetch all questions
        cursor = collection.find({}, {"text": 1, "subject": 1, "marks": 1, "difficulty": 1, "topic": 1})
        questions = list(cursor)
        client.close()

        if not questions:
            logger.info("No questions found in MongoDB — FAISS index will remain empty")
            return 0

        logger.info("Found %d questions in MongoDB — syncing to FAISS...", len(questions))

        # Build documents
        documents: List[Document] = []
        for q in questions:
            text = q.get("text", "").strip()
            if not text:
                continue

            meta: Dict[str, Any] = {"subject": q.get("subject", "Unknown")}
            if q.get("marks") is not None:
                meta["marks"] = q["marks"]
            if q.get("difficulty"):
                meta["difficulty"] = q["difficulty"]
            if q.get("topic"):
                meta["topic"] = q["topic"]

            documents.append(Document(page_content=text, metadata=meta))

        if not documents:
            logger.info("No valid question texts found in MongoDB")
            return 0

        # Create FAISS index from all documents
        embeddings = _get_embeddings()
        _store = FAISS.from_documents(documents, embeddings)
        logger.info("FAISS index created with %d documents from MongoDB", len(documents))

        # Persist to disk
        _save_store()

        return len(documents)

    except Exception as e:
        logger.error("MongoDB → FAISS sync failed: %s", e)
        logger.info("AI service will continue without pre-loaded questions. "
                     "Questions can be added via /add-questions endpoint.")
        return 0
