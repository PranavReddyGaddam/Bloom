"""Adaptive tutor loop.

The tutor tracks a knowledge state per concept and, after every answer,
re-grades the student's understanding, diagnoses wrong answers, and picks
the next question. There is no fixed question count: the student picks a
*mode* ("vibe_check" / "locked_in") that sets a mastery bar, and the
session runs until every concept clears it.

The central rule: **one correct answer is never mastery evidence on its
own** (multiple choice has a 25% guess rate, and repeating a question tests
memory of the question, not the concept). Every answer schedules a
follow-up in a different framing:

- correct answer -> a *variant* of the same knowledge point is queued and
  asked 2-4 questions later; passing variants is what moves a concept
  toward mastered. Failing a variant after getting the original right is
  memorization-detected, and is punished harder than a plain miss.
- wrong answer -> the correct answer + diagnosis is shown, and a *recheck*
  (same point, new framing) is queued 2-4 questions later. Failing rechecks
  3x parks the concept: the tutor stops drilling it and the summary says to
  re-read that material.

Concept selection is weighted-random (favoring weak concepts, never the
same concept twice in a row when avoidable) and queued follow-ups land
unannounced, so the student can't predict what comes next. No live
knowledge state is exposed during the session — only the end summary.

Knowledge state is persisted to Supabase (tutor_sessions — source of
truth, survives backend restarts) with the in-memory dict kept as a hot
cache. Every DB call is best-effort: a persistence failure degrades to
memory-only behavior rather than interrupting the student.
"""
import asyncio
import random
import time
import uuid
from typing import Dict, List, Optional

from .ai_service import BloomAI
from . import db
from . import memory_service

MAX_CONCEPTS = 5

# Mastery is a 0-1 estimate per concept, starting at an uninformed midpoint.
MASTERY_START = 0.5

# A concept must be probed at least this many times before it can clear the
# bar — one lucky exchange shouldn't retire a concept.
MIN_PROBES_TO_MASTER = 2

# Base mastery deltas by question difficulty. Answering a hard question
# right is strong evidence of understanding; getting a hard question wrong
# is weak evidence of not understanding (and vice versa for easy questions).
CORRECT_DELTA = {"easy": 0.12, "medium": 0.18, "hard": 0.25}
WRONG_DELTA = {"easy": -0.25, "medium": -0.18, "hard": -0.12}

# Evidence-quality weights on top of the base delta. A fresh correct could
# be a guess; a passed variant is real transfer; a failed variant after a
# correct original means the answer was memorized, not understood.
EVIDENCE_WEIGHT = {
    "fresh_correct": 0.5,
    "variant_correct": 1.5,
    "recheck_correct": 1.25,
    "fresh_wrong": 1.0,
    "variant_wrong": 1.5,
    "recheck_wrong": 1.5,
}

# How the student's self-reported confidence scales the mastery delta:
# a confidently-wrong answer is strong evidence of a misconception (bigger
# drop), an unsure-but-right answer may be a lucky guess (smaller gain).
# Unknown/absent confidence behaves like "medium" (multiplier 1.0).
CONFIDENCE_MULTIPLIER = {
    "low": {"correct": 0.7, "wrong": 0.7},
    "medium": {"correct": 1.0, "wrong": 1.0},
    "high": {"correct": 1.2, "wrong": 1.4},
}

# Calibration feedback (ROADMAP_LEARNING 5): confidence doesn't just scale
# the mastery delta — (confidence, correctness) pairs are tracked per concept
# and shown back in the summary. One confidently-wrong answer is already a
# miscalibration signal (the multiplier treats it as strong evidence), but an
# unsure-yet-right answer can be a lucky multiple-choice guess, so flagging
# underconfidence requires more than one.
CALIBRATION_LEVELS = ("low", "medium", "high")
OVERCONFIDENT_MIN_WRONG = 1
UNDERCONFIDENT_MIN_CORRECT = 2
CALIBRATION_TOP_N = 3

# Session modes: the bar a concept must clear, not a question count.
MODES = {
    "vibe_check": {
        "mastery": 0.75,
        "variants_required": 1,
        "hard_variant": False,
        "last_success_required": False,
    },
    "locked_in": {
        "mastery": 0.85,
        "variants_required": 2,
        "hard_variant": True,
        "last_success_required": True,
    },
}
DEFAULT_MODE = "vibe_check"

