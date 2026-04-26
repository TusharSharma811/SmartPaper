"""
POST /validate-analysis - use AI to validate Bloom's level and CO assignments.

Sends the full question paper data to Gemini and asks it to verify
whether each question's bloom_level and CO are correctly assigned.
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from google import genai

from config import GOOGLE_API_KEY, LLM_MODEL

logger = logging.getLogger(__name__)

router = APIRouter()
BLOOM_LEVELS = {"K1", "K2", "K3", "K4", "K5", "K6"}


class SubQuestionIn(BaseModel):
    label: str
    text: str
    marks: int
    difficulty: Optional[str] = None
    topic: Optional[str] = None
    bloom_level: Optional[str] = None
    co: Optional[Any] = None


class ChoiceOptionIn(BaseModel):
    label: str
    text: str
    marks: int
    difficulty: Optional[str] = None
    topic: Optional[str] = None
    bloom_level: Optional[str] = None
    co: Optional[Any] = None


class QuestionIn(BaseModel):
    question_id: int
    type: str
    marks: int
    subquestions: Optional[List[SubQuestionIn]] = None
    options: Optional[List[ChoiceOptionIn]] = None


class SectionIn(BaseModel):
    section_id: str
    title: str
    questions: List[QuestionIn]


class ValidateRequest(BaseModel):
    subject: str = Field(..., description="Subject name")
    sections: List[SectionIn] = Field(..., description="Full paper sections")


class CorrectionItem(BaseModel):
    question_id: int
    sub_label: str
    question_text: str
    current_bloom: Optional[str] = None
    suggested_bloom: Optional[str] = None
    bloom_correct: bool = True
    bloom_reason: Optional[str] = None
    current_co: Optional[int] = None
    suggested_co: Optional[int] = None
    co_correct: bool = True
    co_reason: Optional[str] = None


class ValidateResponse(BaseModel):
    overall_valid: bool
    total_questions: int
    issues_found: int
    corrections: List[CorrectionItem]
    summary: str


def _normalize_label(value: Any) -> str:
    return str(value or "").strip()


def _normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _normalize_int(value: Any) -> Optional[int]:
    if value in (None, "") or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)

    match = re.search(r"\d+", str(value))
    return int(match.group(0)) if match else None


def _normalize_bloom(value: Any) -> Optional[str]:
    text = str(value or "").strip().upper()
    if not text:
        return None
    if text in BLOOM_LEVELS:
        return text

    match = re.search(r"\bK?\s*([1-6])\b", text)
    if match:
        return f"K{match.group(1)}"
    return None


def _normalize_co(value: Any) -> Optional[int]:
    if value in (None, "") or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)

    match = re.search(r"\b(?:CO)?\s*([1-9]\d*)\b", str(value).strip(), re.IGNORECASE)
    return int(match.group(1)) if match else None


def _coerce_bool(value: Any, default: Optional[bool] = None) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"true", "yes", "y", "correct"}:
            return True
        if text in {"false", "no", "n", "incorrect"}:
            return False
    return default


def _correction_key(question_id: int, sub_label: str) -> str:
    return f"{question_id}:{_normalize_label(sub_label).lower()}"


def _collect_leaf_questions(sections: List[SectionIn]) -> List[Dict[str, Any]]:
    """
    Flatten the paper into the actual question leaves that carry CO/Bloom data.

    This keeps validation aligned with the charting and preview layers, and makes
    single, subpart, and uploaded paper shapes work through the same path.
    """
    leaf_questions: List[Dict[str, Any]] = []

    for section in sections:
        for question in section.questions:
            items: List[Any] = list(question.subquestions or [])
            if question.type == "single" and items:
                items = items[:1]
            elif question.type == "choice_group" and not items:
                items = list(question.options or [])

            for index, item in enumerate(items):
                label = _normalize_label(getattr(item, "label", "")) or (
                    str(question.question_id)
                    if question.type == "single" and index == 0
                    else chr(97 + index)
                )
                question_text = _normalize_text(getattr(item, "text", ""))
                if not question_text:
                    continue

                question_id = int(question.question_id)
                leaf_questions.append({
                    "key": _correction_key(question_id, label),
                    "ref": f"Q{question_id}-{label}",
                    "question_id": question_id,
                    "sub_label": label,
                    "question_text": question_text,
                    "marks": int(getattr(item, "marks", None) or question.marks or 0),
                    "current_bloom": _normalize_bloom(getattr(item, "bloom_level", None)),
                    "current_co": _normalize_co(getattr(item, "co", None)),
                    "section_id": section.section_id,
                    "topic": _normalize_text(getattr(item, "topic", "")) or None,
                    "difficulty": _normalize_text(getattr(item, "difficulty", "")) or None,
                })

    return leaf_questions


def _build_questions_text(leaf_questions: List[Dict[str, Any]]) -> str:
    """Build the prompt body from normalized leaf questions."""
    lines = []
    for item in leaf_questions:
        details = [
            f"section={item['section_id']}",
            f"{item['marks']}m",
            f"bloom={item['current_bloom'] or 'NONE'}",
            f"co={item['current_co'] if item['current_co'] is not None else 'NONE'}",
        ]
        if item["topic"]:
            details.append(f"topic={item['topic']}")
        if item["difficulty"]:
            details.append(f"difficulty={item['difficulty']}")

        lines.append(
            f'{item["ref"]}: "{item["question_text"]}" [{", ".join(details)}]'
        )
    return "\n".join(lines)


def _parse_json_response(raw_text: Any) -> Any:
    """Parse JSON from the model response, handling fenced or noisy text."""
    if isinstance(raw_text, (dict, list)):
        return raw_text

    text = str(raw_text or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text[:-3].strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def _resolve_correction(raw_item: Dict[str, Any], source_item: Dict[str, Any]) -> CorrectionItem:
    current_bloom = _normalize_bloom(raw_item.get("current_bloom")) or source_item["current_bloom"]
    suggested_bloom = _normalize_bloom(raw_item.get("suggested_bloom"))
    current_co = _normalize_co(raw_item.get("current_co"))
    if current_co is None:
        current_co = source_item["current_co"]
    suggested_co = _normalize_co(raw_item.get("suggested_co"))

    bloom_correct = _coerce_bool(raw_item.get("bloom_correct"))
    if bloom_correct is None:
        bloom_correct = suggested_bloom in (None, current_bloom)
    if bloom_correct and suggested_bloom == current_bloom:
        suggested_bloom = None

    co_correct = _coerce_bool(raw_item.get("co_correct"))
    if co_correct is None:
        co_correct = suggested_co in (None, current_co)
    if co_correct and suggested_co == current_co:
        suggested_co = None

    return CorrectionItem(
        question_id=source_item["question_id"],
        sub_label=source_item["sub_label"],
        question_text=source_item["question_text"],
        current_bloom=current_bloom,
        suggested_bloom=suggested_bloom,
        bloom_correct=bloom_correct,
        bloom_reason=_normalize_text(raw_item.get("bloom_reason")) or None,
        current_co=current_co,
        suggested_co=suggested_co,
        co_correct=co_correct,
        co_reason=_normalize_text(raw_item.get("co_reason")) or None,
    )


def _default_correction(source_item: Dict[str, Any]) -> CorrectionItem:
    return CorrectionItem(
        question_id=source_item["question_id"],
        sub_label=source_item["sub_label"],
        question_text=source_item["question_text"],
        current_bloom=source_item["current_bloom"],
        suggested_bloom=None,
        bloom_correct=True,
        bloom_reason="No change suggested by AI.",
        current_co=source_item["current_co"],
        suggested_co=None,
        co_correct=True,
        co_reason="No change suggested by AI.",
    )


@router.post("/validate-analysis", response_model=ValidateResponse)
async def validate_analysis(req: ValidateRequest):
    """
    Validate Bloom's taxonomy levels and CO assignments for each question
    using the Gemini LLM.
    """
    try:
        leaf_questions = _collect_leaf_questions(req.sections)
        questions_text = _build_questions_text(leaf_questions)

        if not questions_text.strip():
            return ValidateResponse(
                overall_valid=True,
                total_questions=0,
                issues_found=0,
                corrections=[],
                summary="No questions found to validate.",
            )

        system_text = (
            "You are an expert academic quality assurance reviewer.\n"
            "Your task is to verify whether each question in an exam paper has the "
            "correct Bloom's taxonomy level (K1-K6) and Course Outcome (CO) assignment.\n\n"
            "Bloom's Taxonomy Levels:\n"
            "  K1 = Remember (recall facts, definitions)\n"
            "  K2 = Understand (explain, describe, interpret)\n"
            "  K3 = Apply (use knowledge in new situations, solve problems)\n"
            "  K4 = Analyse (break down, compare, differentiate)\n"
            "  K5 = Evaluate (justify, critique, assess)\n"
            "  K6 = Create (design, construct, produce something new)\n\n"
            "CO Assignment Rules:\n"
            "  - CO numbers should logically group questions by the learning outcome they assess\n"
            "  - Related topics and concepts should share the same CO\n"
            "  - Each CO should cover a coherent area of the syllabus\n\n"
            "You must return exactly one result object for every question provided.\n"
            "If the current assignment is correct, keep bloom_correct/co_correct as true "
            "and set the corresponding suggested value to null.\n"
            "If the current assignment is incorrect, provide the suggested correct value "
            "and a brief reason.\n"
            "Keep question_id and sub_label exactly the same as provided.\n\n"
            "Return only valid JSON with this structure:\n"
            "{\n"
            '  "corrections": [\n'
            "    {\n"
            '      "question_id": 1,\n'
            '      "sub_label": "a",\n'
            '      "question_text": "...",\n'
            '      "current_bloom": "K1",\n'
            '      "suggested_bloom": "K2",\n'
            '      "bloom_correct": false,\n'
            '      "bloom_reason": "This question asks to explain, not just recall",\n'
            '      "current_co": 1,\n'
            '      "suggested_co": 2,\n'
            '      "co_correct": false,\n'
            '      "co_reason": "This topic aligns with a different learning outcome"\n'
            "    }\n"
            "  ],\n"
            '  "summary": "Brief overall assessment of the paper\'s bloom/CO assignments"\n'
            "}"
        )

        required_refs = ", ".join(item["ref"] for item in leaf_questions)
        human_text = (
            f"Subject: {req.subject}\n\n"
            f"Questions to validate:\n{questions_text}\n\n"
            "Analyze each question above and check whether the assigned Bloom level "
            "and CO are correct. Return corrections for all questions.\n"
            f"Required question keys (do not omit any): {required_refs}"
        )

        logger.info(
            "Validating CO/Bloom assignments for %s (%d questions)",
            req.subject,
            len(leaf_questions),
        )

        client = genai.Client(api_key=GOOGLE_API_KEY)
        response = client.models.generate_content(
            model=LLM_MODEL,
            contents=[human_text],
            config=genai.types.GenerateContentConfig(
                system_instruction=system_text,
                temperature=0.2,
                response_mime_type="application/json",
                max_output_tokens=8192,
            ),
        )

        result = _parse_json_response(getattr(response, "text", None) or response)
        if isinstance(result, list):
            result = {"corrections": result, "summary": "Validation complete."}

        corrections_raw = result.get("corrections", [])
        if not corrections_raw:
            raise HTTPException(
                status_code=500,
                detail="AI did not return any validation results.",
            )

        by_key = {item["key"]: item for item in leaf_questions}
        by_question_id: Dict[int, List[Dict[str, Any]]] = {}
        for item in leaf_questions:
            by_question_id.setdefault(item["question_id"], []).append(item)

        matched: Dict[str, CorrectionItem] = {}
        for raw_item in corrections_raw:
            if not isinstance(raw_item, dict):
                continue

            question_id = _normalize_int(raw_item.get("question_id"))
            sub_label = _normalize_label(raw_item.get("sub_label"))
            source_item = None

            if question_id is not None and sub_label:
                source_item = by_key.get(_correction_key(question_id, sub_label))

            if source_item is None and question_id is not None:
                candidates = by_question_id.get(question_id, [])
                if len(candidates) == 1:
                    source_item = candidates[0]
                elif raw_item.get("question_text"):
                    raw_text = _normalize_text(raw_item.get("question_text")).lower()
                    for candidate in candidates:
                        if candidate["question_text"].lower() == raw_text:
                            source_item = candidate
                            break

            if source_item is None:
                continue

            matched[source_item["key"]] = _resolve_correction(raw_item, source_item)

        if not matched:
            raise HTTPException(
                status_code=500,
                detail="AI returned validation results, but they could not be matched to the paper questions.",
            )

        corrections: List[CorrectionItem] = []
        missing_count = 0
        for item in leaf_questions:
            correction = matched.get(item["key"])
            if correction is None:
                missing_count += 1
                correction = _default_correction(item)
            corrections.append(correction)

        issues = sum(1 for item in corrections if not item.bloom_correct or not item.co_correct)
        summary = _normalize_text(result.get("summary")) or "Validation complete."
        if missing_count:
            summary += (
                f" Detailed feedback was unavailable for {missing_count} question(s), "
                "so their current assignments were retained."
            )

        return ValidateResponse(
            overall_valid=issues == 0,
            total_questions=len(corrections),
            issues_found=issues,
            corrections=corrections,
            summary=summary,
        )

    except json.JSONDecodeError as exc:
        logger.error("Failed to parse validation response: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="AI returned invalid JSON for validation.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Validation failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Validation failed: {str(exc)}")
