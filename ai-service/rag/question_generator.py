"""
Question paper generator using Google Gemini LLM.

Generates questions in a rich JSON format with:
  - metadata (exam, subject, subject_code, duration, max_marks)
  - instructions
  - sections → questions with subparts, choice groups, bloom levels, COs

Accepts a syllabus PDF which is sent directly to Gemini
for context-aware question generation.
"""

import json
import logging
from typing import List, Optional, Dict, Any

from google import genai

from config import GOOGLE_API_KEY, LLM_MODEL
from rag.vector_store import search as vector_search

logger = logging.getLogger(__name__)


# ── Example output for the LLM ──────────────────────────────────

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
      "description": "Answer the following questions briefly",
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
              "difficulty": "easy",
              "topic": "Trees",
              "co": 1,
              "bloom_level": "K1"
            }
          ]
        }
      ]
    },
    {
      "section_id": "B",
      "title": "Long Answer Questions",
      "description": "Answer in detail",
      "marks_scheme": "10 marks each",
      "attempt_rule": "Attempt any 3 out of 5",
      "questions": [
        {
          "question_id": 6,
          "type": "subparts",
          "marks": 10,
          "subquestions": [
            {
              "label": "a",
              "text": "Explain the working of Dijkstra's algorithm.",
              "marks": 5,
              "difficulty": "medium",
              "topic": "Graphs",
              "co": 3,
              "bloom_level": "K2"
            },
            {
              "label": "b",
              "text": "Analyse the time complexity of Dijkstra's algorithm.",
              "marks": 5,
              "difficulty": "hard",
              "topic": "Graphs",
              "co": 4,
              "bloom_level": "K4"
            }
          ]
        }
      ]
    }
  ]
}"""


def _build_prompt_text(
    subject: str,
    difficulty: str,
    style: str,
    pattern: List[Dict[str, Any]],
    topics: Optional[List[str]],
    rag_context: str,
    exam: Optional[str],
    subject_code: Optional[str],
    duration: Optional[str],
    instructions: Optional[List[str]],
) -> tuple:
    """Build system + human message text strings for question generation."""

    system_text = (
        "You are an expert university exam question paper setter. "
        "You generate high-quality, original exam questions in a structured JSON format.\n\n"
        "IMPORTANT RULES:\n"
        "1. Generate EXACTLY the number of questions requested for EACH section.\n"
        "2. Each question must match the marks allocation for its section.\n"
        "3. Questions should cover diverse topics within the subject.\n"
        "4. Do NOT repeat questions or ask the same concept in different ways.\n"
        "5. Higher-mark questions should be more detailed and require deeper analysis.\n"
        "6. For 'subparts' type questions, split the marks across sub-questions (labels: a, b, c…).\n"
        "7. For 'choice_group' type questions, provide alternative options the student can choose from.\n"
        "8. For 'single' type questions, use a single subquestion with the same marks.\n"
        "9. Assign appropriate Bloom's taxonomy levels: K1(Remember), K2(Understand), K3(Apply), K4(Analyse), K5(Evaluate), K6(Create).\n"
        "10. Assign Course Outcome numbers (co) logically starting from 1.\n"
    )

    if style.lower() == "twisted":
        system_text += (
            "11. QUESTION STYLE: TWISTED. The questions MUST be analytical, scenario-based, or application-oriented. "
            "Do NOT ask direct 'Define X' or 'What is Y' questions. Instead, present a problem, a case study, "
            "or an indirect scenario where the student must apply the concept to solve it.\n"
        )
    else:
        system_text += (
            "11. QUESTION STYLE: DIRECT. The questions should be straightforward (e.g., 'Define', 'Explain', 'List', 'Compare'). "
            "Focus on clear foundational knowledge assessment without complex scenarios.\n"
        )

    system_text += "12. Return ONLY valid JSON \u2014 no markdown, no code fences, no explanation."

    # Build section description
    section_desc_lines: List[str] = []
    total_marks = 0
    for sec in pattern:
        label = sec["section"]
        n = sec["questions"]
        m = sec["marksEach"]
        q_type = sec.get("questionType", "single")
        title = sec.get("title", f"Section {label}")
        attempt = sec.get("attemptRule", "Attempt all questions")
        section_desc_lines.append(
            f'  - Section {label} ("{title}"): {n} questions × {m} marks each, '
            f'type={q_type}, attempt_rule="{attempt}"'
        )
        total_marks += n * m

    section_desc = "\n".join(section_desc_lines)

    # Build topics guidance
    topics_text = ""
    if topics:
        topics_text = (
            f"\nCRITICAL INSTRUCTION - RESTRICTED SYLLABUS TOPICS:\n"
            f"You MUST ONLY generate questions from the following selected topics. "
            f"You MUST STRICTLY IGNORE all other topics in the attached syllabus PDF. "
            f"Do NOT generate questions outside of these specific topics under any circumstances:\n"
            f"  {', '.join(topics)}\n"
        )

    # Build RAG context
    rag_text = ""
    if rag_context.strip():
        rag_text = (
            "\nHere are some reference questions from the question bank for style and topic guidance. "
            "Use these as INSPIRATION only — do NOT copy them verbatim:\n"
            f"{rag_context}\n"
        )

    # Build instructions text
    instructions_text = ""
    if instructions:
        instructions_text = (
            f"\nExam instructions to include:\n"
            + "\n".join(f"  - {inst}" for inst in instructions)
            + "\n"
        )

    human_text = (
        f"Generate a question paper for:\n"
        f"  Subject: {subject}\n"
        f"  Subject Code: {subject_code or 'N/A'}\n"
        f"  Exam: {exam or 'Examination'}\n"
        f"  Duration: {duration or '3 Hours'}\n"
        f"  Difficulty: {difficulty}\n"
        f"  Question Style: {style.upper()}\n"
        f"  Total Marks: {total_marks}\n"
        f"\nPaper structure:\n{section_desc}\n"
        f"{topics_text}"
        f"{instructions_text}"
        f"{rag_text}"
        f"\nReturn the result as JSON in EXACTLY this format (follow the structure precisely):\n"
        f"{EXAMPLE_OUTPUT}"
    )

    return system_text, human_text


def _get_rag_context(subject: str, topics: Optional[List[str]], top_k: int = 10) -> str:
    """Fetch relevant questions from the vector store as RAG context."""
    try:
        query = subject
        if topics:
            query += " " + " ".join(topics[:5])

        results = vector_search(query=query, top_k=top_k, subject=subject)
        if not results:
            return ""

        lines: List[str] = []
        for i, r in enumerate(results, 1):
            marks_info = f" [{r.get('marks', '?')} marks]" if r.get("marks") else ""
            topic_info = f" (Topic: {r['topic']})" if r.get("topic") else ""
            lines.append(f"  {i}. {r['text']}{marks_info}{topic_info}")

        return "\n".join(lines)
    except Exception as e:
        logger.warning("RAG context fetch failed: %s", e)
        return ""


def _parse_json_response(raw_text) -> Dict[str, Any]:
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


async def generate(
    subject: str,
    difficulty: str,
    pattern: List[Dict[str, Any]],
    style: str = "direct",
    topics: Optional[List[str]] = None,
    exam: Optional[str] = None,
    subject_code: Optional[str] = None,
    duration: Optional[str] = None,
    instructions: Optional[List[str]] = None,
    syllabus_pdf_bytes: Optional[bytes] = None,
) -> Dict[str, Any]:
    """
    Generate a question paper in the rich JSON format.

    If syllabus_pdf_bytes is provided, the PDF is sent directly to
    Gemini so the LLM can read the syllabus and generate questions
    based on it.

    Returns a dict with keys: metadata, instructions, sections.
    """
    logger.info(
        "Generating paper \u2014 subject=%s, difficulty=%s, style=%s, sections=%d, has_pdf=%s",
        subject, difficulty, style, len(pattern), bool(syllabus_pdf_bytes),
    )

    # 1. Retrieve RAG context from vector store
    rag_context = _get_rag_context(subject, topics)

    # 2. Build prompt text
    system_text, human_text = _build_prompt_text(
        subject, difficulty, style, pattern, topics, rag_context,
        exam, subject_code, duration, instructions,
    )

    # 3. Send PDF + prompt to Gemini SDK (supports native PDF input)
    logger.info("Using Gemini SDK with direct PDF input")
    client = genai.Client(api_key=GOOGLE_API_KEY)

    # Build the PDF context message based on whether topics are filtered
    if topics:
        pdf_context_msg = (
            "\n\nThe attached PDF is the full syllabus for this subject. "
            "IMPORTANT: The user has selected ONLY specific units/topics from this syllabus. "
            "You MUST ONLY generate questions from these selected topics: "
            f"{', '.join(topics)}. "
            "Do NOT generate ANY questions about topics outside this list, "
            "even if they appear in the PDF. Strictly ignore all other units/topics."
        )
    else:
        pdf_context_msg = (
            "\n\nThe attached PDF is the syllabus for this subject. "
            "Use it to ensure questions cover the topics in the syllabus."
        )

    contents = [system_text]
    if syllabus_pdf_bytes:
        contents.append(
            genai.types.Part.from_bytes(data=syllabus_pdf_bytes, mime_type="application/pdf")
        )
    contents.append(human_text + pdf_context_msg)

    response = client.models.generate_content(
        model=LLM_MODEL,
        contents=contents,
        config=genai.types.GenerateContentConfig(temperature=0.7),
    )

    result = _parse_json_response(response.text)

    logger.info(
        "Paper generated — %d sections, %d total marks",
        len(result.get("sections", [])),
        result.get("metadata", {}).get("max_marks", 0),
    )
    return result