# Follow-up spacing: a queued variant/recheck becomes due this many answered
# questions after it was scheduled (randomized so it can't be anticipated).
VARIANT_SPACING = (2, 4)

# Failing this many rechecks on one knowledge area parks the concept.
MAX_RECHECK_ATTEMPTS = 3

# Free-text answers (ROADMAP 4.2): once the mastery estimate clears this
# bar, questions switch from multiple-choice (25% guess rate) to open-ended
# — the student must produce the answer in their own words, which is both
# stronger mastery evidence and gives diagnose_mistake their actual words.
FREE_TEXT_MASTERY = 0.55

# A partially-correct free-text answer moves mastery up by this fraction of
# the full correct delta (never down): real substance, incomplete recall.
PARTIAL_CREDIT_FACTOR = 0.5

# "No end goal" must not become "no end": offer a wrap-up checkpoint once,
# and hard-stop regardless of state (fatigue/cost protection).
SOFT_CHECKPOINT = 20
HARD_CAP = 35

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


def _fresh_concept_state() -> Dict:
    return {
        "mastery": MASTERY_START,
        "questions_asked": 0,
        "questions_correct": 0,
        "variants_passed": 0,
        "hard_variant_passed": False,
        "parked": False,
        "last_correct": None,
        # This session's (confidence, correctness) pairs, keyed by level:
        # {"high": {"answered": n, "correct": n}, ...}. Lives inside the
        # concept state so it persists with the tutor_sessions concepts jsonb.
        "calibration": {},
    }


def _concept_done(state: Dict, mode_cfg: Dict) -> bool:
    """Whether one concept clears the mode's mastery bar (queue emptiness is
    checked separately at the session level)."""
    if state.get("parked"):
        return False
    if state["questions_asked"] < MIN_PROBES_TO_MASTER:
        return False
    if state["mastery"] < mode_cfg["mastery"]:
        return False
    if state["variants_passed"] < mode_cfg["variants_required"]:
        return False
    if mode_cfg["hard_variant"] and not state["hard_variant_passed"]:
        return False
    if mode_cfg["last_success_required"] and state["last_correct"] is not True:
        return False
    return True


def _session_complete(session: Dict) -> bool:
    """Done when every non-parked concept clears the bar and no follow-ups
    are outstanding. If everything got parked, there's nothing left to teach
    from this material — end with an honest summary."""
    mode_cfg = MODES[session["mode"]]
    active = {name: s for name, s in session["concepts"].items() if not s.get("parked")}
    if not active:
        return True
    if session["verify_queue"] or session["recheck_queue"]:
        return False
    return all(_concept_done(s, mode_cfg) for s in active.values())


def _concept_states(session: Dict) -> List[Dict]:
    mode_cfg = MODES[session["mode"]]
    return [
        {
            "concept": name,
            "mastery": round(s["mastery"], 2),
            "questions_asked": s["questions_asked"],
            "questions_correct": s["questions_correct"],
            "mastered": _concept_done(s, mode_cfg),
            "parked": s.get("parked", False),
            "resumed": s.get("resumed", False),
        }
        for name, s in session["concepts"].items()
    ]


def _public_question(question: Dict, question_number: int) -> Dict:
    """The question as sent to the frontend — without the correct answer
    (grading is server-side) and without the concept name (the student
    shouldn't see what's being probed or what comes next).
    """
    return {
        "question": question["question"],
        "options": question.get("options") or [],
        "difficulty": question.get("difficulty", "medium"),
        "answer_mode": question.get("answer_mode", "multiple_choice"),
        "question_number": question_number,
    }


