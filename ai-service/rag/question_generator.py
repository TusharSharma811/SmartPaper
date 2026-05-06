"""
Question paper generator using Google Gemini LLM.

Generates questions in a rich JSON format with:
  - metadata (exam, subject, subject_code, duration, max_marks)
  - instructions
  - sections → questions with subparts, choice groups, bloom levels, COs

Accepts a syllabus PDF which is sent directly to Gemini
for context-aware question generation.

Includes:
  - CO-wise marks balance validation (max spread ≤ 2 marks)
  - Section-level difficulty override support
  - Custom section header/description passthrough
"""

import json
import logging
from typing import List, Optional, Dict, Any, Tuple

from google import genai

from config import GOOGLE_API_KEY, LLM_MODEL
from rag.vector_store import search as vector_search

logger = logging.getLogger(__name__)

# ── Math / Numerical Subject Detection ──────────────────────────

_MATH_KEYWORDS = [
    "math", "mathematics", "calculus", "algebra", "linear algebra",
    "differential equations", "trigonometry", "statistics",
    "probability", "discrete mathematics", "numerical methods",
    "numerical analysis", "complex analysis", "real analysis",
    "engineering mathematics", "applied mathematics",
    "vector calculus", "integral calculus", "differential calculus",
    "transform", "laplace", "fourier", "optimization",
]


def _is_math_subject(subject: str) -> bool:
    """Return True if the subject is a math / numerical-oriented subject."""
    normalised = subject.lower().strip()
    return any(kw in normalised for kw in _MATH_KEYWORDS)

MAX_CO_RETRIES = 2  # max additional attempts if CO balance fails


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
      "header_notes": "",
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
      "header_notes": "",
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
    },
    {
      "section_id": "C",
      "title": "Detailed Answer Questions",
      "description": "Attempt any one part from each question",
      "header_notes": "",
      "marks_scheme": "7 marks each",
      "attempt_rule": "Attempt any one part of each question",
      "questions": [
        {
          "question_id": 11,
          "type": "choice_group",
          "marks": 7,
          "subquestions": [],
          "options": [
            {
              "label": "a",
              "text": "Explain AVL tree rotations with suitable examples.",
              "marks": 7,
              "difficulty": "hard",
              "topic": "Trees",
              "co": 3,
              "bloom_level": "K4"
            },
            {
              "label": "b",
              "text": "Discuss B-tree insertion and deletion with examples.",
              "marks": 7,
              "difficulty": "hard",
              "topic": "Trees",
              "co": 3,
              "bloom_level": "K4"
            }
          ]
        }
      ]
    }
  ]
}"""


# ══════════════════════════════════════════════════════════════════
#  CO Balance Validation
# ══════════════════════════════════════════════════════════════════

def _collect_leaf_marks(paper: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Collect all leaf sub-question items with their marks and CO."""
    items = []
    for section in paper.get("sections", []):
        for q in section.get("questions", []):
            subs = q.get("subquestions", [])
            opts = q.get("options", [])
            if q.get("type") == "single" and subs:
                items.append(subs[0])
            elif q.get("type") == "subparts" and subs:
                items.extend(subs)
            elif q.get("type") == "choice_group":
                # Prefer options array; fall back to subquestions
                if opts:
                    items.extend(opts)
                elif subs:
                    items.extend(subs)
    return items


def _compute_co_distribution(paper: Dict[str, Any]) -> Dict[str, int]:
    """Sum marks per CO from the generated paper."""
    dist: Dict[str, int] = {}
    for item in _collect_leaf_marks(paper):
        marks = int(item.get("marks", 0) or 0)
        co = item.get("co")
        if co is not None and co != "":
            label = f"CO{co}" if not str(co).startswith("CO") else str(co)
        else:
            label = "Unassigned"
        dist[label] = dist.get(label, 0) + marks
    return dist


