"""Adaptive tutor loop (architecture_future.md stage 5).

Replaces "static quiz + one if-statement" adaptivity with a per-answer
decision cycle: the tutor tracks a knowledge state per concept, and after
every single answer it re-grades the student's understanding, diagnoses
wrong answers, and picks the next question — targeting the weakest concept
at a difficulty calibrated to the student's current mastery of it.

Knowledge state is session-scoped and in-memory, per the architecture
doc's scoping ("in-memory/session"). Sessions are keyed by an opaque UUID
and owned by the user who started them; they expire after a TTL so the
store can't grow unboundedly.
"""
import time
import uuid
from typing import Dict, List, Optional

from .ai_service import BloomAI

MAX_CONCEPTS = 5

# Mastery is a 0-1 estimate per concept, starting at an uninformed midpoint.
# A concept counts as mastered at MASTERED_AT, but only after it has been
# probed at least twice — one lucky guess shouldn't retire a concept.
MASTERY_START = 0.5
MASTERED_AT = 0.8
MIN_PROBES_TO_MASTER = 2

# Mastery deltas by question difficulty. Answering a hard question right is
# strong evidence of understanding; getting a hard question wrong is weak
# evidence of not understanding (and vice versa for easy questions).
CORRECT_DELTA = {"easy": 0.12, "medium": 0.18, "hard": 0.25}
WRONG_DELTA = {"easy": -0.25, "medium": -0.18, "hard": -0.12}

SESSION_TTL_SECONDS = 2 * 60 * 60
MAX_SESSIONS = 500

_sessions: Dict[str, Dict] = {}


def _prune_sessions() -> None:
    now = time.time()
    expired = [sid for sid, s in _sessions.items() if now - s["updated_at"] > SESSION_TTL_SECONDS]
    for sid in expired:
        del _sessions[sid]
    # Hard cap as a backstop: drop the least recently used sessions.
    if len(_sessions) > MAX_SESSIONS:
        for sid in sorted(_sessions, key=lambda s: _sessions[s]["updated_at"])[: len(_sessions) - MAX_SESSIONS]:
            del _sessions[sid]


def _difficulty_for(mastery: float) -> str:
    if mastery < 0.4:
        return "easy"
    if mastery < 0.7:
        return "medium"
    return "hard"


def _is_mastered(state: Dict) -> bool:
    return state["mastery"] >= MASTERED_AT and state["questions_asked"] >= MIN_PROBES_TO_MASTER


def _pick_next_concept(concepts: Dict[str, Dict]) -> Optional[str]:
    """Target the weakest unmastered concept; among ties, the least-probed
    one, so early questions sweep across concepts before drilling down.
    """
    candidates = [(name, s) for name, s in concepts.items() if not _is_mastered(s)]
    if not candidates:
        return None
    return min(candidates, key=lambda item: (item[1]["mastery"], item[1]["questions_asked"]))[0]


def _concept_states(concepts: Dict[str, Dict]) -> List[Dict]:
    return [
        {
            "concept": name,
            "mastery": round(s["mastery"], 2),
            "questions_asked": s["questions_asked"],
            "questions_correct": s["questions_correct"],
            "mastered": _is_mastered(s),
        }
        for name, s in concepts.items()
    ]


def _public_question(question: Dict, question_number: int, concept: str) -> Dict:
    """The question as sent to the frontend — without the correct answer,
    which stays server-side until the student has answered.
    """
    return {
        "question": question["question"],
        "options": question["options"],
        "concept": concept,
        "difficulty": question.get("difficulty", "medium"),
        "question_number": question_number,
    }


def _summary(session: Dict) -> Dict:
    concepts = session["concepts"]
    total = session["questions_answered"]
    correct = session["correct_answers"]
    return {
        "total_questions": total,
        "correct_answers": correct,
        "accuracy": round((correct / total) * 100, 1) if total else 0.0,
        "concepts_mastered": [name for name, s in concepts.items() if _is_mastered(s)],
        "concepts_weak": [name for name, s in concepts.items() if not _is_mastered(s)],
        "concepts": _concept_states(concepts),
    }


