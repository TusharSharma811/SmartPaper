"""
POST /generate-paper — generate a full question paper via LLM + RAG.

Accepts either JSON body or multipart form if a syllabus PDF is uploaded.
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from typing import Optional
import json

from rag.question_generator import generate

router = APIRouter()


@router.post("/generate-paper")
async def generate_paper(
    subject: str = Form(...),
    difficulty: str = Form(...),
    style: str = Form("direct"),
    pattern: str = Form(...),
    topics: Optional[str] = Form(None),
    unit_topic_map: Optional[str] = Form(None),
    exam: Optional[str] = Form(None),
    subject_code: Optional[str] = Form(None),
    duration: Optional[str] = Form(None),
    instructions: Optional[str] = Form(None),
    syllabus_pdf: Optional[UploadFile] = File(None),
):
    """
    Generate a question paper.

    Accepts multipart form data with:
      - subject, difficulty, pattern (JSON string), and optional fields
      - unit_topic_map: JSON mapping of unit numbers to their topics (for CO = unit mapping)
      - syllabus_pdf: optional PDF file sent directly to the LLM

    Returns a rich JSON structure with metadata, instructions, and sections.
    """
    try:
        # Parse pattern from JSON string
        try:
            pattern_list = json.loads(pattern)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid pattern format. Must be valid JSON array.")

        # Parse optional topics
        topics_list = None
        if topics:
            try:
                topics_list = json.loads(topics)
            except json.JSONDecodeError:
                topics_list = [t.strip() for t in topics.split(",") if t.strip()]

        # Parse optional unit_topic_map (for CO = unit number mapping)
        unit_map_list = None
        if unit_topic_map:
            try:
                unit_map_list = json.loads(unit_topic_map)
            except json.JSONDecodeError:
                unit_map_list = None

        # Parse optional instructions
        instructions_list = None
        if instructions:
            try:
                instructions_list = json.loads(instructions)
            except json.JSONDecodeError:
                instructions_list = None

        # Read syllabus PDF bytes if provided
        pdf_bytes = None
        if syllabus_pdf:
            pdf_bytes = await syllabus_pdf.read()

        result = await generate(
            subject=subject,
            difficulty=difficulty,
            style=style,
            pattern=pattern_list,
            topics=topics_list,
            unit_topic_map=unit_map_list,
            exam=exam,
            subject_code=subject_code,
            duration=duration,
            instructions=instructions_list,
            syllabus_pdf_bytes=pdf_bytes,
        )

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Question generation failed: {str(e)}")
