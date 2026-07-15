import os
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from supabase import create_client, Client

from .models import QuizQuestion

PLACEHOLDER_USER_ID = "00000000-0000-0000-0000-000000000001"

_client: Client = None


def _get_client() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required")
        _client = create_client(url, key)
    return _client


def get_or_create_user(external_id: str) -> str:
    """Look up the public.users row for a Supabase Auth user, creating one
    on first sight. Returns the public.users.id (not the external_id).
    """
    client = _get_client()

    existing = client.table("users").select("id").eq("external_id", external_id).execute()
    if existing.data:
        return existing.data[0]["id"]

    created = client.table("users").insert({"external_id": external_id}).execute()
    return created.data[0]["id"]


def create_subject(external_id: str, name: str) -> Dict:
    """Create a subject owned by the user, or return the existing one if a
    subject with this name (case-insensitive) already exists — idempotent
    "create or get" so the frontend doesn't need a separate existence check.
    """
    client = _get_client()
    user_id = get_or_create_user(external_id)

    name = name.strip()
    existing = (
        client.table("subjects")
        .select("id, name, created_at")
        .eq("user_id", user_id)
        .ilike("name", name)
        .execute()
        .data
    )
    if existing:
        return existing[0]

    created = client.table("subjects").insert({"user_id": user_id, "name": name}).execute()
    return created.data[0]


def list_subjects(external_id: str) -> List[Dict]:
    """All subjects owned by the requesting user."""
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return []
    user_id = user.data[0]["id"]

    return (
        client.table("subjects")
        .select("id, name, created_at")
        .eq("user_id", user_id)
        .order("name")
        .execute()
        .data
    )


def delete_subject(subject_id: str, external_id: str) -> bool:
    """Ownership-scoped subject delete. Attempts referencing this subject
    have subject_id set to null by the DB's ON DELETE SET NULL — they
    survive and fall into "Uncategorized" in subject-grouped views, never
    deleted themselves.
    """
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return False
    user_id = user.data[0]["id"]

    subject = client.table("subjects").select("id").eq("id", subject_id).eq("user_id", user_id).execute()
    if not subject.data:
        return False

    client.table("subjects").delete().eq("id", subject_id).execute()
    return True


def record_quiz_attempt(
    subject_id: str,
    difficulty: str,
    questions: List[QuizQuestion],
    user_answers: List[str],
    user_id: str = PLACEHOLDER_USER_ID,
) -> Dict:
    """Score a quiz, persist the attempt + per-question results, and return
    the same aggregate result shape the frontend already expects, plus the
    new attempt_id.
    """
    client = _get_client()

    subject_row = client.table("subjects").select("name").eq("id", subject_id).execute().data
    subject_name = subject_row[0]["name"] if subject_row else "Uncategorized"

    per_question = []
    correct_count = 0
    for index, (question, user_answer) in enumerate(zip(questions, user_answers)):
        is_correct = user_answer.strip().lower() == question.correct_answer.strip().lower()
        if is_correct:
            correct_count += 1
        per_question.append({
            "question_text": question.question,
            "category": question.category,
            "difficulty": question.difficulty,
            "user_answer": user_answer,
            "correct_answer": question.correct_answer,
            "is_correct": is_correct,
            "question_index": index,
        })

    total_questions = len(questions)
    score = (correct_count / total_questions) * 100 if total_questions else 0.0

    if score >= 90:
        feedback = "Excellent work! You've mastered this material."
        suggestion = "Consider trying a harder difficulty level."
    elif score >= 70:
        feedback = "Good job! You have a solid understanding."
        suggestion = "Review the areas you missed and try again."
    elif score >= 50:
        feedback = "You're getting there! Keep studying."
        suggestion = "Consider reviewing the material again or trying an easier difficulty."
    else:
        feedback = "Don't worry, this is part of learning!"
        suggestion = "Try reviewing the summary again and attempt an easier quiz."

    attempt_id = None
    try:
        attempt_result = client.table("quiz_attempts").insert({
            "user_id": user_id,
            "subject_id": subject_id,
            "subject": subject_name,
            "difficulty": difficulty,
            "total_questions": total_questions,
            "score": score,
        }).execute()
        attempt_id = attempt_result.data[0]["id"]

        for row in per_question:
            row["quiz_attempt_id"] = attempt_id
        client.table("question_attempts").insert(per_question).execute()
    except Exception:
        # Persistence is a quality-of-life addition, not a correctness
        # dependency — a DB failure should never block the user from seeing
        # their score.
        pass

    return {
        "score": score,
        "correct_answers": correct_count,
        "total_questions": total_questions,
        "feedback": feedback,
        "suggestion": suggestion,
        "passed": score >= 60,
        "attempt_id": attempt_id,
    }