async def _next_question(session: Dict, ai_service: BloomAI, concept: str) -> Dict:
    state = session["concepts"][concept]
    difficulty = _difficulty_for(state["mastery"])
    question = await ai_service.generate_tutor_question(
        session["text_content"], concept, difficulty, session["subject"], session["asked_questions"]
    )
    if question is None:
        raise RuntimeError("Failed to generate a tutor question")

    session["current"] = {"question": question, "concept": concept}
    session["asked_questions"].append(question["question"])
    session["updated_at"] = time.time()
    return _public_question(question, session["questions_answered"] + 1, concept)


async def start_session(
    user_id: str, text_content: str, subject: str, max_questions: int, ai_service: BloomAI
) -> Dict:
    """Extract the concepts to teach, initialize the knowledge state, and
    generate the first question.
    """
    _prune_sessions()

    topics = await ai_service.extract_key_topics(text_content)
    topics = [t for t in topics if t and t.lower() != "general"][:MAX_CONCEPTS]
    if not topics:
        topics = [subject]

    session = {
        "user_id": user_id,
        "subject": subject,
        "text_content": text_content,
        "max_questions": max_questions,
        "concepts": {
            topic: {"mastery": MASTERY_START, "questions_asked": 0, "questions_correct": 0}
            for topic in topics
        },
        "asked_questions": [],
        "questions_answered": 0,
        "correct_answers": 0,
        "current": None,
        "updated_at": time.time(),
    }

    first_concept = _pick_next_concept(session["concepts"])
    question = await _next_question(session, ai_service, first_concept)

    session_id = str(uuid.uuid4())
    _sessions[session_id] = session

    return {
        "session_id": session_id,
        "question": question,
        "concepts": _concept_states(session["concepts"]),
        "max_questions": max_questions,
    }


async def submit_answer(session_id: str, user_id: str, answer: str, ai_service: BloomAI) -> Optional[Dict]:
    """Grade the answer, diagnose it if wrong, update the knowledge state,
    and either return the next question or end the session with a summary.

    Returns None if the session doesn't exist (or belongs to another user)
    — expired sessions look the same as unknown ones to the caller.
    """
    session = _sessions.get(session_id)
    if session is None or session["user_id"] != user_id:
        return None
    if session["current"] is None:
        return None

    question = session["current"]["question"]
    concept = session["current"]["concept"]
    state = session["concepts"][concept]
    difficulty = question.get("difficulty", "medium")

    correct = answer.strip().lower() == question["correct_answer"].strip().lower()

    session["questions_answered"] += 1
    state["questions_asked"] += 1
    if correct:
        session["correct_answers"] += 1
        state["questions_correct"] += 1

    delta = CORRECT_DELTA.get(difficulty, 0.18) if correct else WRONG_DELTA.get(difficulty, -0.18)
    state["mastery"] = min(1.0, max(0.05, state["mastery"] + delta))

    # Diagnose *why* the answer was wrong, not just that it was. Fail open:
    # a failed diagnosis call degrades to explanation-only feedback.
    diagnosis = None
    if not correct:
        diagnosis = await ai_service.diagnose_mistake(question, answer, session["text_content"])

    session["current"] = None
    session["updated_at"] = time.time()

    done = (
        session["questions_answered"] >= session["max_questions"]
        or _pick_next_concept(session["concepts"]) is None
    )

    response = {
        "correct": correct,
        "correct_answer": question["correct_answer"],
        "explanation": question.get("explanation"),
        "diagnosis": diagnosis,
        "concept": concept,
        "concepts": _concept_states(session["concepts"]),
        "done": done,
        "next_question": None,
        "summary": None,
    }

    if done:
        response["summary"] = _summary(session)
        del _sessions[session_id]
    else:
        next_concept = _pick_next_concept(session["concepts"])
        response["next_question"] = await _next_question(session, ai_service, next_concept)

    return response