def _validate_co_balance(paper: Dict[str, Any]) -> Tuple[bool, Dict[str, int], str]:
    """
    Validate that CO marks distribution is balanced.
    
    Returns:
        (is_valid, co_distribution, detail_message)
        is_valid = True when max - min spread across COs is ≤ 2 marks.
    """
    co_dist = _compute_co_distribution(paper)
    
    # Filter out 'Unassigned' for balance checking
    assigned = {k: v for k, v in co_dist.items() if k != "Unassigned"}
    
    if len(assigned) <= 1:
        detail = "Only 1 or fewer COs assigned — cannot validate balance."
        return len(assigned) == 0, co_dist, detail
    
    values = list(assigned.values())
    spread = max(values) - min(values)
    
    if spread <= 2:
        detail = f"CO balance OK: spread={spread}, distribution={assigned}"
        logger.info(detail)
        return True, co_dist, detail
    else:
        detail = (
            f"CO balance FAILED: spread={spread} (max allowed=2). "
            f"Distribution: {assigned}"
        )
        logger.warning(detail)
        return False, co_dist, detail


# ══════════════════════════════════════════════════════════════════
#  Prompt Builder
# ══════════════════════════════════════════════════════════════════

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
    co_feedback: Optional[str] = None,
    unit_topic_map: Optional[List[Dict[str, Any]]] = None,
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
        "7. For 'choice_group' type questions, provide TWO alternative options in the 'options' array (NOT 'subquestions'). "
           "Each option must have: label (a/b), text, marks, difficulty, topic, co, bloom_level. "
           "Set subquestions to an empty array []. The student picks ONE option from each question.\n"
        "8. For 'single' type questions, use a single subquestion with the same marks.\n"
        "9. Assign appropriate Bloom's taxonomy levels: K1(Remember), K2(Understand), K3(Apply), K4(Analyse), K5(Evaluate), K6(Create).\n"
    )

    # CO assignment rule — tied to unit numbers if mapping is available
    if unit_topic_map:
        system_text += (
            "10. CRITICAL — CO = UNIT NUMBER RULE: Each Course Outcome (CO) number MUST correspond to its unit number. "
            "CO1 is for topics from Unit 1, CO2 is for topics from Unit 2, CO3 is for topics from Unit 3, and so on. "
            "You MUST determine which unit a question's topic belongs to and assign the matching CO number. "
            "Do NOT assign CO numbers randomly or arbitrarily — they MUST match the unit the topic belongs to.\n"
        )
    else:
        system_text += (
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

    # CO Balance constraint
    if unit_topic_map:
        num_units = len(unit_topic_map)
        system_text += (
            f"12. CRITICAL — CO BALANCE CONSTRAINT: Since COs are mapped to units, you have {num_units} COs "
            f"(CO1 through CO{num_units}). The total marks allocated to each CO across the entire paper "
            "MUST be balanced. The difference between the highest and lowest CO mark totals must be AT MOST 2 marks. "
            f"Distribute questions evenly across all {num_units} COs.\n"
        )
    else:
        system_text += (
            "12. CRITICAL — CO BALANCE CONSTRAINT: The total marks allocated to each Course Outcome (CO) "
            "across the entire paper MUST be balanced. The difference between the highest and lowest CO "
            "mark totals must be AT MOST 2 marks. Distribute questions evenly across COs. "
            "For example, if total marks = 60 and you use 5 COs, each CO should have approximately 12 marks.\n"
        )

    system_text += (
        "13. If a section has a specific difficulty level indicated, ALL questions in that section "
        "must match that difficulty. Sections without explicit difficulty use the global difficulty.\n"
    )

    system_text += (
        "14. If a section includes a 'header_notes' value, include it in the output JSON as-is. "
        "This is custom text the user wants displayed below the section title.\n"
    )

    system_text += "15. Return ONLY valid JSON — no markdown, no code fences, no explanation.\n"

    # ── Math / Numerical-only constraint ────────────────────────
    if _is_math_subject(subject):
        system_text += (
            "\n16. CRITICAL — MATHEMATICS / NUMERICAL-ONLY RULE:\n"
            "This is a Mathematics paper. You MUST generate ONLY numerical, problem-solving, "
            "and computation-based questions. Every question MUST require the student to "
            "perform calculations, solve equations, prove results mathematically, or apply "
            "formulas to obtain a numerical answer.\n"
            "STRICTLY PROHIBITED question types:\n"
            "  - 'Define …', 'What is …', 'Explain …', 'List …', 'Describe …', "
            "'Differentiate between …', 'State the importance of …', 'Discuss …'\n"
            "  - Any purely theoretical / descriptive / recall-based questions\n"
            "  - Any questions that can be answered with only words and no calculations\n"
            "ALLOWED question types (examples):\n"
            "  - 'Solve …', 'Find …', 'Evaluate …', 'Integrate …', 'Differentiate …', "
            "'Prove that …', 'Compute …', 'Calculate …', 'Show that …', 'Determine …'\n"
            "  - Word problems that require setting up and solving equations\n"
            "  - Proof-based questions requiring mathematical derivation\n"
            "  - Graph-sketching questions that require computation of critical points\n"
            "Every single question in the paper MUST be a numerical / computational problem. "
            "NO EXCEPTIONS.\n"
        )

    # Build section description
    section_desc_lines: List[str] = []
    total_marks = 0
    for sec in pattern:
        label = sec["section"]
        n = sec["questions"]
        m = sec["marksEach"]
        q_type = sec.get("questionType", "single")
        title = sec.get("title", f"Section {label}")
        attempt = sec.get("attemptRule") or ""
        attempt = attempt.strip()
        if not attempt:
            attempt = "Attempt all questions"
        sec_difficulty = sec.get("difficulty", None)
        sec_description = sec.get("description", None)

        line = (
            f'  - Section {label} ("{title}"): {n} questions × {m} marks each, '
            f'type={q_type}, attempt_rule="{attempt}"'
        )
        if sec_difficulty:
            line += f', difficulty={sec_difficulty} (OVERRIDE — all questions in this section must be {sec_difficulty})'
        if sec_description:
            line += f', header_notes="{sec_description}"'

        section_desc_lines.append(line)
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
        if _is_math_subject(subject):
            rag_text = (
                "\nHere are some reference NUMERICAL questions from the question bank. "
                "Use these as INSPIRATION only — do NOT copy them verbatim. "
                "Only use questions that are computational / numerical in nature. "
                "Ignore any theory-based reference questions:\n"
                f"{rag_context}\n"
            )
        else:
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

    # CO rebalance feedback (used on retry attempts)
    co_feedback_text = ""
    if co_feedback:
        co_feedback_text = (
            f"\n⚠️ IMPORTANT — CO REBALANCE REQUIRED:\n"
            f"Your previous attempt had an imbalanced CO distribution. "
            f"Here is the issue:\n{co_feedback}\n"
            f"You MUST fix this by redistributing question CO assignments so that "
            f"the marks per CO differ by at most 2. Adjust the 'co' field of questions accordingly.\n"
        )

    # Unit-to-CO mapping guidance (critical for CO = Unit number)
    unit_map_text = ""
    if unit_topic_map:
        unit_map_text = (
            "\nCRITICAL — UNIT TO CO MAPPING (you MUST follow this):\n"
            "Each CO number corresponds to its Unit number. Here is the mapping:\n"
        )
        for unit_entry in unit_topic_map:
            unit_num = unit_entry.get("unit_number", "?")
            unit_title = unit_entry.get("title", "")
            unit_topics = unit_entry.get("topics", [])
            topics_str = ", ".join(unit_topics[:8]) if unit_topics else "(no specific topics)"
            unit_map_text += (
                f"  - Unit {unit_num} ({unit_title}): CO{unit_num} → Topics: {topics_str}\n"
            )
        unit_map_text += (
            "\nWhen generating a question about a topic, look up which unit it belongs to "
            "and assign the corresponding CO number. For example, if a question is about a "
            "topic from Unit 3, set co=3 (displayed as CO3).\n"
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
        f"{unit_map_text}"
        f"{instructions_text}"
        f"{rag_text}"
        f"{co_feedback_text}"
        f"\nReturn the result as JSON in EXACTLY this format (follow the structure precisely):\n"
        f"{EXAMPLE_OUTPUT}"
    )

    return system_text, human_text


def _get_rag_context(subject: str, topics: Optional[List[str]], top_k: int = 10) -> str:
    """Fetch relevant questions from the vector store as RAG context.

    Uses LFU-aware search so that frequently/recently used questions
    are penalised and new or stale questions surface instead.

    For math subjects, the query is biased with numerical keywords
    so that problem/computation-style questions are retrieved.
    """
    try:
        query = subject
        if topics:
            query += " " + " ".join(topics[:5])

        # Bias RAG retrieval towards numerical questions for math subjects
        if _is_math_subject(subject):
            query += " numerical solve compute calculate find evaluate prove"

        results = vector_search(query=query, top_k=top_k, subject=subject, apply_lfu=True)
        if not results:
            return ""

        lines: List[str] = []
        used_texts: List[str] = []
        for i, r in enumerate(results, 1):
            marks_info = f" [{r.get('marks', '?')} marks]" if r.get("marks") else ""
            topic_info = f" (Topic: {r['topic']})" if r.get("topic") else ""
            lines.append(f"  {i}. {r['text']}{marks_info}{topic_info}")
            used_texts.append(r["text"])

        # Record usage so these questions get penalised next time
        try:
            from rag.lfu_tracker import record_usage
            record_usage(used_texts, subject=subject)
        except Exception as lfu_err:
            logger.warning("LFU record_usage failed (non-blocking): %s", lfu_err)

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
    unit_topic_map: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Generate a question paper in the rich JSON format.

    If syllabus_pdf_bytes is provided, the PDF is sent directly to
    Gemini so the LLM can read the syllabus and generate questions
    based on it.

    Includes CO balance validation — retries up to MAX_CO_RETRIES times
    if the CO distribution is imbalanced (spread > 2 marks).

    Returns a dict with keys: metadata, instructions, sections.
    """
    logger.info(
        "Generating paper — subject=%s, difficulty=%s, style=%s, sections=%d, has_pdf=%s",
        subject, difficulty, style, len(pattern), bool(syllabus_pdf_bytes),
    )

    # 1. Retrieve RAG context from vector store
    rag_context = _get_rag_context(subject, topics)

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

    # Retry loop for CO balance
    best_result = None
    best_spread = float("inf")
    co_feedback = None

    for attempt in range(1 + MAX_CO_RETRIES):
        if attempt > 0:
            logger.info("CO balance retry attempt %d/%d", attempt, MAX_CO_RETRIES)

        # 2. Build prompt text (with CO feedback on retries)
        system_text, human_text = _build_prompt_text(
            subject, difficulty, style, pattern, topics, rag_context,
            exam, subject_code, duration, instructions,
            co_feedback=co_feedback,
            unit_topic_map=unit_topic_map,
        )

        # 3. Send PDF + prompt to Gemini SDK
        logger.info("Using Gemini SDK with direct PDF input (attempt %d)", attempt + 1)
        client = genai.Client(api_key=GOOGLE_API_KEY)

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

        # 4. Validate CO balance
        is_valid, co_dist, detail = _validate_co_balance(result)

        # Track best result (smallest spread)
        assigned = {k: v for k, v in co_dist.items() if k != "Unassigned"}
        if assigned:
            spread = max(assigned.values()) - min(assigned.values())
        else:
            spread = 0

        if spread < best_spread:
            best_spread = spread
            best_result = result

        if is_valid:
            logger.info(
                "Paper generated with balanced COs — %d sections, %d total marks, CO dist: %s",
                len(result.get("sections", [])),
                result.get("metadata", {}).get("max_marks", 0),
                co_dist,
            )
            return result

        # Build feedback for next attempt
        co_feedback = (
            f"Previous CO distribution: {assigned}\n"
            f"Spread: {spread} marks (max allowed: 2)\n"
            f"Please redistribute COs so all CO totals differ by at most 2 marks."
        )

    # All retries exhausted — return best attempt
    logger.warning(
        "CO balance not achieved after %d attempts. Using best result (spread=%d). Distribution: %s",
        1 + MAX_CO_RETRIES, best_spread,
        _compute_co_distribution(best_result),
    )
    return best_result