def _calibration(session: Dict) -> Optional[Dict]:
    """Calibration readout for the summary: how confidence lined up with
    correctness, and the concepts where they diverged most in each direction.
    Returns None when every answer used the default "medium" — data the
    student never varied says nothing about their calibration.
    """
    buckets = {level: {"answered": 0, "correct": 0} for level in CALIBRATION_LEVELS}
    overconfident: List[Dict] = []
    underconfident: List[Dict] = []
    for name, state in session["concepts"].items():
        cal = state.get("calibration") or {}
        for level, counts in cal.items():
            if level in buckets:
                buckets[level]["answered"] += counts["answered"]
                buckets[level]["correct"] += counts["correct"]
        high = cal.get("high", {"answered": 0, "correct": 0})
        low = cal.get("low", {"answered": 0, "correct": 0})
        if high["answered"] - high["correct"] >= OVERCONFIDENT_MIN_WRONG:
            overconfident.append({"concept": name, "answered": high["answered"], "correct": high["correct"]})
        if low["correct"] >= UNDERCONFIDENT_MIN_CORRECT:
            underconfident.append({"concept": name, "answered": low["answered"], "correct": low["correct"]})

    if buckets["high"]["answered"] == 0 and buckets["low"]["answered"] == 0:
        return None
    overconfident.sort(key=lambda c: c["answered"] - c["correct"], reverse=True)
    underconfident.sort(key=lambda c: c["correct"], reverse=True)
    return {
        "by_confidence": [
            {"confidence": level, **buckets[level]}
            for level in CALIBRATION_LEVELS
            if buckets[level]["answered"]
        ],
        "overconfident": overconfident[:CALIBRATION_TOP_N],
        "underconfident": underconfident[:CALIBRATION_TOP_N],
    }


def _summary(session: Dict) -> Dict:
    mode_cfg = MODES[session["mode"]]
    concepts = session["concepts"]
    total = session["questions_answered"]
    correct = session["correct_answers"]
    return {
        "total_questions": total,
        "correct_answers": correct,
        "accuracy": round((correct / total) * 100, 1) if total else 0.0,
        "concepts_mastered": [n for n, s in concepts.items() if _concept_done(s, mode_cfg)],
        "concepts_weak": [
            n for n, s in concepts.items() if not _concept_done(s, mode_cfg) and not s.get("parked")
        ],
        "concepts_parked": [n for n, s in concepts.items() if s.get("parked")],
        "concepts": _concept_states(session),
        "calibration": _calibration(session),
    }


def _enqueue(session: Dict, queue_name: str, concept: str, source_question: Dict, attempts: int = 0) -> None:
    session[queue_name].append({
        "concept": concept,
        "source_question": source_question,
        "due_at": session["questions_answered"] + random.randint(*VARIANT_SPACING),
        "attempts": attempts,
    })


def _pending_verifies(session: Dict, concept: str) -> int:
    return sum(1 for item in session["verify_queue"] if item["concept"] == concept)


def _pick_next_task(session: Dict) -> Optional[Dict]:
    """Decide what the next question probes.

    Priority: (1) a randomly-chosen *due* queued follow-up — rechecks and
    variants land unannounced; (2) a fresh question on a weighted-random
    unfinished concept (never the previous concept when avoidable); (3) if
    only future-due follow-ups remain, pull the earliest one early. Returns
    None when there is genuinely nothing left, which _session_complete
    should have caught first.
    """
    answered = session["questions_answered"]

    due = [
        (queue_name, kind, item)
        for queue_name, kind in (("recheck_queue", "recheck"), ("verify_queue", "verify"))
        for item in session[queue_name]
        if item["due_at"] <= answered
    ]
    if due:
        queue_name, kind, item = random.choice(due)
        session[queue_name].remove(item)
        return {"kind": kind, "concept": item["concept"], "source_question": item["source_question"],
                "attempts": item.get("attempts", 0)}

    mode_cfg = MODES[session["mode"]]
    candidates = [
        (name, s) for name, s in session["concepts"].items()
        if not s.get("parked") and not _concept_done(s, mode_cfg)
    ]
    last_concept = session["history"][-1]["category"] if session["history"] else None
    if len(candidates) > 1 and last_concept:
        filtered = [c for c in candidates if c[0] != last_concept]
        if filtered:
            candidates = filtered
    if candidates:
        weights = [(1.0 - s["mastery"]) + 0.2 for _, s in candidates]
        name = random.choices([n for n, _ in candidates], weights=weights, k=1)[0]
        return {"kind": "fresh", "concept": name, "source_question": None, "attempts": 0}

    # Only not-yet-due follow-ups remain — pull the earliest early rather
    # than inventing fresh questions on finished concepts.
    pending = [
        (item["due_at"], queue_name, kind, item)
        for queue_name, kind in (("recheck_queue", "recheck"), ("verify_queue", "verify"))
        for item in session[queue_name]
    ]
    if pending:
        pending.sort(key=lambda p: p[0])
        _, queue_name, kind, item = pending[0]
        session[queue_name].remove(item)
        return {"kind": kind, "concept": item["concept"], "source_question": item["source_question"],
                "attempts": item.get("attempts", 0)}
    return None


