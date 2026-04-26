"""
Hugging Face paraphrasing layer for generated question texts.
"""

import logging
import re
from typing import Any, Dict, List, Optional, Sequence

from config import (
    ENABLE_HF_PARAPHRASER,
    HF_PARAPHRASER_BATCH_SIZE,
    HF_PARAPHRASER_MAX_NEW_TOKENS,
    HF_PARAPHRASER_MIN_INPUT_CHARS,
    HF_PARAPHRASER_MODEL,
)

logger = logging.getLogger(__name__)

ACADEMIC_VERBS = {
    "analyze",
    "analyse",
    "apply",
    "calculate",
    "classify",
    "compare",
    "construct",
    "define",
    "derive",
    "describe",
    "design",
    "differentiate",
    "discuss",
    "distinguish",
    "evaluate",
    "explain",
    "illustrate",
    "interpret",
    "justify",
    "list",
    "outline",
    "prove",
    "show",
    "solve",
    "state",
    "trace",
    "write",
}

_PARAPHRASER_PIPELINE = None
_PARAPHRASER_UNAVAILABLE = False


def _normalize_text(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "").strip())


def _extract_numbers(text: str) -> List[str]:
    return re.findall(r"\d+(?:\.\d+)?", text)


def _extract_leading_verb(text: str) -> Optional[str]:
    match = re.match(r"^\s*([A-Za-z][A-Za-z-]*)", text)
    if not match:
        return None

    verb = match.group(1).lower()
    return verb if verb in ACADEMIC_VERBS else None


def _get_pipeline():
    global _PARAPHRASER_PIPELINE, _PARAPHRASER_UNAVAILABLE

    if _PARAPHRASER_PIPELINE is not None:
        return _PARAPHRASER_PIPELINE
    if _PARAPHRASER_UNAVAILABLE:
        return None

    try:
        from transformers import pipeline

        _PARAPHRASER_PIPELINE = pipeline(
            "text2text-generation",
            model=HF_PARAPHRASER_MODEL,
            tokenizer=HF_PARAPHRASER_MODEL,
            device=-1,
        )
        logger.info("Loaded Hugging Face paraphraser: %s", HF_PARAPHRASER_MODEL)
        return _PARAPHRASER_PIPELINE
    except Exception as exc:
        _PARAPHRASER_UNAVAILABLE = True
        logger.warning("Hugging Face paraphraser unavailable: %s", exc)
        return None


def _should_attempt(text: str) -> bool:
    return len(text) >= HF_PARAPHRASER_MIN_INPUT_CHARS and len(text.split()) >= 4


def _build_prompt(text: str) -> str:
    return f"paraphrase: {text} </s>"


def _finalize_candidate(original: str, candidate: str) -> str:
    if original.endswith("?") and not candidate.endswith("?"):
        return candidate.rstrip(".") + "?"
    return candidate


def _is_safe_paraphrase(original: str, candidate: str) -> bool:
    if not candidate:
        return False

    original_text = _normalize_text(original)
    candidate_text = _normalize_text(candidate)

    if not candidate_text or candidate_text.lower() == original_text.lower():
        return False

    length_ratio = len(candidate_text) / max(len(original_text), 1)
    if length_ratio < 0.55 or length_ratio > 1.85:
        return False

    original_numbers = set(_extract_numbers(original_text))
    candidate_numbers = set(_extract_numbers(candidate_text))
    if not original_numbers.issubset(candidate_numbers):
        return False

    original_verb = _extract_leading_verb(original_text)
    candidate_verb = _extract_leading_verb(candidate_text)
    if original_verb and candidate_verb and original_verb != candidate_verb:
        return False

    if original_text.endswith("?") and not candidate_text.endswith("?"):
        return False

    return True


def paraphrase_texts(texts: Sequence[str]) -> List[str]:
    """
    Paraphrase a list of question texts while preserving the original meaning.
    """
    normalized = [_normalize_text(text) for text in texts]
    if not ENABLE_HF_PARAPHRASER:
        return normalized

    paraphraser = _get_pipeline()
    if paraphraser is None:
        return normalized

    prompts: List[str] = []
    prompt_indexes: List[int] = []
    output_texts = list(normalized)

    for index, text in enumerate(normalized):
        if not _should_attempt(text):
            continue
        prompts.append(_build_prompt(text))
        prompt_indexes.append(index)

    if not prompts:
        return output_texts

    try:
        generations = paraphraser(
            prompts,
            batch_size=HF_PARAPHRASER_BATCH_SIZE,
            max_new_tokens=HF_PARAPHRASER_MAX_NEW_TOKENS,
            do_sample=False,
            num_beams=4,
            repetition_penalty=1.15,
            clean_up_tokenization_spaces=True,
            truncation=True,
        )
    except Exception as exc:
        logger.warning("Hugging Face paraphrasing failed: %s", exc)
        return output_texts

    for index, generation in zip(prompt_indexes, generations):
        item = generation[0] if isinstance(generation, list) else generation
        candidate = _normalize_text(item.get("generated_text", ""))
        if _is_safe_paraphrase(output_texts[index], candidate):
            output_texts[index] = _finalize_candidate(output_texts[index], candidate)

    return output_texts


def paraphrase_generated_paper(paper: Dict[str, Any]) -> Dict[str, Any]:
    """
    Apply paraphrasing to generated question text fields in-place.
    """
    if not ENABLE_HF_PARAPHRASER:
        return paper

    nodes: List[Dict[str, Any]] = []
    for section in paper.get("sections", []):
        for question in section.get("questions", []):
            for field in ("subquestions", "options"):
                for item in question.get(field, []) or []:
                    if isinstance(item, dict) and item.get("text"):
                        nodes.append(item)

    if not nodes:
        return paper

    original_texts = [item.get("text", "") for item in nodes]
    paraphrased_texts = paraphrase_texts(original_texts)

    updated = 0
    for item, original, paraphrased in zip(nodes, original_texts, paraphrased_texts):
        if _normalize_text(original) != paraphrased:
            item["text"] = paraphrased
            updated += 1

    logger.info(
        "Hugging Face paraphrasing processed %d question texts (%d updated)",
        len(nodes),
        updated,
    )
    return paper
