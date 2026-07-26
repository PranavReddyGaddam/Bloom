import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from psycopg.types.json import Jsonb

from .database import cursor, transaction, retry_on_serialization_failure, to_vector, from_vector
from .models import QuizQuestion

PLACEHOLDER_USER_ID = "00000000-0000-0000-0000-000000000001"


def _row(row: Optional[Dict]) -> Optional[Dict]:
    """Normalize one psycopg row to the shape supabase-py returned.

    psycopg returns native Python types where supabase-py returned JSON
    scalars: `uuid.UUID` for uuid columns and `datetime` for timestamptz.
    The API models declare `id: str` / `created_at: str` (models.py:97-100)
    and pydantic v2 is strict, so handing them a UUID or datetime raises
    ValidationError and the endpoint 500s.

    Converting here rather than loosening the models keeps this migration a
    pure data-layer change — callers and response schemas stay untouched,
    which is the invariant the whole port is built on.
    """
    if row is None:
        return None
    out = {}
    for key, value in row.items():
        if isinstance(value, uuid.UUID):
            out[key] = str(value)
        elif isinstance(value, datetime):
            # Supabase rendered timestamptz as ISO-8601 with a 'Z' suffix;
            # match it exactly so frontend date parsing is unaffected.
            out[key] = value.isoformat().replace("+00:00", "Z")
        else:
            out[key] = value
    return out


def _rows(rows: List[Dict]) -> List[Dict]:
    """_row() over a result set."""
    return [_row(r) for r in rows]


def _lookup_user_id(external_id: str) -> Optional[str]:
    """public.users.id for an external_id, or None if the user has no row yet.

    Replaces the `client.table("users").select("id").eq(...)` preamble that
    opened most read functions. Callers that must not create a user (every
    read path) use this; get_or_create_user() is for write paths.
    """
    with cursor() as cur:
        cur.execute("SELECT id FROM users WHERE external_id = %s", (external_id,))
        row = cur.fetchone()
        return str(row["id"]) if row else None


def get_or_create_user(external_id: str) -> str:
    """Look up the public.users row for a Supabase Auth user, creating one
    on first sight. Returns the public.users.id (not the external_id).
    """
    with cursor() as cur:
        cur.execute("SELECT id FROM users WHERE external_id = %s", (external_id,))
        row = cur.fetchone()
        if row:
            return str(row["id"])

        # ON CONFLICT closes a read-then-write race the Supabase version had:
        # two concurrent first-requests for the same user could both miss the
        # SELECT and then both INSERT, and external_id is UNIQUE. DO NOTHING
        # returns no row on conflict, so re-SELECT to get the winner's id.
        cur.execute(
            "INSERT INTO users (external_id) VALUES (%s)"
            " ON CONFLICT (external_id) DO NOTHING RETURNING id",
            (external_id,),
        )
        row = cur.fetchone()
        if row:
            return str(row["id"])

        cur.execute("SELECT id FROM users WHERE external_id = %s", (external_id,))
        return str(cur.fetchone()["id"])


def create_subject(external_id: str, name: str) -> Dict:
    """Create a subject owned by the user, or return the existing one if a
    subject with this name (case-insensitive) already exists — idempotent
    "create or get" so the frontend doesn't need a separate existence check.
    """
    user_id = get_or_create_user(external_id)
    name = name.strip()

    with cursor() as cur:
        cur.execute(
            "SELECT id, name, created_at FROM subjects"
            " WHERE user_id = %s AND name ILIKE %s",
            (user_id, name),
        )
        existing = cur.fetchone()
        if existing:
            return _row(existing)

        # The unique constraint is (user_id, name) — case-SENSITIVE — while the
        # lookup above is case-insensitive, so ON CONFLICT narrows the race but
        # cannot close it for names differing only in case. Matches the
        # Supabase behavior; a same-case race now resolves to the existing row
        # instead of raising.
        cur.execute(
            "INSERT INTO subjects (user_id, name) VALUES (%s, %s)"
            " ON CONFLICT (user_id, name) DO NOTHING"
            " RETURNING id, name, created_at",
            (user_id, name),
        )
        created = cur.fetchone()
        if created:
            return _row(created)

        cur.execute(
            "SELECT id, name, created_at FROM subjects"
            " WHERE user_id = %s AND name ILIKE %s",
            (user_id, name),
        )
        return _row(cur.fetchone())