def _seed_concepts_sync(
    user_id: str, topics: List[str],
    document_id: Optional[str] = None, subject: Optional[str] = None,
) -> Dict[str, Dict]:
    """Seed each topic's knowledge state from the user's persistent
    concept_mastery rows. Topic names are matched against stored concepts by
    embedding similarity, so rephrasings of a concept the user has studied
    before resume at their prior mastery instead of the uninformed midpoint.
    Unmatched topics get a fresh row so this session's results persist.

    Embedding is CPU-bound and the DB client is sync — run via to_thread.
    """
    embeddings = memory_service._embed(topics)
    concepts: Dict[str, Dict] = {}
    for topic, embedding in zip(topics, embeddings):
        match = db.match_concept_mastery(user_id, embedding)
        if match is not None:
            try:
                prior_misconceptions = db.get_recent_misconceptions(match["id"])
            except Exception:
                prior_misconceptions = []
            # Point the concept at the material it's being studied from now,
            # so a due review can reopen that document for a refresher.
            try:
                db.set_concept_source(match["id"], document_id, subject)
            except Exception:
                pass
            concepts[topic] = {
                **_fresh_concept_state(),
                "mastery": min(1.0, max(0.05, match["mastery"])),
                "mastery_row_id": match["id"],
                # Lifetime counters, kept separate from this session's counts
                # so write-backs can persist base + session totals.
                "prior_questions_asked": match["questions_asked"],
                "prior_questions_correct": match["questions_correct"],
                # Lifetime calibration counters (.get: absent until the
                # calibration migration updates the match RPC's return set).
                "prior_calibration": {
                    "high": {"answered": match.get("conf_high_asked") or 0,
                             "correct": match.get("conf_high_correct") or 0},
                    "low": {"answered": match.get("conf_low_asked") or 0,
                            "correct": match.get("conf_low_correct") or 0},
                },
                "prior_misconceptions": prior_misconceptions,
                "resumed": match["questions_asked"] > 0,
            }
        else:
            row_id = db.create_concept_mastery(
                user_id, topic, embedding, MASTERY_START,
                document_id=document_id, subject=subject,
            )
            concepts[topic] = {**_fresh_concept_state(), "mastery_row_id": row_id}
    return concepts


async def _next_question(session: Dict, ai_service: BloomAI) -> Dict:
    task = _pick_next_task(session)
    if task is None:
        raise RuntimeError("No next question available for an unfinished session")

    concept = task["concept"]
    state = session["concepts"][concept]
    mode_cfg = MODES[session["mode"]]

    # If the mode demands a hard variant and none has passed yet, variants
    # come at hard difficulty until one does.
    if task["kind"] == "verify" and mode_cfg["hard_variant"] and not state["hard_variant_passed"]:
        difficulty = "hard"
    else:
        difficulty = _difficulty_for(state["mastery"])

    # Free-text at higher mastery: once the student has shown some command
    # of a concept, recognition questions stop being informative — make them
    # produce the answer in their own words.
    answer_mode = "free_text" if state["mastery"] >= FREE_TEXT_MASTERY else "multiple_choice"

    question = await ai_service.generate_tutor_question(
        session["text_content"], concept, difficulty, session["subject"], session["asked_questions"],
        misconceptions=state.get("prior_misconceptions"),
        variant_of=task["source_question"],
        answer_mode=answer_mode,
    )
    if question is None:
        raise RuntimeError("Failed to generate a tutor question")

    session["current"] = {
        "question": question,
        "concept": concept,
        "kind": task["kind"],
        "attempts": task["attempts"],
    }
    session["asked_questions"].append(question["question"])
    session["updated_at"] = time.time()
    return _public_question(question, session["questions_answered"] + 1)


