"""Pretesting — retrieval before re-reading (ROADMAP_LEARNING 1).

Answering questions *before* studying the material measurably improves
retention of what is read afterwards, even when the answers are wrong.
The pretest doubles as calibration data: each answer writes into the
user's persistent concept_mastery rows, so a tutor session started after
the pretest begins from real evidence instead of the uninformed 0.5
midpoint, and the summary can flag the concepts the pretest missed.

A pretest is deliberately lightweight next to a tutor session: one
multiple-choice question per extracted concept (3-5 total), graded in a
single batch on submit. Sessions are memory-only with a short TTL — a
lost pretest costs the student under a minute, so durability isn't worth
a table.
"""
import asyncio
import time
import uuid
from typing import Dict, List, Optional

from .ai_service import BloomAI
from . import db
from . import memory_service

MAX_QUESTIONS = 5
MIN_QUESTIONS = 3

# Pretest evidence is weaker than tutor evidence (one medium recognition
# question per concept, 25% guess rate), so deltas from the prior mastery
# estimate are modest. A miss moves further than a hit: before studying,
# a wrong answer is more informative than a possibly-lucky right one.
CORRECT_DELTA = 0.12
WRONG_DELTA = -0.15

PRETEST_TTL_SECONDS = 60 * 60
MAX_PRETESTS = 500

_pretests: Dict[str, Dict] = {}


def _prune_pretests() -> None:
    now = time.time()
    for pid in [p for p, s in _pretests.items() if now - s["created_at"] > PRETEST_TTL_SECONDS]:
        del _pretests[pid]
    if len(_pretests) > MAX_PRETESTS:
        for pid in sorted(_pretests, key=lambda p: _pretests[p]["created_at"])[: len(_pretests) - MAX_PRETESTS]:
            del _pretests[pid]


def _public_questions(questions: List[Dict]) -> List[Dict]:
    """Questions as sent to the frontend — without answers (grading is
    server-side) and without concept names (this is a blind first probe)."""
    return [
        {
            "question": q["question"],
            "options": q.get("options") or [],
            "question_number": i + 1,
        }
        for i, q in enumerate(questions)
    ]


async def start_pretest(
    user_id: str, text_content: str, subject: str, ai_service: BloomAI,
    document_id: Optional[str] = None, progress=None,
) -> Dict:
    """Extract the material's key concepts and generate one multiple-choice
    question per concept, before any summary has been shown."""
    _prune_pretests()

    def _report(stage: str):
        if progress:
            progress(stage)

    _report("Finding the concepts to test")
    topics = await ai_service.extract_key_topics(text_content)
    topics = [t for t in topics if t and t.lower() != "general"][:MAX_QUESTIONS]
    if not topics:
        topics = [subject]

    _report("Writing your pretest questions")
    generated = await asyncio.gather(*[
        ai_service.generate_tutor_question(
            text_content, topic, "medium", subject, [], answer_mode="multiple_choice"
        )
        for topic in topics
    ])
    questions = [q for q in generated if q is not None]
    if not questions:
        raise RuntimeError("Failed to generate pretest questions")

    pretest_id = str(uuid.uuid4())
    _pretests[pretest_id] = {
        "user_id": user_id,
        "subject": subject,
        "document_id": document_id,
        "questions": questions,
        "created_at": time.time(),
    }
    return {
        "pretest_id": pretest_id,
        "questions": _public_questions(questions),
        "total_questions": len(questions),
    }


def _record_results_sync(
    user_id: str, outcomes: List[Dict],
    document_id: Optional[str] = None, subject: Optional[str] = None,
) -> None:
    """Write pretest outcomes into the persistent concept_mastery rows, so a
    tutor session started afterwards seeds from pretest-informed mastery.
    Concepts are matched by embedding (same path as the tutor's seeding) so
    the pretest and the tutor agree on which row a concept is."""
    concepts = [o["concept"] for o in outcomes]
    embeddings = memory_service._embed(concepts)
    for outcome, embedding in zip(outcomes, embeddings):
        match = db.match_concept_mastery(user_id, embedding)
        delta = CORRECT_DELTA if outcome["correct"] else WRONG_DELTA
        if match is not None:
            db.update_concept_mastery(
                match["id"],
                min(1.0, max(0.05, match["mastery"] + delta)),
                match["questions_asked"] + 1,
                match["questions_correct"] + (1 if outcome["correct"] else 0),
            )
            try:
                db.set_concept_source(match["id"], document_id, subject)
            except Exception:
                pass
        else:
            mastery = min(1.0, max(0.05, 0.5 + delta))
            row_id = db.create_concept_mastery(
                user_id, outcome["concept"], embedding, mastery,
                document_id=document_id, subject=subject,
            )
            db.update_concept_mastery(row_id, mastery, 1, 1 if outcome["correct"] else 0)


async def submit_pretest(pretest_id: str, user_id: str, answers: List[str]) -> Optional[Dict]:
    """Grade the pretest, persist per-concept results into concept_mastery,
    and return the full correction plus the missed concepts (for flagging in
    the summary shown next). Returns None for unknown/foreign pretests."""
    pretest = _pretests.get(pretest_id)
    if pretest is None or pretest["user_id"] != user_id:
        return None
    questions = pretest["questions"]
    if len(answers) != len(questions):
        raise ValueError("Answer count mismatch")

    results = []
    outcomes = []
    for i, (question, answer) in enumerate(zip(questions, answers)):
        correct = answer.strip().lower() == question["correct_answer"].strip().lower()
        concept = question.get("category") or pretest["subject"]
        results.append({
            "question": question["question"],
            "options": question.get("options") or [],
            "user_answer": answer,
            "correct_answer": question["correct_answer"],
            "correct": correct,
            "explanation": question.get("explanation"),
            "concept": concept,
            "question_number": i + 1,
        })
        outcomes.append({"concept": concept, "correct": correct})

    # Best-effort: a mastery-write failure must never eat the student's
    # results — the pretest still calibrates the summary flags client-side.
    try:
        await asyncio.to_thread(
            _record_results_sync, user_id, outcomes,
            pretest.get("document_id"), pretest["subject"],
        )
    except Exception:
        pass

    _pretests.pop(pretest_id, None)

    correct_count = sum(1 for r in results if r["correct"])
    missed = []
    for r in results:
        if not r["correct"] and r["concept"] not in missed:
            missed.append(r["concept"])
    return {
        "results": results,
        "correct_answers": correct_count,
        "total_questions": len(results),
        "missed_concepts": missed,
    }
