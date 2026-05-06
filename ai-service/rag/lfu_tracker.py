"""
LFU (Least Frequently Used) question tracker.

Tracks how often each question is used as RAG context during paper
generation.  Uses a time-based exponential-decay model so that
frequency counts naturally fade — questions become "fresh" again
after a configurable cooldown window.

Storage: MongoDB collection ``question_usage``
Identifiers: SHA-256 hash of the normalised question text.

Two-layer reset strategy
~~~~~~~~~~~~~~~~~~~~~~~~
1. **Soft decay** (real-time) — ``effective_count`` is computed on
   every lookup using exponential decay.  No DB write needed.
2. **Hard reset** (startup) — records inactive for longer than
   ``LFU_RESET_AFTER_DAYS`` have their ``use_count`` zeroed out.
"""

import hashlib
import logging
import math
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any

from pymongo import MongoClient, ASCENDING
from pymongo.errors import PyMongoError

from config import (
    MONGO_URI,
    LFU_ENABLED,
    LFU_DECAY_HALF_LIFE_DAYS,
    LFU_PENALTY_WEIGHT,
    LFU_RESET_AFTER_DAYS,
    LFU_EFFECTIVE_COUNT_THRESHOLD,
    LFU_MAX_EXPECTED_USES,
)

logger = logging.getLogger(__name__)

COLLECTION_NAME = "question_usage"

# ── Singleton MongoDB connection ─────────────────────────────────

_client: Optional[MongoClient] = None
_collection = None


def _get_collection():
    """Return (and lazily create) the ``question_usage`` collection handle."""
    global _client, _collection

    if _collection is not None:
        return _collection

    try:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        _client.admin.command("ping")

        db = _client.get_default_database()
        _collection = db[COLLECTION_NAME]

        # Ensure indexes exist (idempotent)
        _collection.create_index(
            [("question_hash", ASCENDING)], unique=True, background=True
        )
        _collection.create_index([("subject", ASCENDING)], background=True)
        _collection.create_index([("last_used_at", ASCENDING)], background=True)

        logger.info("LFU tracker connected to MongoDB — collection: %s", COLLECTION_NAME)
        return _collection

    except PyMongoError as exc:
        logger.error("LFU tracker — MongoDB connection failed: %s", exc)
        return None


# ── Helpers ───────────────────────────────────────────────────────

def _hash_text(text: str) -> str:
    """Return a stable SHA-256 hex digest of the normalised question text."""
    normalised = " ".join(text.lower().split())
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()


def _effective_count(use_count: int, last_used_at: datetime) -> float:
    """
    Compute the *decayed* usage count.

    Uses exponential decay:
        effective = use_count × 0.5 ^ (days_elapsed / half_life)

    After ~4 half-lives the effective count is < 7 % of the raw count,
    and the question is treated as fresh when below the configured
    threshold.
    """
    now = datetime.now(timezone.utc)
    elapsed = (now - last_used_at).total_seconds() / 86_400  # days
    if elapsed < 0:
        elapsed = 0
    decay = math.pow(0.5, elapsed / max(LFU_DECAY_HALF_LIFE_DAYS, 0.01))
    return use_count * decay


# ── Public API ────────────────────────────────────────────────────