def _load_session(session_id: str, user_id: str) -> Optional[Dict]:
    """Fetch a session from the hot cache, falling back to the DB on a miss
    (backend restarted, or cache pruned). Ownership-scoped: another user's
    session looks the same as a nonexistent one.
    """
    session = _sessions.get(session_id)
    if session is None:
        try:
            session = db.get_tutor_session(session_id, user_id)
        except Exception:
            session = None
        if session is not None:
            _sessions[session_id] = session
    if session is None or session["user_id"] != user_id:
        return None
    return session


def get_session_state(session_id: str, user_id: str) -> Optional[Dict]:
    """Current public state of an active session, for resuming the UI after
    a page refresh: the pending question (without its answer) and the mode.
    Returns None for unknown/finished/foreign sessions.
    """
    session = _load_session(session_id, user_id)
    if session is None or session["current"] is None:
        return None
    return {
        "session_id": session_id,
        "question": _public_question(session["current"]["question"], session["questions_answered"] + 1),
        "mode": session["mode"],
    }


def _finish_session(session_id: str, session: Dict) -> Dict:
    """Build the summary, record the session as an attempt, reschedule each
    concept's next spaced review, and drop the cache."""
    summary = _summary(session)
    _sessions.pop(session_id, None)
    try:
        db.complete_tutor_session(session_id, session)
    except Exception:
        # Best-effort: the student still gets their summary even if the
        # attempt couldn't be recorded.
        pass
    # Spaced repetition for concepts (ROADMAP_LEARNING 6): a session that
    # confirmed a concept pushes its next review out at a growing interval;
    # a session that found it weak/parked resets it to a short one. Only
    # concepts actually probed this session count as review evidence.
    mastered = set(summary["concepts_mastered"])
    for name, state in session["concepts"].items():
        if not state.get("mastery_row_id") or state["questions_asked"] == 0:
            continue
        try:
            db.schedule_concept_review(state["mastery_row_id"], name in mastered)
        except Exception:
            pass
    return summary


def wrap_session(session_id: str, user_id: str) -> Optional[Dict]:
    """End an active session early at the student's request (soft-checkpoint
    "wrap up") and return its summary. Returns None if the session doesn't
    exist or isn't theirs."""
    session = _load_session(session_id, user_id)
    if session is None:
        return None
    return _finish_session(session_id, session)


async def start_session(
    user_id: str, text_content: str, subject: str, mode: str, ai_service: BloomAI,
    concepts_filter: Optional[List[str]] = None,
    document_id: Optional[str] = None,
    progress=None,
) -> Dict:
    """Extract the concepts to teach, seed the knowledge state from prior
    sessions, and generate the first question.
    """
    _prune_sessions()

    def _report(stage: str):
        if progress:
            progress(stage)

    if mode not in MODES:
        mode = DEFAULT_MODE

    if concepts_filter:
        # Follow-up session restricted to caller-named concepts (e.g. the
        # summary's "practice these again") — skip topic extraction.
        topics = [c.strip() for c in concepts_filter if c and c.strip()][:MAX_CONCEPTS]
    else:
        _report("Extracting the concepts to teach")
        topics = await ai_service.extract_key_topics(text_content)
        topics = [t for t in topics if t and t.lower() != "general"][:MAX_CONCEPTS]
    if not topics:
        topics = [subject]

    # Seed from the user's cross-session knowledge state; fall back to fresh
    # midpoint states if the memory layer or DB is unavailable (fail open).
    _report("Checking what you already know")
    try:
        concepts = await asyncio.to_thread(_seed_concepts_sync, user_id, topics, document_id, subject)
    except Exception:
        concepts = {topic: _fresh_concept_state() for topic in topics}

    session = {
        "user_id": user_id,
        "subject": subject,
        "text_content": text_content,
        "mode": mode,
        "concepts": concepts,
        "asked_questions": [],
        "history": [],
        "verify_queue": [],
        "recheck_queue": [],
        "checkpoint_shown": False,
        "questions_answered": 0,
        "correct_answers": 0,
        "current": None,
        "updated_at": time.time(),
    }

    _report("Writing your first question")
    question = await _next_question(session, ai_service)

    try:
        session_id = db.create_tutor_session(user_id, session)
    except Exception:
        # DB unavailable — fall back to a memory-only session (old behavior).
        session_id = str(uuid.uuid4())
    _sessions[session_id] = session

    return {
        "session_id": session_id,
        "question": question,
        "mode": mode,
    }