def get_attempt_breakdown(attempt_id: str) -> Dict:
    """Aggregate a single attempt's question_attempts by category and by
    difficulty, for rendering real "performance by X" panels.
    """
    client = _get_client()
    rows = client.table("question_attempts").select("category, difficulty, is_correct").eq("quiz_attempt_id", attempt_id).execute().data

    def aggregate(key: str) -> List[Dict]:
        buckets: Dict[str, List[int]] = {}
        for row in rows:
            label = row.get(key) or "Uncategorized"
            correct, total = buckets.setdefault(label, [0, 0])
            buckets[label][1] += 1
            if row["is_correct"]:
                buckets[label][0] += 1
        return [
            {"label": label, "correct": correct, "total": total}
            for label, (correct, total) in buckets.items()
        ]

    return {
        "by_category": aggregate("category"),
        "by_difficulty": aggregate("difficulty"),
    }


def get_attempt_recap(attempt_id: str, external_id: str) -> Dict:
    """Full read-only recap of a single past attempt: attempt metadata plus
    every question's text, the user's answer, the correct answer, and
    correctness. Scoped to the requesting user — returns None if the
    attempt doesn't belong to them (or doesn't exist).
    """
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return None
    user_id = user.data[0]["id"]

    attempt = (
        client.table("quiz_attempts")
        .select("id, subject, difficulty, score, total_questions, created_at, user_id")
        .eq("id", attempt_id)
        .execute()
        .data
    )
    if not attempt or attempt[0]["user_id"] != user_id:
        return None
    attempt = attempt[0]

    questions = (
        client.table("question_attempts")
        .select("question_text, category, difficulty, user_answer, correct_answer, is_correct, question_index")
        .eq("quiz_attempt_id", attempt_id)
        .order("question_index")
        .execute()
        .data
    )

    return {
        "id": attempt["id"],
        "subject": attempt["subject"],
        "difficulty": attempt["difficulty"],
        "score": attempt["score"],
        "total_questions": attempt["total_questions"],
        "created_at": attempt["created_at"],
        "questions": questions,
    }


