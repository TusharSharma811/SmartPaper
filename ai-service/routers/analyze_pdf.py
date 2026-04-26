"""
POST /analyze-paper-pdf — parse an uploaded question paper PDF into structured JSON.

Sends the PDF to Gemini and asks it to extract questions with bloom levels and COs
so the frontend can generate analysis charts or run validation.
"""

import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from google import genai
from config import GOOGLE_API_KEY, LLM_MODEL

logger = logging.getLogger(__name__)

router = APIRouter()


EXAMPLE_OUTPUT = """{
  "metadata": {
    "exam": "End Semester Examination",
    "subject": "Data Structures",
    "subject_code": "BCS501",
    "duration": "3 Hours",
    "max_marks": 60
  },
  "instructions": [
    "Attempt all questions.",
    "Each question carries equal marks within its section."
  ],
  "sections": [
    {
      "section_id": "A",
      "title": "Short Answer Questions",
      "marks_scheme": "2 marks each",
      "attempt_rule": "Attempt all questions",
      "questions": [
        {
          "question_id": 1,
          "type": "single",
          "marks": 2,
          "subquestions": [
            {
              "label": "1",
              "text": "Define a binary search tree.",
              "marks": 2,
              "bloom_level": "K1",
              "co": 1
            }
          ]
        }
      ]
    }
  ]
}"""


def _parse_json_response(raw_text) -> dict:
    """Parse JSON from LLM response, stripping markdown fences if present."""
    # Handle cases where LangChain returns a list of content parts instead of a string
    if isinstance(raw_text, list):
        raw_text = " ".join(
            part if isinstance(part, str) else part.get("text", str(part))
            for part in raw_text
        )
    text = str(raw_text).strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text[:-3].strip()
    return json.loads(text)


@router.post("/analyze-paper-pdf")
async def analyze_paper_pdf(
    subject: str = Form("Unknown"),
    syllabus_pdf: UploadFile = File(...),
):
    """
    Parse an uploaded question paper PDF into structured JSON.

    Uses Gemini to read the PDF and extract:
      - metadata (subject, marks, duration)
      - sections with questions
      - bloom levels (K1-K6) and course outcomes for each question

    Returns the same structure as a generated paper so charts and validation work.
    """
    try:
        pdf_bytes = await syllabus_pdf.read()
        if not pdf_bytes:
            raise HTTPException(status_code=400, detail="Empty PDF file.")

        logger.info("Analyzing uploaded paper PDF for subject=%s", subject)

        client = genai.Client(api_key=GOOGLE_API_KEY)

        system_text = (
            "You are an expert university exam paper analyzer.\n"
            "Your task is to read the attached question paper PDF and extract ALL questions "
            "into a structured JSON format.\n\n"
            "RULES:\n"
            "1. Extract EVERY question from the paper, maintaining the section structure.\n"
            "2. For each question, determine its Bloom's taxonomy level:\n"
            "   K1=Remember, K2=Understand, K3=Apply, K4=Analyse, K5=Evaluate, K6=Create\n"
            "3. Assign a logical Course Outcome (CO) number (1-6) based on the topic area.\n"
            "4. Preserve the original marks allocation from the paper.\n"
            "5. If questions have sub-parts (a, b, c...), extract each as a subquestion.\n"
            "6. If questions have OR/choice options, use type='choice_group'.\n"
            "7. Return ONLY valid JSON — no markdown, no code fences, no explanation.\n"
        )

        human_text = (
            f"Subject: {subject}\n\n"
            "Read the attached question paper PDF carefully and extract ALL questions "
            "into the following JSON structure. Analyze each question to assign the "
            "correct Bloom's taxonomy level (K1-K6) and Course Outcome (CO).\n\n"
            f"Return the result in EXACTLY this format:\n{EXAMPLE_OUTPUT}"
        )

        response = client.models.generate_content(
            model=LLM_MODEL,
            contents=[
                system_text,
                genai.types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
                human_text,
            ],
            config=genai.types.GenerateContentConfig(temperature=0.3),
        )

        result = _parse_json_response(response.text)

        logger.info(
            "Paper PDF analyzed — %d sections found",
            len(result.get("sections", [])),
        )

        return result

    except json.JSONDecodeError as e:
        logger.error("Failed to parse AI response: %s", e)
        raise HTTPException(
            status_code=500,
            detail="AI returned invalid JSON. Please try again.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Paper PDF analysis failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail=f"Paper analysis failed: {str(e)}",
        )