def list_subjects(external_id: str) -> List[Dict]:
    """All subjects owned by the requesting user."""
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return []

    with cursor() as cur:
        cur.execute(
            "SELECT id, name, created_at FROM subjects WHERE user_id = %s ORDER BY name",
            (user_id,),
        )
        return _rows(cur.fetchall())


def delete_subject(subject_id: str, external_id: str) -> bool:
    """Ownership-scoped subject delete. Attempts referencing this subject
    have subject_id set to null by the DB's ON DELETE SET NULL — they
    survive and fall into "Uncategorized" in subject-grouped views, never
    deleted themselves.
    """
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return False

    with cursor() as cur:
        # Ownership is enforced in the DELETE's own predicate rather than by a
        # preceding SELECT: one statement, and no window between check and
        # delete. RETURNING tells us whether a row actually matched.
        cur.execute(
            "DELETE FROM subjects WHERE id = %s AND user_id = %s RETURNING id",
            (subject_id, user_id),
        )
        return cur.fetchone() is not None


@retry_on_serialization_failure
def _persist_quiz_attempt(
    user_id: str,
    subject_id: str,
    subject_name: str,
    difficulty: str,
    total_questions: int,
    score: float,
    per_question: List[Dict],
) -> str:
    """Write the attempt and its question rows atomically.

    Supabase issued these as two independent calls, so a failure between them
    left an attempt with no questions — a row that renders as an empty recap.
    One transaction makes that impossible. Retried on serialization failure:
    the whole body re-runs from a clean rollback, so it is safe to repeat.
    """
    with transaction() as cur:
        cur.execute(
            "INSERT INTO quiz_attempts"
            " (user_id, subject_id, subject, difficulty, total_questions, score)"
            " VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
            (user_id, subject_id, subject_name, difficulty, total_questions, score),
        )
        attempt_id = str(cur.fetchone()["id"])

        if per_question:
            cur.executemany(
                "INSERT INTO question_attempts"
                " (quiz_attempt_id, question_text, category, difficulty,"
                "  user_answer, correct_answer, is_correct, question_index)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                [
                    (attempt_id, q["question_text"], q["category"], q["difficulty"],
                     q["user_answer"], q["correct_answer"], q["is_correct"],
                     q["question_index"])
                    for q in per_question
                ],
            )
        return attempt_id


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
    with cursor() as cur:
        cur.execute("SELECT name FROM subjects WHERE id = %s", (subject_id,))
        subject_row = cur.fetchone()
    subject_name = subject_row["name"] if subject_row else "Uncategorized"

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
        attempt_id = _persist_quiz_attempt(
            user_id, subject_id, subject_name, difficulty,
            total_questions, score, per_question,
        )
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
    with cursor() as cur:
        cur.execute(
            "SELECT category, difficulty, is_correct FROM question_attempts"
            " WHERE quiz_attempt_id = %s",
            (attempt_id,),
        )
        rows = cur.fetchall()

    def aggregate(key: str) -> List[Dict]:
        buckets: Dict[str, List[int]] = {}
        for row in rows:
            label = row.get(key) or "Uncategorized"
            correct, total = buckets.setdefault(label, [0, 0])
            buckets[label][1] += 1
            if row["is_correct"]:
                buckets[label][0] += 1
        # Sorted so the panels render in a stable order regardless of the
        # order the database returned rows in.
        return [
            {"label": label, "correct": correct, "total": total}
            for label, (correct, total) in sorted(buckets.items())
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
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return None

    with cursor() as cur:
        # Ownership folded into the WHERE clause rather than compared in
        # Python afterwards — same result, one fewer round trip, and no way
        # to forget the check.
        cur.execute(
            "SELECT id, subject, difficulty, score, total_questions, created_at"
            " FROM quiz_attempts WHERE id = %s AND user_id = %s",
            (attempt_id, user_id),
        )
        attempt = cur.fetchone()
        if not attempt:
            return None

        cur.execute(
            "SELECT question_text, category, difficulty, user_answer,"
            " correct_answer, is_correct, question_index"
            " FROM question_attempts WHERE quiz_attempt_id = %s"
            " ORDER BY question_index",
            (attempt_id,),
        )
        questions = _rows(cur.fetchall())

    attempt = _row(attempt)
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
    """Lightweight list of a user's past attempts — just enough to render a
    clickable list, not the full recap.

    The default suits a short preview; the scores page raises the limit to show
    a full history.
    """
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return []

    with cursor() as cur:
        cur.execute(
            "SELECT id, subject, difficulty, score, total_questions, created_at"
            " FROM quiz_attempts WHERE user_id = %s"
            " ORDER BY created_at DESC LIMIT %s",
            (user_id, limit),
        )
        return _rows(cur.fetchall())


def get_user_stats(external_id: str) -> Dict:
    """Aggregate stats across all of a user's past quiz attempts, for a
    profile screen. Real numbers only — no attempts yet means zeros, not
    placeholder data.
    """
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return {"total_attempts": 0, "average_score": 0.0, "best_category": None, "recent_attempts": []}

    with cursor() as cur:
        cur.execute(
            "SELECT id, subject, difficulty, score, total_questions, created_at"
            " FROM quiz_attempts WHERE user_id = %s ORDER BY created_at DESC",
            (user_id,),
        )
        attempts = _rows(cur.fetchall())

        total_attempts = len(attempts)
        average_score = sum(a["score"] for a in attempts) / total_attempts if total_attempts else 0.0

        best_category = None
        if total_attempts:
            attempt_ids = [a["id"] for a in attempts]
            # `= ANY(%s)` passes the ids as ONE array parameter. The Supabase
            # `.in_()` expanded to an inline list that grows without bound as
            # history accumulates — a genuine CockroachDB anti-pattern.
            # ORDER BY is load-bearing, not cosmetic: best_category below
            # breaks ties with max(), which returns the first maximum it
            # sees. Without a stable row order two categories tied at 1/1
            # resolve differently run to run — Supabase and CockroachDB
            # disagreed here, and Supabase alone was never guaranteed either.
            cur.execute(
                "SELECT category, is_correct FROM question_attempts"
                " WHERE quiz_attempt_id = ANY(%s)"
                " ORDER BY category NULLS FIRST, id",
                (attempt_ids,),
            )
            questions = cur.fetchall()

            buckets: Dict[str, List[int]] = {}
            for row in questions:
                label = row.get("category") or "Uncategorized"
                correct, total = buckets.setdefault(label, [0, 0])
                buckets[label][1] += 1
                if row["is_correct"]:
                    buckets[label][0] += 1
            if buckets:
                # Rank by accuracy, then by sample size, then alphabetically
                # (reversed, so ties resolve to the first name alphabetically
                # rather than the last).
                #
                # The tiebreak matters more than it looks: on real data ten
                # categories sit tied at 1/1, so "best" was decided purely by
                # whatever order the database returned rows in — it differed
                # between Supabase and CockroachDB and was never stable on
                # either. The sample-size key means a category answered 5/5
                # now outranks one answered 1/1, which is also the more honest
                # answer to "what are you best at".
                best_category = min(
                    buckets.items(),
                    key=lambda item: (
                        -(item[1][0] / item[1][1]),  # highest accuracy first
                        -item[1][1],                 # then most questions
                        item[0],                     # then alphabetical
                    ),
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
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return {
            "score_trend": [],
            "by_category": [],
            "by_difficulty": [],
            "by_subject": [],
            "by_subject_accuracy": [],
        }

    with cursor() as cur:
        cur.execute(
            "SELECT id, subject, difficulty, score, total_questions, created_at"
            " FROM quiz_attempts WHERE user_id = %s ORDER BY created_at",
            (user_id,),
        )
        attempts = _rows(cur.fetchall())

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
    by_subject = [{"label": label, "count": count} for label, count in sorted(subject_counts.items())]

    by_category: List[Dict] = []
    by_difficulty: List[Dict] = []
    by_subject_accuracy: List[Dict] = []
    if attempts:
        attempt_subject_by_id = {a["id"]: a["subject"] for a in attempts}
        attempt_ids = list(attempt_subject_by_id.keys())
        with cursor() as cur:
            cur.execute(
                "SELECT quiz_attempt_id, category, difficulty, is_correct"
                " FROM question_attempts WHERE quiz_attempt_id = ANY(%s)",
                (attempt_ids,),
            )
            # quiz_attempt_id is joined back to attempt_subject_by_id below,
            # whose keys came through _rows() as strings — so these must be
            # strings too or every lookup silently misses and every bucket
            # falls into "Uncategorized".
            questions = _rows(cur.fetchall())

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
                for label, (correct, total) in sorted(buckets.items())
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
            for label, (correct, total) in sorted(subject_buckets.items())
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
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return []

    with cursor() as cur:
        # The chunk count is a GROUP BY in the database now. Supabase fetched
        # every chunk row for the user and counted them in Python — fine at 95
        # chunks, but it grows with the corpus while only the counts are used.
        # LEFT JOIN so a document with zero chunks still appears, matching the
        # counts.get(doc["id"], 0) default it replaces.
        cur.execute(
            "SELECT d.id, d.filename, d.created_at, count(dc.id) AS chunk_count"
            " FROM documents d"
            " LEFT JOIN document_chunks dc ON dc.document_id = d.id"
            " WHERE d.user_id = %s"
            " GROUP BY d.id, d.filename, d.created_at"
            " ORDER BY d.created_at DESC",
            (user_id,),
        )
        return _rows(cur.fetchall())


def get_document_content(document_id: str, external_id: str) -> Optional[Dict]:
    """Re-hydrate a stored document's text by reassembling its chunks in
    order, so the user can study last week's upload without re-uploading.
    Ownership-scoped; returns None for foreign/unknown documents."""
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return None

    with cursor() as cur:
        cur.execute(
            "SELECT id, filename, created_at FROM documents"
            " WHERE id = %s AND user_id = %s",
            (document_id, user_id),
        )
        document = cur.fetchone()
        if not document:
            return None
        document = _row(document)

        cur.execute(
            "SELECT chunk_index, content FROM document_chunks"
            " WHERE document_id = %s ORDER BY chunk_index",
            (document_id,),
        )
        chunks = cur.fetchall()
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
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return False

    with cursor() as cur:
        cur.execute(
            "DELETE FROM documents WHERE id = %s AND user_id = %s RETURNING id",
            (document_id, user_id),
        )
        return cur.fetchone() is not None


# --- Tutor session persistence (ROADMAP 1.1) ---------------------------------
# tutor_sessions is the source of truth; tutor_agent keeps an in-memory dict
# as a hot cache and treats every function here as best-effort (a DB failure
# degrades to the old memory-only behavior, never fails the student's session).

_TUTOR_STATE_FIELDS = (
    "concepts", "asked_questions", "current", "history",
    "verify_queue", "recheck_queue", "checkpoint_shown",
    "questions_answered", "correct_answers",
)

# Which of the above are jsonb columns. psycopg needs dicts and lists wrapped
# in Jsonb() to adapt them as jsonb rather than failing on an unknown type;
# the remaining three (checkpoint_shown, questions_answered, correct_answers)
# are a bool and two ints and must NOT be wrapped.
_TUTOR_JSONB_FIELDS = frozenset({
    "concepts", "asked_questions", "current", "history",
    "verify_queue", "recheck_queue",
})


def _tutor_state_param(field: str, value):
    """Adapt one _TUTOR_STATE_FIELDS value for psycopg."""
    if field in _TUTOR_JSONB_FIELDS:
        # `current` is nullable; Jsonb(None) would write a jsonb 'null' rather
        # than a SQL NULL, and get_tutor_session distinguishes them.
        return None if value is None else Jsonb(value)
    return value


def create_tutor_session(external_id: str, session: Dict) -> str:
    """Insert a new active tutor session and return its DB-generated id,
    which becomes the public session_id."""
    user_id = get_or_create_user(external_id)

    # Column list is built from the same module-level constant that drives the
    # SELECT and UPDATE below, so the three can never drift apart. The only
    # non-parameterized interpolation in this file: every element of
    # _TUTOR_STATE_FIELDS is a hard-coded literal, never user input.
    state_cols = ", ".join(_TUTOR_STATE_FIELDS)
    placeholders = ", ".join(["%s"] * len(_TUTOR_STATE_FIELDS))

    with cursor() as cur:
        cur.execute(
            f"INSERT INTO tutor_sessions"
            f" (user_id, subject, text_content, sources, mode, {state_cols})"
            f" VALUES (%s, %s, %s, %s, %s, {placeholders}) RETURNING id",
            (
                user_id,
                session["subject"],
                session["text_content"],
                # The session's material, one entry per document
                # (ROADMAP_LEARNING 3). Immutable for the session's life, like
                # text_content — so it is not in _TUTOR_STATE_FIELDS.
                Jsonb(session["sources"]) if session["sources"] is not None else None,
                session["mode"],
                *[_tutor_state_param(f, session[f]) for f in _TUTOR_STATE_FIELDS],
            ),
        )
        return str(cur.fetchone()["id"])


def get_tutor_session(session_id: str, external_id: str) -> Optional[Dict]:
    """Load an active tutor session, scoped to the requesting user. Returns
    the session state dict in tutor_agent's in-memory shape, or None."""
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return None

    state_cols = ", ".join(_TUTOR_STATE_FIELDS)
    with cursor() as cur:
        cur.execute(
            f"SELECT subject, text_content, sources, mode, {state_cols}"
            f" FROM tutor_sessions"
            f" WHERE id = %s AND user_id = %s AND status = 'active'",
            (session_id, user_id),
        )
        row = cur.fetchone()
    if not row:
        return None

    return {
        "user_id": external_id,
        "subject": row["subject"],
        "text_content": row["text_content"],
        # Sessions started before multi-document support have no sources —
        # rebuild the single-source shape from the blob they do have.
        "sources": row.get("sources") or [{
            "text_content": row["text_content"],
            "filename": row["subject"],
            "document_id": None,
        }],
        "mode": row["mode"],
        **{field: row[field] for field in _TUTOR_STATE_FIELDS},
        "updated_at": time.time(),
    }


def save_tutor_session(session_id: str, session: Dict) -> None:
    """Write the mutable session state back after an answer/new question."""
    assignments = ", ".join(f"{field} = %s" for field in _TUTOR_STATE_FIELDS)
    with cursor() as cur:
        cur.execute(
            f"UPDATE tutor_sessions SET {assignments}, updated_at = now()"
            f" WHERE id = %s",
            (
                *[_tutor_state_param(f, session[f]) for f in _TUTOR_STATE_FIELDS],
                session_id,
            ),
        )


def complete_tutor_session(session_id: str, session: Dict) -> None:
    """Mark the session completed and record it as a quiz attempt (plus
    per-question rows from the session's answer history) so tutor runs show
    up in the recent-attempts sidebar, stats, and analytics."""
    total = session["questions_answered"]
    # get_or_create_user opens its own connection, so resolve it before the
    # transaction below rather than nesting a second pool checkout inside it.
    user_id = get_or_create_user(session["user_id"]) if total else None

    _complete_tutor_session_tx(session_id, session, total, user_id)


@retry_on_serialization_failure
def _complete_tutor_session_tx(session_id: str, session: Dict, total: int,
                               user_id: Optional[str]) -> None:
    """Mark completed and record the attempt, atomically.

    Supabase issued up to three independent writes here. A failure partway
    through could mark a session completed while its quiz attempt was never
    recorded (the session disappears from the sidebar but never appears in
    history), or record an attempt with no question rows. One transaction
    makes the whole thing all-or-nothing.
    """
    assignments = ", ".join(f"{field} = %s" for field in _TUTOR_STATE_FIELDS)

    with transaction() as cur:
        cur.execute(
            f"UPDATE tutor_sessions SET status = 'completed', {assignments},"
            f" updated_at = now() WHERE id = %s",
            (
                *[_tutor_state_param(f, session[f]) for f in _TUTOR_STATE_FIELDS],
                session_id,
            ),
        )

        if not total:
            return

        score = (session["correct_answers"] / total) * 100
        cur.execute(
            "INSERT INTO quiz_attempts"
            " (user_id, subject_id, subject, difficulty, total_questions, score)"
            " VALUES (%s, NULL, %s, 'adaptive', %s, %s) RETURNING id",
            (user_id, session["subject"], total, score),
        )
        attempt_id = str(cur.fetchone()["id"])

        history = session["history"]
        if history:
            cur.executemany(
                "INSERT INTO question_attempts"
                " (quiz_attempt_id, question_text, category, difficulty,"
                "  user_answer, correct_answer, is_correct, question_index)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                [
                    (attempt_id, e["question_text"], e.get("category"),
                     e.get("difficulty"), e["user_answer"], e["correct_answer"],
                     e["is_correct"], e["question_index"])
                    for e in history
                ],
            )


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
    user_id = get_or_create_user(external_id)
    return _save_flashcard_set_tx(user_id, subject, card_type, cards, document_id)


@retry_on_serialization_failure
def _save_flashcard_set_tx(user_id: str, subject: str, card_type: str,
                           cards: List[Dict], document_id: Optional[str]) -> str:
    """Set + cards in one transaction, so a failure can't leave an empty set."""
    with transaction() as cur:
        cur.execute(
            "INSERT INTO flashcard_sets (user_id, subject, card_type, document_id)"
            " VALUES (%s,%s,%s,%s) RETURNING id",
            (user_id, subject, card_type, document_id),
        )
        set_id = str(cur.fetchone()["id"])

        if cards:
            cur.executemany(
                "INSERT INTO flashcards (set_id, user_id, front, back, category)"
                " VALUES (%s,%s,%s,%s,%s)",
                [
                    (set_id, user_id, c["front"], c["back"], c.get("category"))
                    for c in cards
                ],
            )
        return set_id


def get_due_flashcards(external_id: str, limit: int = 100) -> Dict:
    """Cards due for review now (most overdue first) plus the total due
    count, for the review screen and the due-count badge."""
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return {"cards": [], "total_due": 0}

    with cursor() as cur:
        # Supabase's embedded `flashcard_sets(subject)` becomes a JOIN, and its
        # count="exact" (the pre-LIMIT total, for the due badge) becomes a
        # window count — computed over the full matching set before LIMIT
        # applies, so one query still yields both the page and the true total.
        cur.execute(
            "SELECT f.id, f.front, f.back, f.category, f.due_at, f.repetitions,"
            " fs.subject, count(*) OVER () AS total_due"
            " FROM flashcards f"
            " JOIN flashcard_sets fs ON fs.id = f.set_id"
            " WHERE f.user_id = %s AND f.due_at <= now()"
            # f.id breaks ties: a freshly generated set has every card due at
            # the same instant, so due_at alone leaves the order undefined and
            # the review screen would shuffle between loads.
            " ORDER BY f.due_at, f.id LIMIT %s",
            (user_id, limit),
        )
        rows = _rows(cur.fetchall())

    cards = [
        {
            "id": row["id"],
            "front": row["front"],
            "back": row["back"],
            "category": row.get("category"),
            # JOIN (not LEFT JOIN): set_id is NOT NULL with an FK, so a card
            # without a set cannot exist. Kept as "" default for shape parity.
            "subject": row.get("subject") or "",
            "due_at": row["due_at"],
            "repetitions": row["repetitions"],
        }
        for row in rows
    ]
    total_due = rows[0]["total_due"] if rows else 0
    return {"cards": cards, "total_due": total_due}


def review_flashcard(card_id: str, external_id: str, grade: str) -> Optional[Dict]:
    """Apply one self-graded review to a card and return its new schedule.
    Ownership-scoped; returns None for foreign/unknown cards."""
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return None

    with cursor() as cur:
        cur.execute(
            "SELECT id, interval_days, ease, repetitions FROM flashcards"
            " WHERE id = %s AND user_id = %s",
            (card_id, user_id),
        )
        card = cur.fetchone()
        if not card:
            return None

        schedule = _schedule_review(
            card["interval_days"], card["ease"], card["repetitions"], grade
        )
        now = datetime.now(timezone.utc)
        due_at = now + schedule.pop("due_in")

        # user_id repeated in the UPDATE predicate: the SELECT above already
        # proved ownership, but keeping it here means no window between the
        # check and the write.
        cur.execute(
            "UPDATE flashcards SET interval_days = %s, ease = %s, repetitions = %s,"
            " due_at = %s, last_reviewed_at = %s"
            " WHERE id = %s AND user_id = %s",
            (schedule["interval_days"], schedule["ease"], schedule["repetitions"],
             due_at, now, card_id, user_id),
        )

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
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return None

    with cursor() as cur:
        cur.execute(
            "SELECT * FROM match_concept_mastery(%s, %s, %s, %s)",
            (to_vector(embedding), user_id, CONCEPT_MATCH_THRESHOLD, 1),
        )
        return _row(cur.fetchone())


def create_concept_mastery(
    external_id: str, concept: str, embedding: List[float], mastery: float,
    document_id: Optional[str] = None, subject: Optional[str] = None,
) -> str:
    """First sighting of a concept for this user — insert and return the row id."""
    user_id = get_or_create_user(external_id)
    with cursor() as cur:
        cur.execute(
            "INSERT INTO concept_mastery"
            " (user_id, concept, embedding, mastery, document_id, subject)"
            " VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
            # to_vector() is required — pgvector's input adapter does not bind
            # on CockroachDB, so a bare list would fail as a malformed literal.
            (user_id, concept, to_vector(embedding), mastery, document_id, subject),
        )
        return str(cur.fetchone()["id"])


def set_concept_source(row_id: str, document_id: Optional[str], subject: Optional[str]) -> None:
    """Remember where a concept was (most recently) studied, so a due review
    can reopen that document's stored content for a refresher."""
    updates = {}
    if document_id:
        updates["document_id"] = document_id
    if subject:
        updates["subject"] = subject
    if not updates:
        return

    # Column names come from this function's own literals, never from input;
    # the values stay parameterized.
    assignments = ", ".join(f"{col} = %s" for col in updates)
    with cursor() as cur:
        cur.execute(
            f"UPDATE concept_mastery SET {assignments} WHERE id = %s",
            (*updates.values(), row_id),
        )


def update_concept_mastery(row_id: str, mastery: float, questions_asked: int, questions_correct: int) -> None:
    """Write the current mastery estimate and lifetime counters back."""
    with cursor() as cur:
        cur.execute(
            "UPDATE concept_mastery SET mastery = %s, questions_asked = %s,"
            " questions_correct = %s, last_seen_at = now() WHERE id = %s",
            (mastery, questions_asked, questions_correct, row_id),
        )


def update_concept_calibration(
    row_id: str, high_answered: int, high_correct: int, low_answered: int, low_correct: int,
) -> None:
    """Lifetime (confidence, correctness) counters (ROADMAP_LEARNING 5).
    Kept separate from update_concept_mastery so a not-yet-migrated
    concept_mastery table can't block the mastery write."""
    with cursor() as cur:
        cur.execute(
            "UPDATE concept_mastery SET conf_high_asked = %s, conf_high_correct = %s,"
            " conf_low_asked = %s, conf_low_correct = %s WHERE id = %s",
            (high_answered, high_correct, low_answered, low_correct, row_id),
        )


# --- Spaced repetition for concepts (ROADMAP_LEARNING 6) ----------------------
# Concepts decay like flashcards do. Every finished tutor session reschedules
# each probed concept: a session that confirms the concept (cleared the mode's
# mastery bar) grows the interval SM-2-style; a session that finds it weak
# resets it to a short relearning step.

CONCEPT_REVIEW_FIRST_DAYS = 3.0
CONCEPT_REVIEW_GROWTH = 2.2
CONCEPT_REVIEW_MAX_DAYS = 90.0
CONCEPT_RELEARN_DAYS = 1.0


def schedule_concept_review(row_id: str, confirmed: bool) -> None:
    """Reschedule one concept's next review after a finished session."""
    with cursor() as cur:
        cur.execute(
            "SELECT review_interval_days, review_count FROM concept_mastery WHERE id = %s",
            (row_id,),
        )
        row = cur.fetchone()
    if not row:
        return

    if confirmed:
        if row["review_count"] == 0 or row["review_interval_days"] <= 0:
            interval = CONCEPT_REVIEW_FIRST_DAYS
        else:
            interval = min(CONCEPT_REVIEW_MAX_DAYS, row["review_interval_days"] * CONCEPT_REVIEW_GROWTH)
        review_count = row["review_count"] + 1
    else:
        interval = CONCEPT_RELEARN_DAYS
        review_count = 0

    due_at = datetime.now(timezone.utc) + timedelta(days=interval)
    with cursor() as cur:
        cur.execute(
            "UPDATE concept_mastery SET review_interval_days = %s, review_count = %s,"
            " review_due_at = %s WHERE id = %s",
            (interval, review_count, due_at, row_id),
        )


def get_due_concept_reviews(external_id: str, limit: int = 3) -> Dict:
    """Concepts whose review schedule says they're due (most overdue first),
    with their source document so one click can start a refresher. Concepts
    whose source document was deleted are skipped — there is no stored
    content to refresh from."""
    user_id = _lookup_user_id(external_id)
    if not user_id:
        return {"concepts": [], "total_due": 0}

    now = datetime.now(timezone.utc)
    with cursor() as cur:
        # The inner JOIN enforces what Supabase expressed as
        # .not_.is_("document_id", "null") *plus* the docstring's intent:
        # concepts whose source document was deleted are skipped, because
        # there is no stored content to refresh from. A LEFT JOIN would
        # resurrect those rows with a null filename.
        cur.execute(
            "SELECT cm.id, cm.concept, cm.mastery, cm.subject, cm.document_id,"
            " cm.last_seen_at, cm.review_due_at, d.filename AS document_filename,"
            " count(*) OVER () AS total_due"
            " FROM concept_mastery cm"
            " JOIN documents d ON d.id = cm.document_id"
            " WHERE cm.user_id = %s AND cm.review_due_at <= %s"
            " ORDER BY cm.review_due_at LIMIT %s",
            (user_id, now, limit),
        )
        rows = cur.fetchall()

    concepts = []
    for row in rows:
        # last_seen_at arrives as a datetime from psycopg, where supabase-py
        # returned an ISO string — the original code called .replace("Z", …)
        # on it and would raise AttributeError here. Subtract directly.
        last_seen = row.get("last_seen_at")
        days_since = max(0, (now - last_seen).days) if last_seen else None
        concepts.append({
            "id": str(row["id"]),
            "concept": row["concept"],
            "mastery": row["mastery"],
            "subject": row.get("subject"),
            "document_id": str(row["document_id"]) if row["document_id"] else None,
            "document_filename": row.get("document_filename"),
            "last_seen_at": last_seen.isoformat().replace("+00:00", "Z") if last_seen else None,
            "review_due_at": row["review_due_at"].isoformat().replace("+00:00", "Z")
            if row["review_due_at"] else None,
            "days_since_seen": days_since,
        })
    total_due = rows[0]["total_due"] if rows else 0
    return {"concepts": concepts, "total_due": total_due}


def record_misconception(external_id: str, concept_mastery_id: str, concept: str, misconception: str) -> None:
    """Persist one diagnosed misconception, linked to the concept's mastery row."""
    user_id = get_or_create_user(external_id)
    with cursor() as cur:
        cur.execute(
            "INSERT INTO misconceptions"
            " (user_id, concept_mastery_id, concept, misconception)"
            " VALUES (%s,%s,%s,%s)",
            (user_id, concept_mastery_id, concept, misconception),
        )


def get_recent_misconceptions(concept_mastery_id: str, limit: int = 3) -> List[str]:
    """Most recent diagnosed misconceptions for one concept, newest first."""
    return [row["misconception"] for row in get_recent_misconception_rows(concept_mastery_id, limit)]


def get_recent_misconception_rows(concept_mastery_id: str, limit: int = 3) -> List[Dict]:
    """Most recent diagnosed misconceptions for one concept, newest first, as
    {id, misconception} rows. Teach-it-back (ROADMAP_LEARNING 4) needs the id:
    a misconception the student successfully corrects gets cleared, and you
    can't delete a row you only know the text of."""
    with cursor() as cur:
        cur.execute(
            "SELECT id, misconception FROM misconceptions"
            " WHERE concept_mastery_id = %s"
            " ORDER BY created_at DESC LIMIT %s",
            (concept_mastery_id, limit),
        )
        return _rows(cur.fetchall())


def clear_misconception(misconception_id: str) -> None:
    """Drop one misconception the student has demonstrably corrected
    (ROADMAP_LEARNING 4). Deleted rather than flagged: the row exists to seed
    future probing, and a corrected misconception should stop being probed —
    the mastery estimate is what carries the long-term record."""
    with cursor() as cur:
        cur.execute("DELETE FROM misconceptions WHERE id = %s", (misconception_id,))
