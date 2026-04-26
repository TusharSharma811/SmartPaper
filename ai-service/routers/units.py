"""
Subject detection and unit extraction routes for uploaded syllabus PDFs.
"""

import json
import logging
import re
from typing import Any, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from google import genai
from config import GOOGLE_API_KEY, LLM_MODEL

logger = logging.getLogger(__name__)

router = APIRouter()

_client = genai.Client(api_key=GOOGLE_API_KEY)


class UnitItem(BaseModel):
    unit_number: int
    title: str
    topics: List[str]


class DetectedSubjectItem(BaseModel):
    name: str
    subject_code: Optional[str] = None


class DetectSubjectsResponse(BaseModel):
    subjects: List[DetectedSubjectItem] = Field(default_factory=list)
    total_subjects: int
    detected_subject: Optional[str] = None
    detected_subject_code: Optional[str] = None


class ExtractUnitsResponse(BaseModel):
    subject: str
    total_units: int
    units: List[UnitItem]
    detected_subject: Optional[str] = None
    detected_subject_code: Optional[str] = None


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_topics(raw_topics: Any) -> List[str]:
    if isinstance(raw_topics, list):
        return [_normalize_text(topic) for topic in raw_topics if _normalize_text(topic)]
    if isinstance(raw_topics, str):
        return [
            topic
            for topic in (
                _normalize_text(part)
                for part in re.split(r"[,;\n]+", raw_topics)
            )
            if topic
        ]
    return []