def get_recent_attempts(external_id: str, limit: int = 20) -> List[Dict]:
    """Lightweight list of a user's past attempts for a sidebar — just
    enough to render a clickable list, not the full recap.
    """
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return []
    user_id = user.data[0]["id"]

    return (
        client.table("quiz_attempts")
        .select("id, subject, difficulty, score, total_questions, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )


def get_user_stats(external_id: str) -> Dict:
    """Aggregate stats across all of a user's past quiz attempts, for a
    profile screen. Real numbers only — no attempts yet means zeros, not
    placeholder data.
    """
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return {"total_attempts": 0, "average_score": 0.0, "best_category": None, "recent_attempts": []}

    user_id = user.data[0]["id"]

    attempts = (
        client.table("quiz_attempts")
        .select("id, subject, difficulty, score, total_questions, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )

    total_attempts = len(attempts)
    average_score = sum(a["score"] for a in attempts) / total_attempts if total_attempts else 0.0

    best_category = None
    if total_attempts:
        attempt_ids = [a["id"] for a in attempts]
        questions = (
            client.table("question_attempts")
            .select("category, is_correct")
            .in_("quiz_attempt_id", attempt_ids)
            .execute()
            .data
        )
        buckets: Dict[str, List[int]] = {}
        for row in questions:
            label = row.get("category") or "Uncategorized"
            correct, total = buckets.setdefault(label, [0, 0])
            buckets[label][1] += 1
            if row["is_correct"]:
                buckets[label][0] += 1
        if buckets:
            best_category = max(
                buckets.items(),
                key=lambda item: (item[1][0] / item[1][1], item[1][1])
            )[0]

    return {
        "total_attempts": total_attempts,
        "average_score": average_score,
        "best_category": best_category,
        "recent_attempts": attempts[:10],
    }


def get_user_analytics(external_id: str) -> Dict:
    """Chart-ready datasets across all of a user's past quiz attempts:
    score trend over time, accuracy by category, accuracy by difficulty,
    accuracy by (user-created) subject, and quiz count by subject. All
    real, all-time aggregates — empty lists when there's no history yet,
    never fabricated data.
    """
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return {
            "score_trend": [],
            "by_category": [],
            "by_difficulty": [],
            "by_subject": [],
            "by_subject_accuracy": [],
        }

    user_id = user.data[0]["id"]

    attempts = (
        client.table("quiz_attempts")
        .select("id, subject, difficulty, score, total_questions, created_at")
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
        .data
    )

    score_trend = [
        {
            "attempt_id": a["id"],
            "subject": a["subject"],
            "score": a["score"],
            "created_at": a["created_at"],
        }
        for a in attempts
    ]

    subject_counts: Dict[str, int] = {}
    for a in attempts:
        subject_counts[a["subject"]] = subject_counts.get(a["subject"], 0) + 1
    by_subject = [{"label": label, "count": count} for label, count in subject_counts.items()]

    by_category: List[Dict] = []
    by_difficulty: List[Dict] = []
    by_subject_accuracy: List[Dict] = []
    if attempts:
        attempt_subject_by_id = {a["id"]: a["subject"] for a in attempts}
        attempt_ids = list(attempt_subject_by_id.keys())
        questions = (
            client.table("question_attempts")
            .select("quiz_attempt_id, category, difficulty, is_correct")
            .in_("quiz_attempt_id", attempt_ids)
            .execute()
            .data
        )

        def aggregate(key: str) -> List[Dict]:
            buckets: Dict[str, List[int]] = {}
            for row in questions:
                label = row.get(key) or "Uncategorized"
                correct, total = buckets.setdefault(label, [0, 0])
                buckets[label][1] += 1
                if row["is_correct"]:
                    buckets[label][0] += 1
            return [
                {"label": label, "correct": correct, "total": total, "accuracy": round((correct / total) * 100, 1)}
                for label, (correct, total) in buckets.items()
            ]

        by_category = aggregate("category")
        by_difficulty = aggregate("difficulty")

        subject_buckets: Dict[str, List[int]] = {}
        for row in questions:
            label = attempt_subject_by_id.get(row["quiz_attempt_id"]) or "Uncategorized"
            correct, total = subject_buckets.setdefault(label, [0, 0])
            subject_buckets[label][1] += 1
            if row["is_correct"]:
                subject_buckets[label][0] += 1
        by_subject_accuracy = [
            {"label": label, "correct": correct, "total": total, "accuracy": round((correct / total) * 100, 1)}
            for label, (correct, total) in subject_buckets.items()
        ]

    return {
        "score_trend": score_trend,
        "by_category": by_category,
        "by_difficulty": by_difficulty,
        "by_subject": by_subject,
        "by_subject_accuracy": by_subject_accuracy,
    }


# --- Documents library (ROADMAP 3.1) ------------------------------------------
# The memory layer already stores every upload (documents + document_chunks);
# these functions make that store user-visible: list, re-open, delete.


def list_documents(external_id: str) -> List[Dict]:
    """All of a user's stored uploads, newest first, with chunk counts."""
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return []
    user_id = user.data[0]["id"]

    documents = (
        client.table("documents")
        .select("id, filename, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    if not documents:
        return []

    chunk_rows = (
        client.table("document_chunks")
        .select("document_id")
        .eq("user_id", user_id)
        .execute()
        .data
    )
    counts: Dict[str, int] = {}
    for row in chunk_rows:
        counts[row["document_id"]] = counts.get(row["document_id"], 0) + 1

    return [
        {**doc, "chunk_count": counts.get(doc["id"], 0)}
        for doc in documents
    ]


def get_document_content(document_id: str, external_id: str) -> Optional[Dict]:
    """Re-hydrate a stored document's text by reassembling its chunks in
    order, so the user can study last week's upload without re-uploading.
    Ownership-scoped; returns None for foreign/unknown documents."""
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return None
    user_id = user.data[0]["id"]

    document = (
        client.table("documents")
        .select("id, filename, created_at")
        .eq("id", document_id)
        .eq("user_id", user_id)
        .execute()
        .data
    )
    if not document:
        return None
    document = document[0]

    chunks = (
        client.table("document_chunks")
        .select("chunk_index, content")
        .eq("document_id", document_id)
        .order("chunk_index")
        .execute()
        .data
    )
    text_content = "\n\n".join(chunk["content"] for chunk in chunks)

    return {
        "id": document["id"],
        "filename": document["filename"],
        "created_at": document["created_at"],
        "text_content": text_content,
        "word_count": len(text_content.split()),
    }


def delete_document(document_id: str, external_id: str) -> bool:
    """Ownership-scoped document delete; chunks go with it (ON DELETE
    CASCADE on document_chunks.document_id)."""
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return False
    user_id = user.data[0]["id"]

    document = client.table("documents").select("id").eq("id", document_id).eq("user_id", user_id).execute()
    if not document.data:
        return False

    client.table("documents").delete().eq("id", document_id).execute()
    return True


# --- Tutor session persistence (ROADMAP 1.1) ---------------------------------
# tutor_sessions is the source of truth; tutor_agent keeps an in-memory dict
# as a hot cache and treats every function here as best-effort (a DB failure
# degrades to the old memory-only behavior, never fails the student's session).

_TUTOR_STATE_FIELDS = (
    "concepts", "asked_questions", "current", "history",
    "verify_queue", "recheck_queue", "checkpoint_shown",
    "questions_answered", "correct_answers",
)


def create_tutor_session(external_id: str, session: Dict) -> str:
    """Insert a new active tutor session and return its DB-generated id,
    which becomes the public session_id."""
    client = _get_client()
    user_id = get_or_create_user(external_id)

    row = {
        "user_id": user_id,
        "subject": session["subject"],
        "text_content": session["text_content"],
        "mode": session["mode"],
        **{field: session[field] for field in _TUTOR_STATE_FIELDS},
    }
    result = client.table("tutor_sessions").insert(row).execute()
    return result.data[0]["id"]


def get_tutor_session(session_id: str, external_id: str) -> Optional[Dict]:
    """Load an active tutor session, scoped to the requesting user. Returns
    the session state dict in tutor_agent's in-memory shape, or None."""
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return None

    rows = (
        client.table("tutor_sessions")
        .select("subject, text_content, mode, " + ", ".join(_TUTOR_STATE_FIELDS))
        .eq("id", session_id)
        .eq("user_id", user.data[0]["id"])
        .eq("status", "active")
        .execute()
        .data
    )
    if not rows:
        return None
    row = rows[0]

    return {
        "user_id": external_id,
        "subject": row["subject"],
        "text_content": row["text_content"],
        "mode": row["mode"],
        **{field: row[field] for field in _TUTOR_STATE_FIELDS},
        "updated_at": time.time(),
    }


def save_tutor_session(session_id: str, session: Dict) -> None:
    """Write the mutable session state back after an answer/new question."""
    client = _get_client()
    update = {field: session[field] for field in _TUTOR_STATE_FIELDS}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    client.table("tutor_sessions").update(update).eq("id", session_id).execute()


def complete_tutor_session(session_id: str, session: Dict) -> None:
    """Mark the session completed and record it as a quiz attempt (plus
    per-question rows from the session's answer history) so tutor runs show
    up in the recent-attempts sidebar, stats, and analytics."""
    client = _get_client()

    client.table("tutor_sessions").update({
        "status": "completed",
        **{field: session[field] for field in _TUTOR_STATE_FIELDS},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", session_id).execute()

    total = session["questions_answered"]
    if not total:
        return
    score = (session["correct_answers"] / total) * 100

    user_id = get_or_create_user(session["user_id"])
    attempt = client.table("quiz_attempts").insert({
        "user_id": user_id,
        "subject_id": None,  # tutor sessions aren't tied to a subjects row
        "subject": session["subject"],
        "difficulty": "adaptive",
        "total_questions": total,
        "score": score,
    }).execute()
    attempt_id = attempt.data[0]["id"]

    question_rows = [{**entry, "quiz_attempt_id": attempt_id} for entry in session["history"]]
    if question_rows:
        client.table("question_attempts").insert(question_rows).execute()


# --- Spaced repetition for flashcards (ROADMAP 4.1) ---------------------------
# SM-2-style scheduling: each card carries (interval_days, ease, repetitions,
# due_at), updated by self-graded reviews. "again" resets the card into a
# short learning step; the other grades grow the interval multiplicatively.

MIN_EASE = 1.3
AGAIN_RELEARN_MINUTES = 10


def _schedule_review(interval_days: float, ease: float, repetitions: int, grade: str) -> Dict:
    """Next scheduling state after one self-graded review."""
    if grade == "again":
        return {
            "interval_days": 0.0,
            "ease": max(MIN_EASE, ease - 0.2),
            "repetitions": 0,
            "due_in": timedelta(minutes=AGAIN_RELEARN_MINUTES),
        }
    if grade == "hard":
        interval = 1.0 if repetitions == 0 else max(1.0, interval_days * 1.2)
        return {
            "interval_days": interval,
            "ease": max(MIN_EASE, ease - 0.15),
            "repetitions": repetitions + 1,
            "due_in": timedelta(days=interval),
        }
    if grade == "easy":
        interval = 4.0 if repetitions == 0 else max(1.0, interval_days) * ease * 1.3
        return {
            "interval_days": interval,
            "ease": ease + 0.15,
            "repetitions": repetitions + 1,
            "due_in": timedelta(days=interval),
        }
    # "good" (default): classic SM-2 progression 1d -> 6d -> interval * ease.
    if repetitions == 0:
        interval = 1.0
    elif repetitions == 1:
        interval = 6.0
    else:
        interval = interval_days * ease
    return {
        "interval_days": interval,
        "ease": ease,
        "repetitions": repetitions + 1,
        "due_in": timedelta(days=interval),
    }


def save_flashcard_set(
    external_id: str, subject: str, card_type: str, cards: List[Dict],
    document_id: Optional[str] = None,
) -> Optional[str]:
    """Persist a freshly generated flashcard set with every card immediately
    due (first review seeds its schedule). Returns the set id."""
    client = _get_client()
    user_id = get_or_create_user(external_id)

    set_row = client.table("flashcard_sets").insert({
        "user_id": user_id,
        "subject": subject,
        "card_type": card_type,
        "document_id": document_id,
    }).execute()
    set_id = set_row.data[0]["id"]

    client.table("flashcards").insert([
        {
            "set_id": set_id,
            "user_id": user_id,
            "front": card["front"],
            "back": card["back"],
            "category": card.get("category"),
        }
        for card in cards
    ]).execute()
    return set_id


def get_due_flashcards(external_id: str, limit: int = 100) -> Dict:
    """Cards due for review now (most overdue first) plus the total due
    count, for the review screen and the due-count badge."""
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return {"cards": [], "total_due": 0}
    user_id = user.data[0]["id"]

    now = datetime.now(timezone.utc).isoformat()
    result = (
        client.table("flashcards")
        .select("id, front, back, category, due_at, repetitions, flashcard_sets(subject)", count="exact")
        .eq("user_id", user_id)
        .lte("due_at", now)
        .order("due_at")
        .limit(limit)
        .execute()
    )

    cards = [
        {
            "id": row["id"],
            "front": row["front"],
            "back": row["back"],
            "category": row.get("category"),
            "subject": (row.get("flashcard_sets") or {}).get("subject", ""),
            "due_at": row["due_at"],
            "repetitions": row["repetitions"],
        }
        for row in result.data
    ]
    return {"cards": cards, "total_due": result.count if result.count is not None else len(cards)}


def review_flashcard(card_id: str, external_id: str, grade: str) -> Optional[Dict]:
    """Apply one self-graded review to a card and return its new schedule.
    Ownership-scoped; returns None for foreign/unknown cards."""
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return None
    user_id = user.data[0]["id"]

    card = (
        client.table("flashcards")
        .select("id, interval_days, ease, repetitions")
        .eq("id", card_id)
        .eq("user_id", user_id)
        .execute()
        .data
    )
    if not card:
        return None
    card = card[0]

    schedule = _schedule_review(card["interval_days"], card["ease"], card["repetitions"], grade)
    now = datetime.now(timezone.utc)
    due_at = now + schedule.pop("due_in")

    client.table("flashcards").update({
        **schedule,
        "due_at": due_at.isoformat(),
        "last_reviewed_at": now.isoformat(),
    }).eq("id", card_id).execute()

    return {**schedule, "due_at": due_at.isoformat()}


# --- Cross-session concept mastery (ROADMAP 1.2) ------------------------------
# Free-text concept names are matched by embedding similarity (same local
# model as the memory layer) so differently-phrased names for the same
# concept share one row per user instead of duplicating.

# Concept names are short phrases; bge-small scores rephrasings of the same
# concept ("Cell Respiration" / "Cellular respiration") well above 0.9 and
# related-but-distinct concepts noticeably lower. Slightly stricter than the
# memory layer's 0.80 chunk threshold because short strings sit closer
# together in embedding space.
CONCEPT_MATCH_THRESHOLD = 0.85


def match_concept_mastery(external_id: str, embedding: List[float]) -> Optional[Dict]:
    """Nearest stored concept-mastery row for this user above the match
    threshold, or None. Returns id, concept, mastery, and lifetime counters."""
    client = _get_client()

    user = client.table("users").select("id").eq("external_id", external_id).execute()
    if not user.data:
        return None

    rows = client.rpc("match_concept_mastery", {
        "query_embedding": embedding,
        "target_user_id": user.data[0]["id"],
        "match_threshold": CONCEPT_MATCH_THRESHOLD,
        "match_count": 1,
    }).execute().data or []
    return rows[0] if rows else None


def create_concept_mastery(external_id: str, concept: str, embedding: List[float], mastery: float) -> str:
    """First sighting of a concept for this user — insert and return the row id."""
    client = _get_client()
    user_id = get_or_create_user(external_id)
    created = client.table("concept_mastery").insert({
        "user_id": user_id,
        "concept": concept,
        "embedding": embedding,
        "mastery": mastery,
    }).execute()
    return created.data[0]["id"]


def update_concept_mastery(row_id: str, mastery: float, questions_asked: int, questions_correct: int) -> None:
    """Write the current mastery estimate and lifetime counters back."""
    client = _get_client()
    client.table("concept_mastery").update({
        "mastery": mastery,
        "questions_asked": questions_asked,
        "questions_correct": questions_correct,
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", row_id).execute()


def record_misconception(external_id: str, concept_mastery_id: str, concept: str, misconception: str) -> None:
    """Persist one diagnosed misconception, linked to the concept's mastery row."""
    client = _get_client()
    user_id = get_or_create_user(external_id)
    client.table("misconceptions").insert({
        "user_id": user_id,
        "concept_mastery_id": concept_mastery_id,
        "concept": concept,
        "misconception": misconception,
    }).execute()


def get_recent_misconceptions(concept_mastery_id: str, limit: int = 3) -> List[str]:
    """Most recent diagnosed misconceptions for one concept, newest first."""
    client = _get_client()
    rows = (
        client.table("misconceptions")
        .select("misconception")
        .eq("concept_mastery_id", concept_mastery_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )
    return [row["misconception"] for row in rows]