def get_usage_scores(
    question_texts: List[str],
    subject: Optional[str] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Look up LFU data for a list of question texts.

    Returns a dict keyed by **question text** (not hash) with values::

        {
            "use_count":      <int>,     # raw count stored in DB
            "effective_count": <float>,   # decayed count
            "last_used_at":   <datetime>,
        }

    Questions not yet tracked are omitted (i.e. they are "fresh").
    """
    if not LFU_ENABLED or not question_texts:
        return {}

    col = _get_collection()
    if col is None:
        return {}

    hashes = {_hash_text(t): t for t in question_texts}

    try:
        cursor = col.find(
            {"question_hash": {"$in": list(hashes.keys())}},
            {"question_hash": 1, "use_count": 1, "last_used_at": 1, "_id": 0},
        )

        result: Dict[str, Dict[str, Any]] = {}
        for doc in cursor:
            h = doc["question_hash"]
            text = hashes.get(h)
            if text is None:
                continue

            raw_count = doc.get("use_count", 0)
            last_used = doc.get("last_used_at", datetime.now(timezone.utc))
            if last_used.tzinfo is None:
                last_used = last_used.replace(tzinfo=timezone.utc)

            eff = _effective_count(raw_count, last_used)
            result[text] = {
                "use_count": raw_count,
                "effective_count": eff,
                "last_used_at": last_used,
            }

        return result

    except PyMongoError as exc:
        logger.warning("LFU get_usage_scores failed: %s", exc)
        return {}


def record_usage(
    question_texts: List[str],
    subject: str = "Unknown",
) -> int:
    """
    Record that these questions were used as RAG context.

    Upserts each question: increments ``use_count`` and updates
    ``last_used_at`` to now.

    Returns the number of records upserted.
    """
    if not LFU_ENABLED or not question_texts:
        return 0

    col = _get_collection()
    if col is None:
        return 0

    now = datetime.now(timezone.utc)
    updated = 0

    for text in question_texts:
        h = _hash_text(text)
        try:
            col.update_one(
                {"question_hash": h},
                {
                    "$inc": {"use_count": 1},
                    "$set": {
                        "last_used_at": now,
                        "question_text": text[:500],  # store truncated for debugging
                        "subject": subject,
                    },
                    "$setOnInsert": {"question_hash": h},
                },
                upsert=True,
            )
            updated += 1
        except PyMongoError as exc:
            logger.warning("LFU record_usage failed for hash %s: %s", h[:12], exc)

    logger.info("LFU tracker — recorded usage for %d questions (subject=%s)", updated, subject)
    return updated


def compute_lfu_penalty(use_count: int, last_used_at: datetime) -> float:
    """
    Compute a FAISS-score penalty multiplier for a question.

    Returns a value ≥ 0:
        0.0  → no penalty (question is fresh / fully decayed)
        >0   → penalty proportional to recency × frequency

    The caller adds this to the FAISS L2 distance so that
    frequently-used questions rank lower (higher distance = worse).
    """
    eff = _effective_count(use_count, last_used_at)

    # Below threshold → treat as completely fresh
    if eff < LFU_EFFECTIVE_COUNT_THRESHOLD:
        return 0.0

    # Logarithmic frequency factor  (0 → 1)
    freq_factor = math.log(1 + eff) / math.log(1 + LFU_MAX_EXPECTED_USES)
    freq_factor = min(freq_factor, 1.0)

    return LFU_PENALTY_WEIGHT * freq_factor


# ── Startup maintenance ──────────────────────────────────────────

def cleanup_stale_records() -> int:
    """
    Hard-reset ``use_count`` for records inactive longer than
    ``LFU_RESET_AFTER_DAYS``.

    Intended to be called once on startup to keep the collection tidy.
    Returns the number of records reset.
    """
    if not LFU_ENABLED:
        logger.info("LFU tracker is disabled — skipping cleanup")
        return 0

    col = _get_collection()
    if col is None:
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=LFU_RESET_AFTER_DAYS)

    try:
        result = col.update_many(
            {"last_used_at": {"$lt": cutoff}, "use_count": {"$gt": 0}},
            {"$set": {"use_count": 0}},
        )
        reset_count = result.modified_count
        logger.info(
            "LFU cleanup — hard-reset %d stale records (inactive > %d days)",
            reset_count,
            LFU_RESET_AFTER_DAYS,
        )
        return reset_count

    except PyMongoError as exc:
        logger.error("LFU cleanup failed: %s", exc)
        return 0


def get_stats() -> Dict[str, Any]:
    """Return summary statistics for the ``/health`` endpoint."""
    col = _get_collection()
    if col is None:
        return {"lfu_enabled": LFU_ENABLED, "status": "disconnected"}

    try:
        total = col.count_documents({})
        active = col.count_documents({"use_count": {"$gt": 0}})
        return {
            "lfu_enabled": LFU_ENABLED,
            "status": "connected",
            "total_tracked": total,
            "active_questions": active,
            "stale_questions": total - active,
            "decay_half_life_days": LFU_DECAY_HALF_LIFE_DAYS,
            "reset_after_days": LFU_RESET_AFTER_DAYS,
        }
    except PyMongoError:
        return {"lfu_enabled": LFU_ENABLED, "status": "error"}