def _parse_json_response(raw_text: str) -> dict:
    text = str(raw_text or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text[:-3].strip()
    return json.loads(text)


def _build_units(units_raw: Any) -> List[UnitItem]:
    units: List[UnitItem] = []
    for raw_unit in units_raw or []:
        if not isinstance(raw_unit, dict):
            continue

        unit_number = raw_unit.get("unit_number", len(units) + 1)
        try:
            unit_number = int(unit_number)
        except (TypeError, ValueError):
            unit_number = len(units) + 1

        units.append(UnitItem(
            unit_number=unit_number,
            title=_normalize_text(raw_unit.get("title")) or f"Unit {len(units) + 1}",
            topics=_normalize_topics(raw_unit.get("topics")),
        ))
    return units


def _build_detected_subjects(parsed: dict) -> List[DetectedSubjectItem]:
    subjects: List[DetectedSubjectItem] = []
    raw_subjects = parsed.get("subjects")

    if isinstance(raw_subjects, list):
        for raw_subject in raw_subjects:
            if not isinstance(raw_subject, dict):
                continue

            name = (
                _normalize_text(raw_subject.get("name"))
                or _normalize_text(raw_subject.get("subject"))
                or _normalize_text(raw_subject.get("detected_subject"))
            )
            subject_code = (
                _normalize_text(raw_subject.get("subject_code"))
                or _normalize_text(raw_subject.get("detected_subject_code"))
                or None
            )
            if name:
                subjects.append(DetectedSubjectItem(name=name, subject_code=subject_code))

    if subjects:
        return subjects

    detected_subject = (
        _normalize_text(parsed.get("detected_subject"))
        or _normalize_text(parsed.get("subject"))
    )
    detected_subject_code = (
        _normalize_text(parsed.get("detected_subject_code"))
        or _normalize_text(parsed.get("subject_code"))
        or None
    )

    if detected_subject:
        return [DetectedSubjectItem(name=detected_subject, subject_code=detected_subject_code)]

    return []


@router.post("/detect-subjects", response_model=DetectSubjectsResponse)
async def detect_subjects(
    syllabus_pdf: UploadFile = File(...),
):
    """
    Detect all subject names/codes present in a syllabus PDF.
    """
    if not syllabus_pdf.content_type or "pdf" not in syllabus_pdf.content_type:
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    try:
        pdf_bytes = await syllabus_pdf.read()
        if not pdf_bytes:
            return DetectSubjectsResponse(subjects=[], total_subjects=0)

        prompt = (
            "Analyze this PDF syllabus document.\n\n"
            "The PDF may contain one subject or multiple subjects.\n"
            "Extract ONLY the list of subjects present in the document and their subject codes if available.\n"
            "Do not extract units or topics in this step.\n\n"
            "Return ONLY a JSON object - no markdown, no code fences, no explanation.\n\n"
            "Return JSON in this exact format:\n"
            "{\n"
            '  "subjects": [\n'
            '    { "name": "Data Structures", "subject_code": "BCS301" },\n'
            '    { "name": "Operating Systems", "subject_code": "BCS302" }\n'
            '  ]\n'
            "}"
        )

        response = _client.models.generate_content(
            model=LLM_MODEL,
            contents=[
                genai.types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
                prompt,
            ],
            config=genai.types.GenerateContentConfig(temperature=0.1),
        )

        parsed = _parse_json_response(response.text)
        subjects = _build_detected_subjects(parsed)
        primary = subjects[0] if len(subjects) == 1 else None

        logger.info("Detected %d subject(s) from syllabus PDF", len(subjects))

        return DetectSubjectsResponse(
            subjects=subjects,
            total_subjects=len(subjects),
            detected_subject=primary.name if primary else None,
            detected_subject_code=primary.subject_code if primary else None,
        )

    except json.JSONDecodeError as exc:
        logger.error("Failed to parse subject detection response: %s", exc)
        raise HTTPException(status_code=500, detail="AI returned invalid JSON for subject detection.")
    except Exception as exc:
        logger.error("Subject detection failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Subject detection failed: {str(exc)}")


@router.post("/extract-units", response_model=ExtractUnitsResponse)
async def extract_units(
    subject: str = Form(...),
    syllabus_pdf: UploadFile = File(...),
):
    """
    Extract units for the selected subject from a syllabus PDF.
    """
    if not syllabus_pdf.content_type or "pdf" not in syllabus_pdf.content_type:
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    subject = _normalize_text(subject)
    if not subject:
        raise HTTPException(status_code=400, detail="Subject is required for unit extraction.")

    try:
        pdf_bytes = await syllabus_pdf.read()
        if not pdf_bytes:
            return ExtractUnitsResponse(subject=subject, detected_subject=subject, total_units=0, units=[])

        prompt = (
            "Analyze this PDF syllabus document.\n\n"
            f'Extract the unit-wise structure ONLY for the subject "{subject}".\n'
            "If the PDF contains multiple subjects, ignore all other subjects and return units only for the selected one.\n\n"
            "UNIT EXTRACTION RULES:\n"
            "- Look for sections labeled as 'Unit', 'Module', 'Chapter', or numbered sections.\n"
            "- If no explicit unit numbering exists, group related topics into logical units.\n"
            "- Each unit should have a clear title and a list of topics.\n"
            "- Return all units found for the selected subject only.\n\n"
            "Return ONLY a JSON object - no markdown, no code fences, no explanation.\n\n"
            "Return JSON in this exact format:\n"
            "{\n"
            '  "detected_subject": "Data Structures",\n'
            '  "detected_subject_code": "BCS301",\n'
            '  "total_units": 2,\n'
            '  "units": [\n'
            '    {\n'
            '      "unit_number": 1,\n'
            '      "title": "Introduction to Data Structures",\n'
            '      "topics": ["Arrays", "Linked Lists", "Stacks"]\n'
            '    },\n'
            '    {\n'
            '      "unit_number": 2,\n'
            '      "title": "Trees and Graphs",\n'
            '      "topics": ["Binary Trees", "BST", "Graph Traversal"]\n'
            '    }\n'
            '  ]\n'
            "}"
        )

        response = _client.models.generate_content(
            model=LLM_MODEL,
            contents=[
                genai.types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
                prompt,
            ],
            config=genai.types.GenerateContentConfig(temperature=0.2),
        )

        parsed = _parse_json_response(response.text)
        units = _build_units(parsed.get("units", []))
        detected_subject = (
            _normalize_text(parsed.get("detected_subject"))
            or _normalize_text(parsed.get("subject"))
            or subject
        )
        detected_subject_code = (
            _normalize_text(parsed.get("detected_subject_code"))
            or _normalize_text(parsed.get("subject_code"))
            or None
        )

        logger.info(
            "Extracted %d unit(s) for selected subject %s",
            len(units),
            detected_subject,
        )

        return ExtractUnitsResponse(
            subject=detected_subject,
            total_units=len(units),
            units=units,
            detected_subject=detected_subject,
            detected_subject_code=detected_subject_code,
        )

    except json.JSONDecodeError as exc:
        logger.error("Failed to parse unit extraction response: %s", exc)
        raise HTTPException(status_code=500, detail="AI returned invalid JSON for unit extraction.")
    except Exception as exc:
        logger.error("Unit extraction failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Unit extraction failed: {str(exc)}")