async def submit_answer(
    session_id: str, user_id: str, answer: str, ai_service: BloomAI,
    confidence: Optional[str] = None,
) -> Optional[Dict]:
    """Grade the answer, diagnose it if wrong, update the knowledge state,
    schedule the follow-up (variant or recheck), and either return the next
    question or end the session with a summary.

    Returns None if the session doesn't exist (or belongs to another user)
    — expired sessions look the same as unknown ones to the caller.
    """
    session = _load_session(session_id, user_id)
    if session is None or session["current"] is None:
        return None

    question = session["current"]["question"]
    concept = session["current"]["concept"]
    kind = session["current"].get("kind", "fresh")
    attempts = session["current"].get("attempts", 0)
    state = session["concepts"][concept]
    difficulty = question.get("difficulty", "medium")
    mode_cfg = MODES[session["mode"]]

    answer_mode = question.get("answer_mode", "multiple_choice")
    missing = None
    if answer_mode == "free_text":
        # LLM-judged grading of the student's own words. Fail open: a failed
        # grading call must never punish the student, so it counts as correct.
        graded = await ai_service.grade_free_text_answer(question, answer, session["text_content"])
        verdict = graded["verdict"] if graded else "correct"
        missing = graded.get("missing") if graded else None
    else:
        verdict = "correct" if answer.strip().lower() == question["correct_answer"].strip().lower() else "incorrect"

    correct = verdict == "correct"
    partial = verdict == "partial"

    session["questions_answered"] += 1
    state["questions_asked"] += 1
    if correct:
        session["correct_answers"] += 1
        state["questions_correct"] += 1
    state["last_correct"] = correct

    # Calibration log (ROADMAP_LEARNING 5): how sure they said they were vs.
    # how they did. A partial answer counts as a hit here — real substance
    # was there, so it isn't the clean miss overconfidence detection needs.
    # (.setdefault: sessions persisted before this field existed.)
    level = confidence if confidence in CALIBRATION_LEVELS else "medium"
    bucket = state.setdefault("calibration", {}).setdefault(level, {"answered": 0, "correct": 0})
    bucket["answered"] += 1
    if correct or partial:
        bucket["correct"] += 1

    evidence = {"fresh": "fresh", "verify": "variant", "recheck": "recheck"}[kind]
    evidence += "_correct" if correct else "_wrong"
    multipliers = CONFIDENCE_MULTIPLIER.get(confidence, CONFIDENCE_MULTIPLIER["medium"])
    if partial:
        # Partial credit: a smaller positive delta — real substance was
        # there, so it must not drop mastery like a plain miss.
        base = CORRECT_DELTA.get(difficulty, 0.18) * PARTIAL_CREDIT_FACTOR
        delta = base * EVIDENCE_WEIGHT[evidence.replace("_wrong", "_correct")] * multipliers["correct"]
    else:
        base = CORRECT_DELTA.get(difficulty, 0.18) if correct else WRONG_DELTA.get(difficulty, -0.18)
        delta = base * EVIDENCE_WEIGHT[evidence] * (multipliers["correct"] if correct else multipliers["wrong"])
    state["mastery"] = min(1.0, max(0.05, state["mastery"] + delta))

    # Schedule the follow-up that makes this answer count as real evidence.
    # A partial answer follows the "wrong" paths (the gap gets rechecked) but
    # never counts toward parking a concept.
    if kind == "fresh":
        if correct:
            # Verify by variant later — but don't pile up more verifications
            # than the mode's bar can consume.
            if state["variants_passed"] + _pending_verifies(session, concept) < mode_cfg["variants_required"]:
                _enqueue(session, "verify_queue", concept, question)
        else:
            _enqueue(session, "recheck_queue", concept, question)
    elif kind == "verify":
        if correct:
            state["variants_passed"] += 1
            if difficulty == "hard":
                state["hard_variant_passed"] = True
        else:
            # Memorization detected — after the correction, check it stuck.
            _enqueue(session, "recheck_queue", concept, question)
    else:  # recheck
        if not correct:
            if not partial:
                attempts += 1
            if attempts >= MAX_RECHECK_ATTEMPTS:
                # Park the concept: stop drilling it, drop its follow-ups,
                # and tell the student to re-read the material in the summary.
                state["parked"] = True
                session["verify_queue"] = [i for i in session["verify_queue"] if i["concept"] != concept]
                session["recheck_queue"] = [i for i in session["recheck_queue"] if i["concept"] != concept]
            else:
                _enqueue(session, "recheck_queue", concept, question, attempts=attempts)

    # Persist the new mastery estimate to the cross-session knowledge state.
    # Lifetime counters = counts before this session + this session's counts.
    if state.get("mastery_row_id"):
        try:
            await asyncio.to_thread(
                db.update_concept_mastery,
                state["mastery_row_id"],
                state["mastery"],
                state.get("prior_questions_asked", 0) + state["questions_asked"],
                state.get("prior_questions_correct", 0) + state["questions_correct"],
            )
        except Exception:
            pass
        # Lifetime calibration counters (base + session). Medium answers
        # don't move them, so skip the write; best-effort like everything
        # else (and separate, so a missing migration can't block mastery).
        if level != "medium":
            prior_cal = state.get("prior_calibration") or {}
            session_cal = state["calibration"]
            totals = {
                lv: {
                    key: prior_cal.get(lv, {}).get(key, 0) + session_cal.get(lv, {}).get(key, 0)
                    for key in ("answered", "correct")
                }
                for lv in ("high", "low")
            }
            try:
                await asyncio.to_thread(
                    db.update_concept_calibration,
                    state["mastery_row_id"],
                    totals["high"]["answered"], totals["high"]["correct"],
                    totals["low"]["answered"], totals["low"]["correct"],
                )
            except Exception:
                pass

    # Diagnose *why* the answer was wrong, not just that it was. Fail open:
    # a failed diagnosis call degrades to explanation-only feedback.
    diagnosis = None
    if not correct:
        diagnosis = await ai_service.diagnose_mistake(question, answer, session["text_content"])
        if diagnosis and state.get("mastery_row_id"):
            # Misconception memory: persist the diagnosis and use it for the
            # rest of this session too (newest first, capped like retrieval).
            state["prior_misconceptions"] = ([diagnosis] + state.get("prior_misconceptions", []))[:3]
            try:
                await asyncio.to_thread(
                    db.record_misconception, user_id, state["mastery_row_id"], concept, diagnosis
                )
            except Exception:
                pass

    # Answer log shaped like question_attempts rows, so a completed session
    # can be recorded as a quiz attempt (sidebar/stats/analytics).
    session["history"].append({
        "question_text": question["question"],
        "category": concept,
        "difficulty": difficulty,
        "user_answer": answer,
        "correct_answer": question["correct_answer"],
        "is_correct": correct,
        "question_index": session["questions_answered"] - 1,
    })

    session["current"] = None
    session["updated_at"] = time.time()

    # One-time soft checkpoint: offer to wrap up, without forcing it.
    checkpoint = False
    if session["questions_answered"] >= SOFT_CHECKPOINT and not session.get("checkpoint_shown"):
        checkpoint = True
        session["checkpoint_shown"] = True

    done = _session_complete(session) or session["questions_answered"] >= HARD_CAP

    response = {
        "correct": correct,
        "verdict": verdict,
        "missing": missing,
        "correct_answer": question["correct_answer"],
        "explanation": question.get("explanation"),
        "diagnosis": diagnosis,
        "done": done,
        "checkpoint": checkpoint,
        "next_question": None,
        "summary": None,
    }

    if done:
        response["summary"] = _finish_session(session_id, session)
    else:
        response["next_question"] = await _next_question(session, ai_service)
        try:
            db.save_tutor_session(session_id, session)
        except Exception:
            pass

    return response
